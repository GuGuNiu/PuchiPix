package video

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/taskprogress"
	"backend/internal/taskstate"
	"backend/internal/urlutil"
)

// DownloadTaskInput carries the data needed to start a video download,
// decoupled from the database model so callers can construct it from
// any source.
type DownloadTaskInput struct {
	ID             int
	M3U8URL        string
	PageURL        string
	Title          string
	Tags           []string
	Actors         []string
	Categories     []string
	Director       string
	RefererDomains []string // candidate referer domains for CDN anti-hotlink bypass
}

// ManagerConfig holds the tunable parameters for a DownloadManager.
type ManagerConfig struct {
	MaxRetries    int
	DownloadPath  string
	SegmentsPath  string
	MaxConcurrent int
	GPUTranscode  bool
	// ForceGPUType overrides auto-detection ("" = auto). Valid values: "nvenc", "qsv", "vaapi", "amf", "videotoolbox".
	ForceGPUType string
}

func DefaultManagerConfig() ManagerConfig {
	return ManagerConfig{
		MaxRetries:              5,
		DownloadPath:            "../data/videos",
		SegmentsPath:            "../data/segments",
		MaxConcurrent:           3,
		GPUTranscode:            false,
		ForceGPUType:            "",
	}
}

const maxTaskRetries = 2

type taskRun struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

type DownloadManager struct {
	mu    sync.Mutex
	cond  *sync.Cond
	state *taskstate.Store

	db                      *db.Database
	eventBus                *infra.EventBus
	maxRetries              int
	downloadPath            string
	segmentsPath            string
	maxConcurrent           atomic.Int64
	gpuTranscode            bool
	forceGPUType            string
	tracker                 *taskprogress.VideoProgressTracker

	activeDownloads map[int]*ActiveDownload
	runningTasks    map[int]*taskRun
	forbiddenTasks  map[int]struct{}
	taskRetries     map[int]int
	segQueue        *SegmentQueue
	logger          *infra.Logger
}

func NewDownloadManager(database *db.Database, eventBus *infra.EventBus, cfg ManagerConfig) *DownloadManager {
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 5
	}
	if cfg.DownloadPath == "" {
		cfg.DownloadPath = "../data/videos"
	}
	if cfg.SegmentsPath == "" {
		cfg.SegmentsPath = "../data/segments"
	}
	if cfg.MaxConcurrent == 0 {
		cfg.MaxConcurrent = 3
	}

	m := &DownloadManager{
		mu:                      sync.Mutex{},
		state:                   taskstate.NewStore(database, eventBus),
		db:                      database,
		eventBus:                eventBus,
		maxRetries:              cfg.MaxRetries,
		downloadPath:            cfg.DownloadPath,
		segmentsPath:            cfg.SegmentsPath,
		gpuTranscode:            cfg.GPUTranscode,
		forceGPUType:            cfg.ForceGPUType,
		activeDownloads:         make(map[int]*ActiveDownload),
		runningTasks:            make(map[int]*taskRun),
		forbiddenTasks:          make(map[int]struct{}),
		taskRetries:             make(map[int]int),
		logger:                  m3u8Logger,
	}
	m.maxConcurrent.Store(int64(cfg.MaxConcurrent))
	m.cond = sync.NewCond(&m.mu)

	m.segQueue = NewSegmentQueue(&m.mu, m.cond, m.activeDownloads, SegmentQueueConfig{
		MaxRetries: cfg.MaxRetries,
		GetMaxConcurrent: func() int {
			return int(m.maxConcurrent.Load())
		},
		OnProgress:      m.emitProgress,
		OnSegmentUpdate: m.handleSegmentUpdate,
		OnSegmentReady:  m.handleSegmentReady,
		DB:              database,
		Logger:          m.logger,
	})

	// DB values override ManagerConfig defaults.
	m.LoadGPUTranscodeFromDB()

	return m
}

func (m *DownloadManager) TaskSegmentsDir(taskID int) string {
	return filepath.Join(m.segmentsPath, fmt.Sprintf("task_%d", taskID))
}

func (m *DownloadManager) DataRoot() string {
	downloadRoot := filepath.Clean(m.downloadPath)
	segmentsRoot := filepath.Clean(m.segmentsPath)
	if filepath.Base(downloadRoot) == "videos" && filepath.Base(segmentsRoot) == "segments" && filepath.Dir(downloadRoot) == filepath.Dir(segmentsRoot) {
		return filepath.Dir(downloadRoot)
	}
	return filepath.Dir(downloadRoot)
}

// SetMaxConcurrent updates the TS segment download concurrency limit at
// runtime. The value is clamped to [1, 200] and takes effect immediately
// for the next segment dispatch cycle — no restart required.
func (m *DownloadManager) SetMaxConcurrent(n int) {
	if n < 1 {
		n = 1
	}
	if n > 200 {
		n = 200
	}
	m.maxConcurrent.Store(int64(n))
	if m.segQueue != nil {
		m.segQueue.ProcessQueue()
	}
	m.logger.Info("TS segment concurrency updated", "newMax", n)
}

// GetMaxConcurrent returns the current TS segment concurrency limit.
func (m *DownloadManager) GetMaxConcurrent() int {
	return int(m.maxConcurrent.Load())
}

func (m *DownloadManager) SetGPUTranscode(enabled bool, forceType string) {
	m.mu.Lock()
	m.gpuTranscode = enabled
	m.forceGPUType = forceType
	m.mu.Unlock()

	m.persistGPUSettings(enabled, forceType)

	ResetGPUCache()

	gpuInfo := DetectGPU()
	if enabled && gpuInfo.SupportsHWTranscode() {
		m.logger.Info("GPU transcoding enabled",
			infra.LogContext{Extra: map[string]any{
				"gpu":     gpuInfo.String(),
				"encoder": gpuInfo.EncoderName,
			}})
	} else if enabled {
		m.logger.Warn("GPU transcoding enabled but no compatible GPU detected — will fall back to software",
			nil)
	} else {
		m.logger.Info("GPU transcoding disabled", nil)
	}
}

// persistGPUSettings writes the GPU transcoding choice to app_configs so
// it survives restarts and is honored as the user/explicit choice.
func (m *DownloadManager) persistGPUSettings(enabled bool, forceType string) {
	if m.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = m.db.Exec(ctx,
		`INSERT INTO app_configs (key, value) VALUES (?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
		"gpu_transcode", boolToStr(enabled), boolToStr(enabled))
	_, _ = m.db.Exec(ctx,
		`INSERT INTO app_configs (key, value) VALUES (?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
		"gpu_force_type", forceType, forceType)
}

// AutoConfigureGPU sets GPU transcoding defaults when the user has not made
// an explicit choice. Call after LoadGPUTranscodeFromDB.
func (m *DownloadManager) AutoConfigureGPU() {
	if m.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var v string
	if err := m.db.QueryRow(ctx, "SELECT value FROM app_configs WHERE key = 'gpu_transcode'").Scan(&v); err == nil {
		return // an explicit choice already exists, honor it
	}

	gpuInfo := DetectGPU()
	enable := gpuInfo.SupportsHWTranscode() && gpuInfo.IsDiscrete()
	m.mu.Lock()
	m.gpuTranscode = enable
	m.forceGPUType = string(gpuInfo.Type)
	m.mu.Unlock()
	m.persistGPUSettings(enable, string(gpuInfo.Type))

	m.logger.Info("Auto-configured GPU transcoding",
		infra.LogContext{Extra: map[string]any{
			"enabled": enable,
			"gpu":     gpuInfo.String(),
		}})
}

func (m *DownloadManager) GetGPUTranscodeStatus() (enabled bool, forceType string, gpuInfo *GPUInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.gpuTranscode, m.forceGPUType, DetectGPU()
}

// LoadGPUTranscodeFromDB loads the GPU transcoding configuration from
// app_configs. Call this during NewDownloadManager initialization.
func (m *DownloadManager) LoadGPUTranscodeFromDB() {
	if m.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var value string
	err := m.db.QueryRow(ctx, "SELECT value FROM app_configs WHERE key = 'gpu_transcode'").Scan(&value)
	if err == nil && value == "true" {
		m.gpuTranscode = true
	}

	err = m.db.QueryRow(ctx, "SELECT value FROM app_configs WHERE key = 'gpu_force_type'").Scan(&value)
	if err == nil {
		m.forceGPUType = value
	}
}

// boolToStr converts bool to string for storage in app_configs.
func boolToStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// SetTracker injects the VideoProgressTracker for segment-level tracking.
func (m *DownloadManager) SetTracker(t *taskprogress.VideoProgressTracker) {
	m.mu.Lock()
	m.tracker = t
	m.mu.Unlock()
}

func (m *DownloadManager) handleSegmentUpdate(taskID, segmentIdx int, completed bool, localPath string, fileSize int64, errMsg string) {
	if m.tracker == nil {
		return
	}
	status := taskprogress.SegCompleted
	if !completed {
		status = taskprogress.SegFailed
	}
	m.tracker.UpdateSegment(taskID, segmentIdx, status, localPath, fileSize, errMsg)
}

// handleSegmentReady feeds each validated segment to the task's tail
// merger, which appends playlist-ordered prefixes into the merged output
// while the download runs. Notify is non-blocking, so a slow disk only
// backpressures via the merger's own queue, never the download workers.
func (m *DownloadManager) handleSegmentReady(taskID, index int, filePath string, size int64) {
	m.mu.Lock()
	download, ok := m.activeDownloads[taskID]
	if !ok {
		m.mu.Unlock()
		return
	}
	position, ok := download.SegmentPositions[index]
	if !ok {
		position = index
	}
	tailMerger := download.tailMerger
	m.mu.Unlock()

	if tailMerger != nil {
		tailMerger.Notify(position, filePath, size)
	}
}

func (m *DownloadManager) emitProgress(taskID int, progress float64, segment, total int, status, speed string) {
	rounded := math.Round(progress*100) / 100

	// Aggregate downloaded bytes from the segment tracker so the SSE
	// size column shows a live partial size during download.
	var downloadedBytes int64
	if m.tracker != nil && status != "transcoding" && status != "merging" {
		downloadedBytes = m.tracker.GetSummary(taskID).DownloadedBytes
	}

	if m.eventBus != nil {
		m.eventBus.Emit("task:progress", map[string]any{
			"taskId":          taskID,
			"progress":        rounded,
			"status":          status,
			"speed":           speed,
			"segment":         segment,
			"total":           total,
			"downloadedBytes": downloadedBytes,
		})
	}
}

// StartDownload runs the full download pipeline for a task. It blocks until
// the download completes, fails, or is scheduled for auto-retry. The caller
// must invoke this in a dedicated goroutine.
func (m *DownloadManager) StartDownload(ctx context.Context, task DownloadTaskInput) (err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	m.mu.Lock()
	if _, forbidden := m.forbiddenTasks[task.ID]; forbidden {
		m.mu.Unlock()
		return fmt.Errorf("task %d was deleted", task.ID)
	}
	if _, exists := m.runningTasks[task.ID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("task %d is already being downloaded", task.ID)
	}
	runCtx, runCancel := context.WithCancel(ctx)
	run := &taskRun{ctx: runCtx, cancel: runCancel, done: make(chan struct{})}
	m.runningTasks[task.ID] = run
	m.mu.Unlock()
	defer func() {
		runCancel()
		m.mu.Lock()
		if m.runningTasks[task.ID] == run {
			delete(m.runningTasks, task.ID)
		}
		m.mu.Unlock()
		close(run.done)
	}()
	ctx = runCtx

	if task.M3U8URL == "" {
		return fmt.Errorf("no M3U8 URL for task %d", task.ID)
	}

	zero := 0.0
	if err := m.state.Transition(ctx, task.ID, taskstate.Update{
		Status:   taskstate.StatusDownloading,
		Progress: &zero,
		Set:      map[string]any{"error_msg": "", "completed_segments": 0},
	}); err != nil {
		return fmt.Errorf("activate download: %w", err)
	}

	safeTitle := downloader.SanitizeFilename(task.Title)
	if safeTitle == "" {
		safeTitle = "untitled"
	}

	segDir := m.TaskSegmentsDir(task.ID)
	mp4OutputPath := filepath.Join(m.downloadPath, fmt.Sprintf("%s_%d.mp4", safeTitle, task.ID))
	// The merged TS output must live OUTSIDE the segment directory root:
	// scan-based consumers (merge/transcode) read *.ts from that root, so
	// an output placed there gets swallowed into the next merge input set
	// and the file doubles on every retry round. The _merged subdir stays
	// inside the task dir, so task-level cleanup still removes it.
	tsOutputPath := filepath.Join(segDir, mergedOutputDir, safeTitle+".ts")

	if err := os.MkdirAll(segDir, 0755); err != nil {
		return fmt.Errorf("cannot create segment directory: %w", err)
	}
	if err := os.MkdirAll(m.downloadPath, 0755); err != nil {
		return fmt.Errorf("cannot create download directory: %w", err)
	}

	referer := task.PageURL
	if referer == "" || urlutil.IsM3U8URL(referer) {
		referer = ""
	}

	// Build a list of fallback referer domains for CDN anti-hotlink bypass.
	// Many CDNs check the Referer header and reject requests carrying a
	// Referer from a non-whitelisted domain, so the site's other known
	// mirror domains are tried in turn.
	var refererDomains []string
	if len(task.RefererDomains) > 0 {
		for _, d := range task.RefererDomains {
			if referer != "" && strings.Contains(referer, d) {
				continue
			}
			refererDomains = append(refererDomains, d)
		}
	}

	defer func() {
		m.mu.Lock()
		delete(m.activeDownloads, task.ID)
		m.mu.Unlock()
	}()

	if perr := m.runDownload(ctx, task, referer, refererDomains, segDir, mp4OutputPath, tsOutputPath); perr != nil {
		m.handleDownloadError(ctx, task, perr)
		return perr
	}

	m.mu.Lock()
	delete(m.taskRetries, task.ID)
	m.mu.Unlock()

	return nil
}

func (m *DownloadManager) runDownload(ctx context.Context, task DownloadTaskInput, referer string, refererDomains []string, segDir, mp4OutputPath, tsOutputPath string) error {
	m.logger.Info("Fetching M3U8 playlist",
		infra.LogContext{Extra: map[string]any{"taskId": task.ID}})

	fetchResult, err := FetchAndParseM3U8(ctx, task.M3U8URL, M3U8FetchOptions{
		Referer:         referer,
		FallbackDomains: refererDomains,
	})
	if err != nil {
		return err
	}

	// Use the effective referer (accepted by the CDN) for all segment downloads.
	referer = fetchResult.EffectiveReferer
	segments := fetchResult.Segments

	// Task retries reuse the segment directory. If the playlist changed
	// (variant switch / source re-slice), stale segments would otherwise
	// be merged together with the new ones — reset the cache instead.
	playlistChanged := EnsurePlaylistFingerprint(segDir, segments)
	if playlistChanged {
		m.logger.Warn("Playlist fingerprint mismatch, segment cache reset",
			infra.LogContext{Extra: map[string]any{"taskId": task.ID}})
	}

	if fetchResult.IsMaster {
		m.logger.Info("Selected variant from master playlist",
			infra.LogContext{Extra: map[string]any{
				"taskId":  task.ID,
				"variant": fetchResult.VariantURL,
			}})
	}

	m.logger.Info("Segments to download",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"count":  len(segments),
		}})

	if m.tracker != nil {
		if playlistChanged {
			m.tracker.RemoveTask(task.ID)
		}
		indices := make([]int, len(segments))
		for i, seg := range segments {
			indices[i] = seg.Index
		}
		m.tracker.RegisterSegmentIndices(task.ID, indices)
	}

	// Persist total_segments so SSE clients can query it without a live connection.
	if m.db != nil {
		ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = m.db.Exec(ctx2,
			"UPDATE download_tasks SET total_segments = ? WHERE id = ?",
			len(segments), task.ID)
		cancel2()
	}

	downloadCtx, downloadCancel := context.WithCancel(ctx)
	segmentPositions := make(map[int]int, len(segments))
	for i, segment := range segments {
		segmentPositions[segment.Index] = i
	}
	download := &ActiveDownload{
		TaskID:            task.ID,
		Status:            StatusActive,
		ctx:               downloadCtx,
		cancel:            downloadCancel,
		Segments:          segments,
		SegmentPositions:  segmentPositions,
		CompletedSegments: make(map[int]bool),
		FailedSegments:    make(map[int]error),
		TotalSegments:     len(segments),
		SegDir:            segDir,
		OutputPath:        mp4OutputPath,
		StartTime:         time.Now(),
		LastProgressTime:  time.Now(),
		Referer:           referer,
		done:              make(chan struct{}),
	}
	defer close(download.done)

	// Tail-merge fast path: completed segments are appended into the merged
	// output in playlist order while the download runs, so the post-download
	// merge phase reduces to validation. Any failure inside the merger only
	// disables the fast path — the full merge in MergeRetryLoop remains.
	download.tailMerger = NewTailMerger(task.ID, segDir, tsOutputPath, segments)
	download.tailMerger.Start(downloadCtx)

	m.mu.Lock()
	m.activeDownloads[task.ID] = download
	m.mu.Unlock()

	for _, seg := range segments {
		m.segQueue.Push(QueueItem{TaskID: task.ID, Segment: seg, Referer: referer})
	}
	m.segQueue.ProcessQueue()

	if err := m.segQueue.WaitForAllSegments(downloadCtx, task.ID); err != nil {
		return err
	}

	m.mu.Lock()
	if download.Status == StatusCancelled {
		m.mu.Unlock()
		m.logger.Info("Download cancelled",
			infra.LogContext{Extra: map[string]any{"taskId": task.ID}})
		return fmt.Errorf("download cancelled")
	}
	completedCount := download.CompletedCount()
	failedCount := download.FailedCount()
	totalSegments := download.TotalSegments
	m.mu.Unlock()

	m.logger.Info("Download phase completed",
		infra.LogContext{Extra: map[string]any{
			"taskId":  task.ID,
			"success": completedCount,
			"failed":  failedCount,
			"total":   totalSegments,
		}})

	if failedCount > 0 {
		m.mu.Lock()
		var details []string
		for idx, e := range download.FailedSegments {
			details = append(details, fmt.Sprintf("segment #%d: %s", idx, e.Error()))
		}
		m.mu.Unlock()
		return fmt.Errorf("incomplete download, %d segments failed out of %d: %s",
			failedCount, totalSegments, strings.Join(details, "; "))
	}

	successSet := make(map[int]bool, len(download.CompletedSegments))
	for idx := range download.CompletedSegments {
		successSet[idx] = true
	}

	zero := 0.0
	retryOpts := DefaultMergeRetryOptions(tsOutputPath, segDir)
	retryOpts.BatchOpts = SegmentBatchOptions{
		Concurrency: m.GetMaxConcurrent(),
		MaxRetries:  m.maxRetries,
		SegDir:      segDir,
		Referer:     referer,
	}
	retryOpts.ExpectedDuration = SumSegmentDurations(segments)
	// Persist the accumulated downloaded size now: SSE downloadedBytes is
	// memory-only, so REST refetches during merge/transcode would otherwise
	// read a zero size column.
	var downloadedBytes int64
	if m.tracker != nil {
		downloadedBytes = m.tracker.GetSummary(task.ID).DownloadedBytes
	}
	if err := m.state.Transition(downloadCtx, task.ID, taskstate.Update{
		Status:   taskstate.StatusMerging,
		Progress: &zero,
		Set:      map[string]any{"file_size": downloadedBytes},
	}); err != nil {
		return fmt.Errorf("enter merge phase: %w", err)
	}
	var mergeEmitMu sync.Mutex
	var lastMergeEmit time.Time
	retryOpts.OnProgress = func(done, total int) {
		if total <= 0 {
			return
		}
		pct := float64(done) / float64(total) * 100
		// Persist the merge percentage (throttled inside the store) so a
		// page refresh reads real progress instead of a stale 0.
		m.state.SetPhaseProgress(task.ID, taskstate.StatusMerging, pct)
		mergeEmitMu.Lock()
		now := time.Now()
		if done < total && now.Sub(lastMergeEmit) < 200*time.Millisecond {
			mergeEmitMu.Unlock()
			return
		}
		lastMergeEmit = now
		mergeEmitMu.Unlock()
		// The segment field must keep reporting DOWNLOADED segments: the
		// frontend renders it as the x/y capsule, which would otherwise
		// reset while the merge loop reuses it as a merged-file counter.
		m.emitProgress(task.ID, pct, completedCount, totalSegments, "merging", "")
	}
	retryOpts.OnRetry = func(attempt, count int, reason string) {
		m.logger.Info("Merge retry triggered",
			infra.LogContext{Extra: map[string]any{
				"taskId":  task.ID,
				"attempt": attempt,
				"count":   count,
				"reason":  reason,
			}})
		m.emitProgress(task.ID, 0, completedCount, totalSegments, "merging", "")
	}

	// Tail-merge fast path: if the merger published the full output while
	// segments downloaded, the first round skips the merge and goes straight
	// to validation. PremergeCheck is consulted exactly once — a validation
	// failure drops the premade file and later rounds take the full-merge
	// path with targeted redownloads.
	premergeUsed := false
	retryOpts.PremergeCheck = func() bool {
		if premergeUsed || download.tailMerger == nil {
			return false
		}
		premergeUsed = true
		if download.tailMerger.Complete() {
			m.logger.Info("Tail merge published merged output during download",
				infra.LogContext{Extra: map[string]any{
					"taskId": task.ID,
					"segs":   len(segments),
				}})
			return true
		}
		download.tailMerger.Discard()
		return false
	}

	if err := MergeRetryLoop(downloadCtx, segments, successSet, retryOpts); err != nil {
		return fmt.Errorf("merge retry loop: %w", err)
	}

	m.logger.Info("Merge validation passed",
		infra.LogContext{Extra: map[string]any{
			"taskId":   task.ID,
			"segments": len(segments),
		}})

	// From the transcode boundary on, the `progress` field carries the
	// TRANSCODE percentage rather than the download percentage, so the
	// frontend restarts its progress bar instead of showing a stale 100%.
	// The transition also emits the status event; SetPhaseProgress keeps
	// the row's progress column fresh (throttled) so refreshes and REST
	// polls read live transcode percentage instead of a stale 0.
	if err := m.state.Transition(downloadCtx, task.ID, taskstate.Update{
		Status:   taskstate.StatusTranscoding,
		Progress: &zero,
		Set:      map[string]any{"error_msg": ""},
	}); err != nil {
		return fmt.Errorf("enter transcode phase: %w", err)
	}

	m.logger.Info("Transcoding to MP4",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"gpu":    m.gpuTranscode,
		}})

	transcodeCtx, transcodeCancel := context.WithTimeout(downloadCtx, 30*time.Minute)
	defer transcodeCancel()

	pipeline := NewDefaultPipeline(m.gpuTranscode, m.forceGPUType)
	pipelineData := NewPipelineData(transcodeCtx, segDir, mp4OutputPath, segments)
	pipelineData.MergedInputPath = tsOutputPath
	pipelineData.ExpectedDuration = retryOpts.ExpectedDuration
	pipelineData.OnProgress = func(pct float64) {
		m.state.SetPhaseProgress(task.ID, taskstate.StatusTranscoding, pct)
		m.emitProgress(task.ID, pct, completedCount, totalSegments, "transcoding", "")
	}
	if _, err := pipeline.ExecuteWithCleanup(transcodeCtx, pipelineData); err != nil {
		if ctxErr := transcodeCtx.Err(); ctxErr != nil {
			// A child deadline with a live parent is the 30-minute transcode
			// cap: surface it as a real failure (handleDownloadError
			// classifies by error identity, so the message must wrap
			// DeadlineExceeded without the parent being cancelled).
			if errors.Is(ctxErr, context.DeadlineExceeded) && downloadCtx.Err() == nil {
				return fmt.Errorf("transcode timed out: %w", ctxErr)
			}
			return ctxErr
		}
		return fmt.Errorf("transcode pipeline: %w", err)
	}
	if err := downloadCtx.Err(); err != nil {
		return err
	}

	m.logger.Info("MP4 transcoding completed",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"path":   mp4OutputPath,
		}})

	os.Remove(tsOutputPath)

	// Enter the probe window as a real persisted status instead of the old
	// transcoding+progress>=100 convention, so every consumer (SSE, REST,
	// page refresh) sees it without deriving it.
	complete := 100.0
	// The final MP4 replaces the segment sum in file_size once it exists.
	probeSet := map[string]any{}
	if info, err := os.Stat(mp4OutputPath); err == nil && info.Size() > 0 {
		probeSet["file_size"] = info.Size()
	}
	if err := m.state.Transition(downloadCtx, task.ID, taskstate.Update{
		Status:   taskstate.StatusProbing,
		Progress: &complete,
		Set:      probeSet,
	}); err != nil {
		return fmt.Errorf("enter probe phase: %w", err)
	}
	// A pause or cancel that landed during the transcode/probe window must
	// abort here — the completion write below is otherwise unconditional.
	if err := downloadCtx.Err(); err != nil {
		return err
	}

	probeCtx, probeCancel := context.WithTimeout(downloadCtx, 15*time.Second)
	metadata, _ := ProbeVideoMetadata(probeCtx, mp4OutputPath)
	probeCancel()
	// A pause or cancel landing INSIDE the probe window must abort before
	// the completion write — otherwise the user's paused/cancelled status
	// is silently overwritten by 'completed'.
	if err := downloadCtx.Err(); err != nil {
		return err
	}
	durationSeconds := metadata.Duration
	resolution := metadata.Resolution

	fileSize := int64(0)
	if info, err := os.Stat(mp4OutputPath); err == nil {
		fileSize = info.Size()
	}
	durationMinutes := math.Round(durationSeconds/60*10) / 10

	m.logger.Info("Video info probed",
		infra.LogContext{Extra: map[string]any{
			"taskId":     task.ID,
			"resolution": resolution,
			"duration":   durationMinutes,
			"fileSize":   fileSize,
		}})

	if err := m.upsertVideoInfo(task, mp4OutputPath, fileSize, durationMinutes, resolution); err != nil {
		m.logger.Warn("Failed to upsert video info",
			infra.LogContext{Extra: map[string]any{
				"taskId": task.ID,
				"error":  err.Error(),
			}})
	}

	// Emit task:metadata so SSE clients receive the final title and
	// actors as soon as the download completes, without waiting for the
	// polling fallback.
	if m.eventBus != nil {
		m.eventBus.Emit("task:metadata", map[string]any{
			"taskId":       task.ID,
			"taskType":     "video",
			"GalleryTitle": task.Title,
			"Person":       strings.Join(task.Actors, ", "),
			"Tags":         task.Tags,
			"Actors":       task.Actors,
		})
	}

	completeCtx, completeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer completeCancel()
	if err := m.state.Transition(completeCtx, task.ID, taskstate.Update{
		Status:   taskstate.StatusCompleted,
		Progress: &complete,
		Set:      map[string]any{"file_path": mp4OutputPath, "format": "mp4"},
	}); err != nil {
		return fmt.Errorf("persist completed download: %w", err)
	}

	CleanupSegments(segDir)

	if m.eventBus != nil {
		m.eventBus.Emit("task:completed", map[string]any{
			"taskId":   task.ID,
			"taskType": "video",
			"title":    task.Title,
		})
	}

	m.logger.Info("Download task completed",
		infra.LogContext{Extra: map[string]any{"taskId": task.ID}})

	return nil
}

func (m *DownloadManager) handleDownloadError(ctx context.Context, task DownloadTaskInput, dlErr error) {
	errMsg := dlErr.Error()
	m.logger.Error("Download failed",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"error":  errMsg,
		}})

	// A conflict means another writer (user pause/cancel, DAG status sync)
	// took the row over while the pipeline was running: that writer owns
	// the outcome, so neither the retry scheduler nor a failed write may
	// fight it.
	var conflict *taskstate.ConflictError
	if errors.As(dlErr, &conflict) {
		m.logger.Info("Pipeline error dropped: row taken over by another status writer",
			infra.LogContext{Extra: map[string]any{
				"taskId": task.ID,
				"row":    conflict.Current,
			}})
		return
	}

	m.segQueue.RemoveByTask(task.ID)

	m.mu.Lock()
	retryCount := m.taskRetries[task.ID]
	// Only a cancellation of the pipeline's own context is a user/pause/stop
	// action. A child-context deadline (the 30-minute transcode cap) with a
	// live parent is a genuine failure and must reach the retry/failed paths
	// below — treating DeadlineExceeded as "cancelled" here used to swallow
	// the timeout and strand the row in transcoding forever.
	cancelled := ctx.Err() != nil || errors.Is(dlErr, context.Canceled)
	canRetry := retryCount < maxTaskRetries && !cancelled && !strings.Contains(errMsg, "cancelled")
	m.mu.Unlock()

	if cancelled {
		m.mu.Lock()
		delete(m.taskRetries, task.ID)
		m.mu.Unlock()
		return
	}

	if canRetry {
		m.mu.Lock()
		m.taskRetries[task.ID] = retryCount + 1
		m.mu.Unlock()

		delayMs := time.Duration(retryCount+1) * 10 * time.Second
		m.logger.Info("Auto-retry scheduled",
			infra.LogContext{Extra: map[string]any{
				"taskId": task.ID,
				"delay":  delayMs.String(),
				"retry":  retryCount + 1,
				"max":    maxTaskRetries,
			}})

		shortErr := errMsg
		if len(shortErr) > 200 {
			shortErr = shortErr[:200] + "..."
		}

		retryCtx, retryCancel := context.WithTimeout(context.Background(), 5*time.Second)
		zero := 0.0
		err := m.state.Transition(retryCtx, task.ID, taskstate.Update{
			Status:   taskstate.StatusPending,
			Progress: &zero,
			Set: map[string]any{
				"error_msg": fmt.Sprintf("Auto-retrying (%d/%d): %s", retryCount+1, maxTaskRetries, shortErr),
			},
		})
		retryCancel()
		if err != nil {
			m.logger.Warn("Auto-retry status write skipped",
				infra.LogContext{Extra: map[string]any{
					"taskId": task.ID,
					"error":  err.Error(),
				}})
			return
		}

		go func() {
			time.Sleep(delayMs)

			checkCtx, checkCancel := context.WithTimeout(context.Background(), 5*time.Second)
			var status string
			err := m.db.QueryRow(checkCtx,
				"SELECT status FROM download_tasks WHERE id = ?", task.ID).Scan(&status)
			checkCancel()

			if err != nil || status == "cancelled" || status == "paused" {
				m.mu.Lock()
				delete(m.taskRetries, task.ID)
				m.mu.Unlock()
				m.logger.Info("Retry cancelled ??task status changed",
					infra.LogContext{Extra: map[string]any{
						"taskId": task.ID,
						"status": status,
					}})
				return
			}

			m.logger.Info("Starting auto-retry",
				infra.LogContext{Extra: map[string]any{"taskId": task.ID}})
			if err := m.StartDownload(context.Background(), task); err != nil {
				m.logger.Error("Auto-retry failed",
					infra.LogContext{Extra: map[string]any{
						"taskId": task.ID,
						"error":  err.Error(),
					}})
			}

			// Do NOT delete the retry counter here — that resets it to 0
			// on every retry and causes an infinite loop.
		}()
		return
	}

	m.mu.Lock()
	delete(m.taskRetries, task.ID)
	m.mu.Unlock()

	if m.eventBus != nil {
		m.eventBus.Emit("task:failed", map[string]any{
			"taskId":   task.ID,
			"taskType": "video",
			"error":    errMsg,
		})
	}

	failCtx, failCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer failCancel()
	if err := m.state.Transition(failCtx, task.ID, taskstate.Update{
		Status: taskstate.StatusFailed,
		Set:    map[string]any{"error_msg": errMsg},
	}); err != nil {
		m.logger.Warn("Failed-status write skipped",
			infra.LogContext{Extra: map[string]any{
				"taskId": task.ID,
				"error":  err.Error(),
			}})
	}
}

// PauseDownload pauses an active download by setting its status and
// removing pending segments from the queue.
func (m *DownloadManager) PauseDownload(taskID int) error {
	m.mu.Lock()
	download, ok := m.activeDownloads[taskID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("task %d is not active", taskID)
	}
	download.Status = StatusPaused
	download.Cancel()
	totalSegments := download.TotalSegments
	completedCount := download.CompletedCount()
	m.mu.Unlock()

	m.segQueue.RemoveByTask(taskID)

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		// The row may already be terminal (the pipeline finished between the
		// active-download check and here); a conflict just means the finish
		// won and is logged by the store.
		if err := m.state.Transition(ctx, taskID, taskstate.Update{Status: taskstate.StatusPaused}); err != nil {
			m.logger.Warn("Pause status write skipped",
				infra.LogContext{Extra: map[string]any{
					"taskId": taskID,
					"error":  err.Error(),
				}})
		}
	}()

	progress := float64(completedCount) / float64(totalSegments) * 100
	m.emitProgress(taskID, progress, completedCount, totalSegments, "paused", "")
	return nil
}

// ResumeDownload re-queues incomplete segments for a paused download
// and resumes queue processing.
func (m *DownloadManager) ResumeDownload(taskID int) error {
	m.mu.Lock()
	download, ok := m.activeDownloads[taskID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("task %d is not active", taskID)
	}
	download.Status = StatusActive
	totalSegments := download.TotalSegments
	completedCount := download.CompletedCount()
	referer := download.Referer
	m.mu.Unlock()

	m.mu.Lock()
	if !m.segQueue.HasPendingLocked(taskID) {
		for _, seg := range download.Segments {
			if !download.CompletedSegments[seg.Index] {
				m.segQueue.pushLocked(QueueItem{TaskID: taskID, Segment: seg, Referer: referer})
			}
		}
	}
	m.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.state.Transition(ctx, taskID, taskstate.Update{Status: taskstate.StatusDownloading}); err != nil {
			m.logger.Warn("Resume status write skipped",
				infra.LogContext{Extra: map[string]any{
					"taskId": taskID,
					"error":  err.Error(),
				}})
		}
	}()

	m.segQueue.ProcessQueue()

	progress := float64(completedCount) / float64(totalSegments) * 100
	m.emitProgress(taskID, progress, completedCount, totalSegments, "downloading", "")
	return nil
}

func (m *DownloadManager) cancelDownload(ctx context.Context, taskID int, persist, forbid bool) error {
	m.mu.Lock()
	run := m.runningTasks[taskID]
	download := m.activeDownloads[taskID]
	if forbid {
		m.forbiddenTasks[taskID] = struct{}{}
	}
	if run != nil {
		run.cancel()
	}
	if download != nil {
		download.Status = StatusCancelled
		download.Cancel()
	}
	delete(m.taskRetries, taskID)
	m.mu.Unlock()

	m.segQueue.RemoveByTask(taskID)
	if run != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-run.done:
		}
	} else if download != nil && download.done != nil {
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-download.done:
			timer.Stop()
		case <-timer.C:
			return fmt.Errorf("task %d did not stop in time", taskID)
		}
	}

	m.mu.Lock()
	if m.activeDownloads[taskID] == download {
		delete(m.activeDownloads, taskID)
	}
	m.mu.Unlock()
	if download != nil {
		CleanupSegments(download.SegDir)
	}

	if !persist {
		return nil
	}
	updateCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := m.state.Transition(updateCtx, taskID, taskstate.Update{
		Status: taskstate.StatusCancelled,
		Set:    map[string]any{"error_msg": ""},
	}); err != nil {
		// The row moved on its own (finished / already terminal): not a
		// cancel failure worth reporting.
		m.logger.Warn("Cancel status write skipped",
			infra.LogContext{Extra: map[string]any{
				"taskId": taskID,
				"error":  err.Error(),
			}})
		return nil
	}
	if m.eventBus != nil {
		m.eventBus.Emit("task:cancelled", map[string]any{
			"taskId":   taskID,
			"taskType": "video",
		})
	}
	return nil
}

func (m *DownloadManager) CancelDownload(taskID int) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = m.cancelDownload(ctx, taskID, true, false)
}

func (m *DownloadManager) CancelDownloadAndWait(ctx context.Context, taskID int) error {
	return m.cancelDownload(ctx, taskID, false, true)
}

func (m *DownloadManager) StopDownloadForRestart(ctx context.Context, taskID int) error {
	return m.cancelDownload(ctx, taskID, false, false)
}

func (m *DownloadManager) AllowDownload(taskID int) {
	m.mu.Lock()
	delete(m.forbiddenTasks, taskID)
	m.mu.Unlock()
}

// IsDownloading reports whether a task is currently in the active
// downloads map.
func (m *DownloadManager) IsDownloading(taskID int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.activeDownloads[taskID]
	return ok
}

func (m *DownloadManager) GetQueueLength() int {
	return m.segQueue.GetQueueLength()
}

func (m *DownloadManager) GetConcurrentCount() int {
	return m.segQueue.GetConcurrentCount()
}

func waitForDownloadDone(download *ActiveDownload, timeout time.Duration) {
	if download == nil || download.done == nil {
		return
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-download.done:
	case <-timer.C:
	}
}

// all active tasks as cancelled in the database.
func (m *DownloadManager) Stop() {
	m.segQueue.Stop()

	m.mu.Lock()
	m.taskRetries = make(map[int]int)

	var updates []*ActiveDownload
	for _, download := range m.activeDownloads {
		download.Status = StatusCancelled
		download.Cancel()
		updates = append(updates, download)
	}
	m.activeDownloads = make(map[int]*ActiveDownload)
	m.mu.Unlock()

	var wg sync.WaitGroup
	for _, download := range updates {
		download := download
		wg.Add(1)
		go func() {
			defer wg.Done()
			waitForDownloadDone(download, 5*time.Second)
			CleanupSegments(download.SegDir)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := m.state.Transition(ctx, download.TaskID, taskstate.Update{
				Status: taskstate.StatusCancelled,
				Set:    map[string]any{"error_msg": "Service shutdown, task cancelled"},
			}); err != nil {
				m.logger.Warn("Shutdown cancel status write skipped",
					infra.LogContext{Extra: map[string]any{
						"taskId": download.TaskID,
						"error":  err.Error(),
					}})
			} else if m.eventBus != nil {
				// cancelDownload emits the same event: without it the DAG
				// executor's waitTerminal only learns of the cancellation
				// through its 5s DB poll, stretching every shutdown drain.
				m.eventBus.Emit("task:cancelled", map[string]any{
					"taskId":   download.TaskID,
					"taskType": "video",
				})
			}
		}()
	}
	wg.Wait()
}

// marshalOrEmpty serializes a string slice to JSON, returning "[]" for
// nil slices instead of "null" (the default json.Marshal(nil) output).
// This prevents the string "null" from being stored in database columns
// that expect JSON arrays.
func marshalOrEmpty(s []string) []byte {
	if s == nil {
		return []byte("[]")
	}
	b, _ := json.Marshal(s)
	return b
}

func (m *DownloadManager) upsertVideoInfo(task DownloadTaskInput, outputPath string, fileSize int64, durationMinutes float64, resolution string) error {
	tagsJSON := marshalOrEmpty(task.Tags)
	actorsJSON := marshalOrEmpty(task.Actors)
	categoriesJSON := marshalOrEmpty(task.Categories)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := m.db.Exec(ctx, `
		INSERT INTO video_infos (task_id, title, source_url, file_size, duration, tags, actors, categories, director, resolution)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (task_id) DO UPDATE SET
			title = CASE WHEN COALESCE(EXCLUDED.title, '') != '' THEN EXCLUDED.title ELSE video_infos.title END,
			source_url = CASE WHEN COALESCE(EXCLUDED.source_url, '') != '' THEN EXCLUDED.source_url ELSE video_infos.source_url END,
			file_size = EXCLUDED.file_size,
			duration = EXCLUDED.duration,
			tags = CASE WHEN EXCLUDED.tags != '[]' AND EXCLUDED.tags != '' THEN EXCLUDED.tags ELSE video_infos.tags END,
			actors = CASE WHEN EXCLUDED.actors != '[]' AND EXCLUDED.actors != '' THEN EXCLUDED.actors ELSE video_infos.actors END,
			categories = CASE WHEN EXCLUDED.categories != '[]' AND EXCLUDED.categories != '' THEN EXCLUDED.categories ELSE video_infos.categories END,
			director = CASE WHEN COALESCE(EXCLUDED.director, '') != '' THEN EXCLUDED.director ELSE video_infos.director END,
			resolution = EXCLUDED.resolution
	`, task.ID, task.Title, task.PageURL, fileSize, durationMinutes,
		string(tagsJSON), string(actorsJSON), string(categoriesJSON),
		task.Director, resolution)

	return err
}
