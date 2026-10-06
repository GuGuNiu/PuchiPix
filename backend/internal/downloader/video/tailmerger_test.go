package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// newTestTailMerger builds a TailMerger over `contents` segments whose
// capsule files are pre-written to dir. Capsules are arbitrary bytes: the
// merger trusts OnSegmentReady, which is only fired after structural
// validation, so no TS framing is needed here.
func newTestTailMerger(t *testing.T, dir string, contents []string) (*TailMerger, []M3U8Segment, string) {
	t.Helper()
	segments := make([]M3U8Segment, len(contents))
	for i, content := range contents {
		segments[i] = seg(fmt.Sprintf("http://cdn/s%d.ts", i), i)
		writeSegment(t, dir, SegmentFileName(segments[i]), content)
	}
	output := filepath.Join(dir, mergedOutputDir, "title.ts")
	tm := NewTailMerger(1, dir, output, segments)
	return tm, segments, output
}

func readOrFail(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// waitForMarker polls until the durable marker records at least wantPosition
// appended segments, returning the observed marker.
func waitForMarker(t *testing.T, path string, wantPosition int) tailMergeMarker {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if m, err := readTailMergeMarker(path); err == nil && m.Position >= wantPosition {
			return m
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("marker never reached position %d", wantPosition)
	return tailMergeMarker{}
}

func TestTailMergerPublishesOutOfOrderSegments(t *testing.T) {
	dir := t.TempDir()
	tm, segments, output := newTestTailMerger(t, dir, []string{"AAA", "BBB", "CCC"})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tm.Start(ctx)

	// Completion order differs from playlist order — the merger must wait
	// for the contiguous prefix and append strictly in manifest order.
	tm.Notify(2, filepath.Join(dir, SegmentFileName(segments[2])), 3)
	tm.Notify(0, filepath.Join(dir, SegmentFileName(segments[0])), 3)
	tm.Notify(1, filepath.Join(dir, SegmentFileName(segments[1])), 3)

	if !tm.Complete() {
		t.Fatal("tail merger must publish once every segment is ready")
	}
	if got := readOrFail(t, output); got != "AAABBBCCC" {
		t.Fatalf("merged content = %q, want playlist order AAABBBCCC", got)
	}
	if _, err := os.Stat(tm.partPath); !os.IsNotExist(err) {
		t.Fatalf("part file must be renamed away on publish, stat err = %v", err)
	}
	if _, err := os.Stat(tm.markerPath); !os.IsNotExist(err) {
		t.Fatalf("marker must be removed after publish, stat err = %v", err)
	}
}

func TestTailMergerResumesFromMarker(t *testing.T) {
	dir := t.TempDir()
	tm, segments, output := newTestTailMerger(t, dir, []string{"AAA", "BBB", "CCC"})

	ctx, cancel := context.WithCancel(context.Background())
	tm.Start(ctx)
	tm.Notify(0, filepath.Join(dir, SegmentFileName(segments[0])), 3)
	waitForMarker(t, tm.markerPath, 1)
	cancel()
	<-tm.done

	// Simulate a torn tail: bytes appended after the recorded offset must
	// be discarded on recovery, not silently merged into the output.
	f, err := os.OpenFile(tm.partPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("GARBAGE"); err != nil {
		t.Fatal(err)
	}
	f.Close()

	tm2 := NewTailMerger(1, dir, output, segments)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	tm2.Start(ctx2)
	tm2.Notify(1, filepath.Join(dir, SegmentFileName(segments[1])), 3)
	tm2.Notify(2, filepath.Join(dir, SegmentFileName(segments[2])), 3)

	if !tm2.Complete() {
		t.Fatal("resumed tail merger must publish")
	}
	if got := readOrFail(t, output); got != "AAABBBCCC" {
		t.Fatalf("resumed merged content = %q, want AAABBBCCC (torn tail must be truncated)", got)
	}
}

func TestTailMergerRejectsFingerprintChange(t *testing.T) {
	dir := t.TempDir()
	tm, segments, output := newTestTailMerger(t, dir, []string{"AAA", "BBB"})

	ctx, cancel := context.WithCancel(context.Background())
	tm.Start(ctx)
	tm.Notify(0, filepath.Join(dir, SegmentFileName(segments[0])), 3)
	waitForMarker(t, tm.markerPath, 1)
	cancel()
	<-tm.done

	// Playlist changed (new URIs): the marker and part file belong to the
	// old playlist and must not leak into the new run.
	changed := []M3U8Segment{seg("http://cdn/new0.ts", 0), seg("http://cdn/new1.ts", 1)}
	writeSegment(t, dir, SegmentFileName(changed[0]), "XXX")
	writeSegment(t, dir, SegmentFileName(changed[1]), "YYY")

	tm2 := NewTailMerger(1, dir, output, changed)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	tm2.Start(ctx2)
	tm2.Notify(0, filepath.Join(dir, SegmentFileName(changed[0])), 3)
	tm2.Notify(1, filepath.Join(dir, SegmentFileName(changed[1])), 3)

	if !tm2.Complete() {
		t.Fatal("tail merger after playlist change must publish")
	}
	if got := readOrFail(t, output); got != "XXXYYY" {
		t.Fatalf("merged content = %q, want XXXYYY (stale part file must be discarded)", got)
	}
}

func TestTailMergerBrokenOnMissingCapsule(t *testing.T) {
	dir := t.TempDir()
	tm, segments, _ := newTestTailMerger(t, dir, []string{"AAA", "BBB"})
	if err := os.Remove(filepath.Join(dir, SegmentFileName(segments[1]))); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tm.Start(ctx)
	tm.Notify(0, filepath.Join(dir, SegmentFileName(segments[0])), 3)
	tm.Notify(1, filepath.Join(dir, SegmentFileName(segments[1])), 3)

	if tm.Complete() {
		t.Fatal("a broken merger must not report completion")
	}
	// Broken, not silently half-published: the part file holds only the
	// appended prefix and no final output exists.
	if got := readOrFail(t, tm.partPath); got != "AAA" {
		t.Fatalf("part file = %q, want AAA", got)
	}

	// Discard cleans the slate for the full-merge fallback.
	tm.Discard()
	if _, err := os.Stat(tm.partPath); !os.IsNotExist(err) {
		t.Fatalf("discard must remove the part file, stat err = %v", err)
	}
}

func TestTailMergerCompleteWithoutStart(t *testing.T) {
	dir := t.TempDir()
	tm, _, _ := newTestTailMerger(t, dir, []string{"AAA"})
	if tm.Complete() {
		t.Fatal("an unstarted merger can never be complete")
	}
}
