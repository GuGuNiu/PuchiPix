package video

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"backend/internal/infra"
)

// tailMergeMarker is the durable watermark of the tail-merge fast path:
// playlist positions [0, Position) are appended into the part file, Offset
// bytes in total. It is bound to the playlist fingerprint so a playlist
// change invalidates it, and it lives inside the _merged directory so the
// existing fingerprint-reset wipe removes it together with the part file.
type tailMergeMarker struct {
	Fingerprint string `json:"fingerprint"`
	Position    int    `json:"position"`
	Offset      int64  `json:"offset"`
}

// tailSegmentReady carries one notified segment pending append.
type tailSegmentReady struct {
	path string
	size int64
}

// TailMerger appends completed segments, in playlist order, into the merged
// output while the download is still running. It is a pure fast path:
//
//   - capsule segment files are kept until the task's final cleanup, so the
//     merge validator and the full-merge fallback always see an intact
//     input set;
//   - every failure only marks the merger broken — the download itself
//     never fails because of it, MergeRetryLoop's full merge takes over;
//   - a durable marker lets a restarted task truncate the part file back to
//     the last recorded offset and resume appending instead of re-merging.
type TailMerger struct {
	taskID      int
	capsules    []string // absolute capsule paths, by playlist position
	fingerprint string
	mergedDir   string
	partPath    string
	finalPath   string
	markerPath  string
	logger      *infra.Logger

	mu        sync.Mutex
	ready     map[int]tailSegmentReady // playlist position → notified segment
	watermark int                      // next playlist position to append
	offset    int64                    // bytes durably appended to the part file
	running   bool
	broken    bool
	finished  bool

	kick chan struct{}
	done chan struct{}
}

// NewTailMerger builds the tail merger for one download run. The part file
// lives next to the final merged output inside the _merged directory, so it
// is invisible to the segment-directory scans and removed by the task-level
// cleanup together with everything else.
func NewTailMerger(taskID int, segDir, tsOutputPath string, segments []M3U8Segment) *TailMerger {
	mergedDir := filepath.Dir(tsOutputPath)
	names := SegmentManifest(segments)
	capsules := make([]string, len(names))
	for i, name := range names {
		capsules[i] = filepath.Join(segDir, name)
	}
	return &TailMerger{
		taskID:      taskID,
		capsules:    capsules,
		fingerprint: PlaylistFingerprint(segments),
		mergedDir:   mergedDir,
		partPath:    tsOutputPath + ".part",
		finalPath:   tsOutputPath,
		markerPath:  filepath.Join(mergedDir, ".tailmerge-marker"),
		logger:      infra.NewLogger("TailMerger"),
		ready:       make(map[int]tailSegmentReady),
		kick:        make(chan struct{}, 1),
		done:        make(chan struct{}),
	}
}

// Start launches the consumer goroutine. Calling it again while a previous
// consumer is still active is a no-op; a merger that finished or broke stays
// in that state — recovery happens through a fresh instance in the next
// StartDownload run, driven by the persisted marker.
func (t *TailMerger) Start(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	t.mu.Lock()
	if t.running || t.finished || t.broken {
		t.mu.Unlock()
		return
	}
	t.running = true
	t.mu.Unlock()
	go t.run(ctx)
}

// Notify records a completed, structurally validated segment for append.
// Non-blocking: it never stalls the download worker that calls it.
func (t *TailMerger) Notify(position int, filePath string, size int64) {
	t.mu.Lock()
	if t.broken || t.finished || position < t.watermark || position >= len(t.capsules) {
		t.mu.Unlock()
		return
	}
	t.ready[position] = tailSegmentReady{path: filePath, size: size}
	t.mu.Unlock()
	select {
	case t.kick <- struct{}{}:
	default:
	}
}

// Complete reports whether the tail merger published the final merged
// output, waiting (bounded) for the consumer to drain if it is still
// running. Called from the merge phase, after all segments are done.
func (t *TailMerger) Complete() bool {
	t.mu.Lock()
	running := t.running
	t.mu.Unlock()
	if running {
		select {
		case <-t.done:
		case <-time.After(2 * time.Minute):
		}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.finished
}

// Discard drops the tail-merge state (part file and marker) after the fast
// path was rejected, so the full merge starts from a clean slate.
func (t *TailMerger) Discard() {
	t.mu.Lock()
	t.broken = true
	running := t.running
	t.mu.Unlock()
	select {
	case t.kick <- struct{}{}:
	default:
	}
	if running {
		select {
		case <-t.done:
		case <-time.After(10 * time.Second):
		}
	}
	_ = os.Remove(t.partPath)
	_ = os.Remove(t.markerPath)
}

func (t *TailMerger) run(ctx context.Context) {
	defer close(t.done)
	defer func() {
		t.mu.Lock()
		t.running = false
		t.mu.Unlock()
	}()

	if len(t.capsules) == 0 {
		t.fail("tail merger created with an empty playlist", fmt.Errorf("no segments"))
		return
	}

	out, err := t.open()
	if err != nil {
		t.fail("cannot open merged output part file", err)
		return
	}

	// The ready map is the source of truth; kick is only a wakeup signal,
	// so no notification can be lost across cancel/resume of the loop.
	buf := make([]byte, 256*1024)
	published := false
	for {
		if ctx.Err() != nil {
			break
		}
		t.mu.Lock()
		broken := t.broken
		allDone := t.watermark >= len(t.capsules)
		next, ok := t.ready[t.watermark]
		t.mu.Unlock()
		if broken {
			break
		}
		if allDone {
			published = true
			break
		}
		if !ok {
			select {
			case <-t.kick:
			case <-ctx.Done():
			}
			continue
		}
		t.mu.Lock()
		delete(t.ready, t.watermark)
		t.mu.Unlock()

		if err := t.appendSegment(out, t.watermark, next, buf); err != nil {
			t.fail("tail merge append failed", err)
			break
		}
		t.mu.Lock()
		t.watermark++
		t.mu.Unlock()
	}

	if closeErr := out.Close(); closeErr != nil {
		published = false
		t.fail("cannot close merged output part file", closeErr)
	}
	if published {
		t.publish()
	}
}

// open prepares the part file for appending. A marker matching the current
// playlist fingerprint adopts the existing part file: it is truncated back
// to the recorded offset, discarding any torn tail from an interrupted run,
// and the watermark resumes from the marker. Anything else starts fresh.
func (t *TailMerger) open() (*os.File, error) {
	if err := os.MkdirAll(t.mergedDir, 0755); err != nil {
		return nil, err
	}
	adopt := false
	if stored, err := readTailMergeMarker(t.markerPath); err == nil &&
		stored.Fingerprint == t.fingerprint &&
		stored.Position >= 0 && stored.Position <= len(t.capsules) &&
		stored.Offset >= 0 {
		if info, statErr := os.Stat(t.partPath); statErr == nil && info.Size() >= stored.Offset {
			if truncErr := os.Truncate(t.partPath, stored.Offset); truncErr == nil {
				adopt = true
				t.mu.Lock()
				t.watermark = stored.Position
				t.offset = stored.Offset
				t.mu.Unlock()
				t.logger.Info("Adopting tail-merge part file from marker",
					infra.LogContext{Extra: map[string]any{
						"taskId":   t.taskID,
						"position": stored.Position,
						"offset":   stored.Offset,
					}})
			}
		}
	}
	if !adopt {
		_ = os.Remove(t.partPath)
		_ = os.Remove(t.markerPath)
		t.mu.Lock()
		t.watermark = 0
		t.offset = 0
		t.mu.Unlock()
	}
	return os.OpenFile(t.partPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
}

func (t *TailMerger) appendSegment(out *os.File, position int, segment tailSegmentReady, buf []byte) error {
	src, err := os.Open(segment.path)
	if err != nil {
		return err
	}
	written, err := io.CopyBuffer(out, src, buf)
	closeErr := src.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}

	t.mu.Lock()
	t.offset += written
	marker := tailMergeMarker{
		Fingerprint: t.fingerprint,
		Position:    position + 1,
		Offset:      t.offset,
	}
	t.mu.Unlock()
	if err := writeTailMergeMarker(t.markerPath, marker); err != nil {
		return fmt.Errorf("cannot persist tail-merge marker: %w", err)
	}
	return nil
}

// publish renames the part file onto the final output path, mirroring the
// full merger's Windows-compatible remove-then-rename fallback.
func (t *TailMerger) publish() {
	if err := os.Rename(t.partPath, t.finalPath); err != nil {
		if rmErr := os.Remove(t.finalPath); rmErr != nil && !os.IsNotExist(rmErr) {
			t.fail("cannot replace merged output for tail merge", err)
			return
		}
		if err := os.Rename(t.partPath, t.finalPath); err != nil {
			t.fail("cannot publish tail-merged output", err)
			return
		}
	}
	_ = os.Remove(t.markerPath)

	t.mu.Lock()
	t.finished = true
	bytes := t.offset
	t.mu.Unlock()
	t.logger.Info("Tail merge published merged output",
		infra.LogContext{Extra: map[string]any{
			"taskId": t.taskID,
			"segs":   len(t.capsules),
			"bytes":  bytes,
		}})
}

func (t *TailMerger) fail(msg string, err error) {
	t.mu.Lock()
	if t.broken || t.finished {
		t.mu.Unlock()
		return
	}
	t.broken = true
	t.mu.Unlock()
	t.logger.Warn(msg,
		infra.LogContext{Extra: map[string]any{
			"taskId": t.taskID,
			"error":  err.Error(),
		}})
}

func readTailMergeMarker(path string) (tailMergeMarker, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return tailMergeMarker{}, err
	}
	var m tailMergeMarker
	if err := json.Unmarshal(data, &m); err != nil {
		return tailMergeMarker{}, err
	}
	return m, nil
}

// writeTailMergeMarker persists the watermark atomically (temp + rename) so
// a crash never leaves a half-written marker behind.
func writeTailMergeMarker(path string, m tailMergeMarker) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
