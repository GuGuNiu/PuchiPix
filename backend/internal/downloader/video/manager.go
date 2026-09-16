package video

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/taskprogress"
	"backend/internal/urlutil"
)

// ProgressMessage is the wire format for download progress updates
// sent to SSE/WebSocket clients.
type ProgressMessage struct {
	Type     string  `json:"type"`
	TaskID   int     `json:"task_id"`
	Progress float64 `json:"progress"`
	Speed    string  `json:"speed,omitempty"`
	Segment  int     `json:"segment"`
	Total    int     `json:"total"`
	Status   string  `json:"status"`
}

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
	// UseStreamingMerge 是否使用流式合并（IndexBuffer + StreamMerger），默认 false
	UseStreamingMerge bool
	// StreamingMergeThreshold 流式合并的内存阈值（字节），超过此值使用磁盘模式，默认 100MB
	StreamingMergeThreshold int64
}

// DefaultManagerConfig returns sensible defaults.
func DefaultManagerConfig() ManagerConfig {
	return ManagerConfig{
		MaxRetries:              5,
		DownloadPath:            "../data/videos",
		SegmentsPath:            "../data/segments",
		MaxConcurrent:           3,
		GPUTranscode:            false,
		ForceGPUType:            "",
		UseStreamingMerge:       false, // 默认关闭，渐进式启用
		StreamingMergeThreshold: 100 * 1024 * 1024, // 100MB
	}
}

const maxTaskRetries = 2

type DownloadManager struct {
	mu              sync.Mutex
	cond            *sync.Cond
	callbackMu      sync.RWMutex
	progressCallback func(ProgressMessage)

	db          *db.Database
	eventBus    *infra.EventBus
	maxRetries  int
	downloadPath string
	segmentsPath string
	maxConcurrent int
	gpuTranscode bool
	forceGPUType string
	tracker       *taskprogress.VideoProgressTracker
	// 流式合并配置
	useStreamingMerge       bool
	streamingMergeThreshold int64

	activeDownloads map[int]*ActiveDownload
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
		db:             database,
		eventBus:       eventBus,
		maxRetries:     cfg.MaxRetries,
		downloadPath:   cfg.DownloadPath,
		segmentsPath:   cfg.SegmentsPath,
		maxConcurrent:  cfg.MaxConcurrent,
		gpuTranscode:   cfg.GPUTranscode,
		forceGPUType:   cfg.ForceGPUType,
		activeDownloads: make(map[int]*ActiveDownload),
		taskRetries:    make(map[int]int),
		logger:         m3u8Logger,
		// 流式合并配置
		useStreamingMerge:       cfg.UseStreamingMerge,
		streamingMergeThreshold: cfg.StreamingMergeThreshold,
	}
	m.cond = sync.NewCond(&m.mu)

	m.segQueue = NewSegmentQueue(&m.mu, m.cond, m.activeDownloads, SegmentQueueConfig{
		MaxRetries: cfg.MaxRetries,
		GetMaxConcurrent: func() int {
			return m.maxConcurrent
		},
		OnProgress: m.emitProgress,
		OnSegmentUpdate: m.handleSegmentUpdate,
		OnSegmentReady: m.handleSegmentReady,
		DB:         database,
		Logger:     m.logger,
	})

	// DB values override ManagerConfig defaults.
	m.LoadGPUTranscodeFromDB()

	return m
}

// SetProgressCallback registers a callback invoked on every progress
// update, typically wired to an SSE or WebSocket sender.
func (m *DownloadManager) SetProgressCallback(cb func(ProgressMessage)) {
	m.callbackMu.Lock()
	m.progressCallback = cb
	m.callbackMu.Unlock()
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
	m.mu.Lock()
	m.maxConcurrent = n
	m.mu.Unlock()
	m.logger.Info("TS segment concurrency updated", "newMax", n)
}

// GetMaxConcurrent returns the current TS segment concurrency limit.
func (m *DownloadManager) GetMaxConcurrent() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.maxConcurrent
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
// This bridges the pipeline gap where the tracker was initialized but
// never connected to the download pipeline.
func (m *DownloadManager) SetTracker(t *taskprogress.VideoProgressTracker) {
	m.mu.Lock()
	m.tracker = t
	m.mu.Unlock()
}

// handleSegmentUpdate is the callback from SegmentQueue that bridges
// to VideoProgressTracker.UpdateSegment. It translates the
// completed/failed boolean into the tracker's status enum.
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

// handleSegmentReady 是分片下载完成并准备进行流式合并时的回调
// 当 UseStreamingMerge 启用时，将分片存储到对应任务的 StreamMerger 中
func (m *DownloadManager) handleSegmentReady(taskID, index int, filePath string, size int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	download, ok := m.activeDownloads[taskID]
	if !ok {
		return
	}

	// 如果启用了流式合并且该任务有 StreamMerger，则存储分片
	if download.streamMerger != nil {
		if err := download.streamMerger.StoreSegmentDisk(index, filePath, size); err != nil {
			m.logger.Warn("Failed to store segment to stream merger",
				infra.LogContext{Extra: map[string]any{
					"taskId": taskID,
					"index":  index,
					"error":  err.Error(),
				}})
		}
	}
}

func (m *DownloadManager) emitProgress(taskID int, progress float64, segment, total int, status, speed string) {
	rounded := math.Round(progress*100) / 100

	// Aggregate downloaded bytes from the segment tracker so the SSE
	// size column shows a live partial size during download (previously
	// only appeared after the MP4 merge via video_infos.file_size).
	var downloadedBytes int64
	if m.tracker != nil {
		downloadedBytes = m.tracker.GetSummary(taskID).DownloadedBytes
	}

	m.callbackMu.RLock()
	cb := m.progressCallback
	m.callbackMu.RUnlock()

	if cb != nil {
		cb(ProgressMessage{
			Type:     "progress",
			TaskID:   taskID,
			Progress: rounded,
			Speed:    speed,
			Segment:  segment,
			Total:    total,
			Status:   status,
		})
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
	m.mu.Lock()
	if _, exists := m.activeDownloads[task.ID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("task %d is already being downloaded", task.ID)
	}
	m.mu.Unlock()

	if task.M3U8URL == "" {
		return fmt.Errorf("no M3U8 URL for task %d", task.ID)
	}

	dbCtx, dbCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dbCancel()
	_, _ = m.db.Exec(dbCtx,
		"UPDATE download_tasks SET status = 'downloading', progress = 0, error_msg = '', completed_segments = 0 WHERE id = ?",
		task.ID)

	safeTitle := downloader.SanitizeFilename(task.Title)
	if safeTitle == "" {
		safeTitle = "untitled"
	}

	segDir := filepath.Join(m.segmentsPath, fmt.Sprintf("task_%d", task.ID))
	mp4OutputPath := filepath.Join(m.downloadPath, safeTitle+".mp4")
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
	// Many CDNs (e.g. 11yun.space used by Kanav) check the Referer header
	// and reject requests with a Referer from a non-whitelisted domain.
	// When the original page URL's domain is blocked by the CDN, we try
	// other known mirror domains from the site's configuration.
	var refererDomains []string
	if len(task.RefererDomains) > 0 {
		for _, d := range task.RefererDomains {
			// Skip the domain already used as the primary referer.
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

	// Clear the retry counter so a future task with the same ID starts fresh.
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
	if EnsurePlaylistFingerprint(segDir, segments) {
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
		m.tracker.RegisterSegments(task.ID, len(segments))
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
	download := &ActiveDownload{
		TaskID:            task.ID,
		Status:            StatusActive,
		ctx:               downloadCtx,
		cancel:            downloadCancel,
		Segments:          segments,
		CompletedSegments: make(map[int]bool),
		FailedSegments:    make(map[int]error),
		TotalSegments:     len(segments),
		SegDir:            segDir,
		OutputPath:        mp4OutputPath,
		StartTime:         time.Now(),
		LastProgressTime:  time.Now(),
		Referer:           referer,
	}

	// 初始化流式合并器（当配置启用时）。
	// 根据 M3U8 分片总大小自动选择内存模式或磁盘模式：
	//   - 预估总大小 < streamingMergeThreshold → MemoryMode（零磁盘 I/O）
	//   - 预估总大小 ≥ streamingMergeThreshold → DiskMode（恒定内存占用）
	// 预估大小基于分片数 × 平均分片大小（从 M3U8 元数据获取）。
	if m.useStreamingMerge {
		avgSegSize := estimateAvgSegmentSize(segments)
		bufMode := DetermineBufferMode(len(segments), avgSegSize)
		download.streamMerger = CreateStreamMergerForTask(task.ID, len(segments), segDir, bufMode)
		m.logger.Info("Streaming merge enabled for task",
			infra.LogContext{Extra: map[string]any{
				"taskId":  task.ID,
				"mode":    bufMode,
				"segs":    len(segments),
			}})
	}

	m.mu.Lock()
	m.activeDownloads[task.ID] = download
	m.mu.Unlock()

	firstScreenCount := max(2, int(math.Ceil(float64(len(segments))*0.1)))
	if firstScreenCount > len(segments) {
		firstScreenCount = len(segments)
	}

	firstScreen := segments[:firstScreenCount]
	remaining := segments[firstScreenCount:]

	for _, seg := range firstScreen {
		m.segQueue.Push(QueueItem{TaskID: task.ID, Segment: seg, Referer: referer})
	}
	m.segQueue.ProcessQueue()

	if err := m.segQueue.WaitForSegments(downloadCtx, task.ID, firstScreenCount); err != nil {
		return err
	}

	m.mu.Lock()
	if download.Status == StatusCancelled || download.Status == StatusPaused {
		m.mu.Unlock()
		return fmt.Errorf("download %s before remaining segments pushed", download.Status)
	}
	m.mu.Unlock()

	for _, seg := range remaining {
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
			"taskId":   task.ID,
			"success":  completedCount,
			"failed":   failedCount,
			"total":    totalSegments,
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

	retryOpts := DefaultMergeRetryOptions(tsOutputPath, segDir)
	retryOpts.BatchOpts = SegmentBatchOptions{
		Concurrency: m.maxConcurrent,
		MaxRetries:  m.maxRetries,
		Referer:     referer,
	}
	retryOpts.ExpectedDuration = SumSegmentDurations(segments)
	retryOpts.OnRetry = func(attempt, count int, reason string) {
		m.logger.Info("Merge retry triggered",
			infra.LogContext{Extra: map[string]any{
				"taskId":  task.ID,
				"attempt": attempt,
				"count":   count,
				"reason":  reason,
			}})
		// The SSE status field must stay within the task-status enum:
		// emitting "retry #N" leaked straight into the frontend status
		// pill as a raw string. The retry marker rides the (unused for
		// video) speed field instead; merge is still the download stage.
		m.emitProgress(task.ID, 100, completedCount, totalSegments,
			"downloading", fmt.Sprintf("merge retry #%d", attempt))
	}

	if err := MergeRetryLoop(downloadCtx, segments, successSet, retryOpts); err != nil {
		return fmt.Errorf("merge retry loop: %w", err)
	}

	m.logger.Info("Merge validation passed",
		infra.LogContext{Extra: map[string]any{
			"taskId":   task.ID,
			"segments": len(segments),
		}})

	// Phase progress resets at the transcode boundary: from here on the
	// SSE `progress` field carries the TRANSCODE percentage (0→100), not
	// the download percentage, so the frontend can restart its progress
	// bar in the transcoding stage instead of showing a stale 100%.
	// The old emitProgress(...,100,...) here raced with the frontend's
	// progress>=99 probing heuristic and mislabeled the whole transcode
	// phase as "probing" (探测中) before ffmpeg even started.
	//
	// The transcode phase must ALSO be persisted to download_tasks:
	// SSE is live-only, so a page refresh during a long transcode used to
	// read the stale DB row (status='downloading', progress=100) and
	// render a green "done" bar while ffmpeg was still running — the
	// purple merge-progress style never came back until the task
	// finished. Writing status='transcoding' here lets the REST path
	// (ComputeEffectiveStatus passes it through verbatim) restore the
	// same purple state the SSE stream showed.
	if m.db != nil {
		transcodeDbCtx, transcodeDbCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = m.db.Exec(transcodeDbCtx,
			"UPDATE download_tasks SET status = 'transcoding', progress = 0, error_msg = '' WHERE id = ?",
			task.ID)
		transcodeDbCancel()
	}
	m.emitProgress(task.ID, 0, completedCount, totalSegments, "transcoding", "")

	m.logger.Info("Transcoding to MP4",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"gpu":    m.gpuTranscode,
		}})

	// 使用可插拔 Pipeline 执行转码后处理。
	// 默认管道：concat → transcode，与旧逻辑行为一致。
	// 未来可通过 Pipeline.Use() 插入 WatermarkStep / MetadataStep
	// 而无需修改此调用点。
	// 如果启用了流式合并且 StreamMerger 仍有未消费的分片，
	// 将其作为 Pipeline 的输入；否则从 segDir 读取已下载的分片。
	transcodeCtx, transcodeCancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer transcodeCancel()

	pipeline := NewDefaultPipeline(m.gpuTranscode, m.forceGPUType)
	pipelineData := NewPipelineData(transcodeCtx, segDir, mp4OutputPath, segments)
	pipelineData.OnProgress = func(pct float64) {
		m.emitProgress(task.ID, pct, completedCount, totalSegments, "transcoding", "")
	}
	if _, err := pipeline.ExecuteWithCleanup(transcodeCtx, pipelineData); err != nil {
		return fmt.Errorf("transcode pipeline: %w", err)
	}

	m.logger.Info("MP4 transcoding completed",
		infra.LogContext{Extra: map[string]any{
			"taskId": task.ID,
			"path":   mp4OutputPath,
		}})

	os.Remove(tsOutputPath)

	m.emitProgress(task.ID, 100, completedCount, totalSegments, "transcoding", "")

	probeCtx, probeCancel := context.WithTimeout(context.Background(), 15*time.Second)
	durationSeconds, _ := ProbeDuration(probeCtx, mp4OutputPath)
	resolution, _ := ProbeResolution(probeCtx, mp4OutputPath)
	probeCancel()

	fileSize := int64(0)
	if info, err := os.Stat(mp4OutputPath); err == nil {
		fileSize = info.Size()
	}
	durationMinutes := math.Round(durationSeconds/60*10) / 10

	m.logger.Info("Video info probed",
		infra.LogContext{Extra: map[string]any{
			"taskId":    task.ID,
			"resolution": resolution,
			"duration":   durationMinutes,
			"fileSize":  fileSize,
		}})

	if err := m.upsertVideoInfo(task, mp4OutputPath, fileSize, durationMinutes, resolution); err != nil {
		m.logger.Warn("Failed to upsert video info",
			infra.LogContext{Extra: map[string]any{
				"taskId": task.ID,
				"error":  err.Error(),
			}})
	}

	// Emit task:metadata so SSE clients receive the final title and
	// actors as soon as the download completes, without waiting for
	// the 10s polling fallback.
	if m.eventBus != nil {
		m.eventBus.Emit("task:metadata", map[string]any{
			"taskId":       task.ID,
			"taskType":     "video",
			"GalleryTitle": task.Title,
			"Person":       strings.Join(task.Actors, ", "),
		})
	}

	completeCtx, completeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer completeCancel()
	_, _ = m.db.Exec(completeCtx,
		"UPDATE download_tasks SET status = 'completed', progress = 100, file_path = ?, format = 'mp4' WHERE id = ?",
		mp4OutputPath, task.ID)

	CleanupSegments(segDir)

	m.emitProgress(task.ID, 100, totalSegments, totalSegments, "completed", "")

	if m.eventBus != nil {
		m.eventBus.Emit("task:completed", map[string]any{
			"taskId": task.ID,
			"title":  task.Title,
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

	m.segQueue.RemoveByTask(task.ID)

	m.mu.Lock()
	retryCount := m.taskRetries[task.ID]
	canRetry := retryCount < maxTaskRetries && !strings.Contains(errMsg, "cancelled")
	m.mu.Unlock()

	if canRetry {
		m.mu.Lock()
		m.taskRetries[task.ID] = retryCount + 1
		m.mu.Unlock()

		delayMs := time.Duration(retryCount+1) * 10 * time.Second
		m.logger.Info("Auto-retry scheduled",
			infra.LogContext{Extra: map[string]any{
				"taskId":  task.ID,
				"delay":   delayMs.String(),
				"retry":   retryCount + 1,
				"max":     maxTaskRetries,
			}})

		shortErr := errMsg
		if len(shortErr) > 200 {
			shortErr = shortErr[:200] + "..."
		}

		retryCtx, retryCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = m.db.Exec(retryCtx,
			"UPDATE download_tasks SET status = 'pending', progress = 0, error_msg = ? WHERE id = ?",
			fmt.Sprintf("Auto-retrying (%d/%d): %s", retryCount+1, maxTaskRetries, shortErr), task.ID)
		retryCancel()

		m.emitProgress(task.ID, 0, 0, 0, "pending", "")

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
	_, _ = m.db.Exec(failCtx,
		"UPDATE download_tasks SET status = 'failed', error_msg = ? WHERE id = ?",
		errMsg, task.ID)

	m.emitProgress(task.ID, 0, 0, 0, "failed", "")
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
		_, _ = m.db.Exec(ctx,
			"UPDATE download_tasks SET status = 'paused' WHERE id = ?", taskID)
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
		_, _ = m.db.Exec(ctx,
			"UPDATE download_tasks SET status = 'downloading' WHERE id = ?", taskID)
	}()

	m.segQueue.ProcessQueue()

	progress := float64(completedCount) / float64(totalSegments) * 100
	m.emitProgress(taskID, progress, completedCount, totalSegments, "downloading", "")
	return nil
}

// CancelDownload marks a download as cancelled, cleans up its segments,
// and removes it from active tracking.
func (m *DownloadManager) CancelDownload(taskID int) {
	m.mu.Lock()
	download, ok := m.activeDownloads[taskID]
	if ok {
		download.Status = StatusCancelled
		download.Cancel()
	}
	m.mu.Unlock()

	m.mu.Lock()
	delete(m.taskRetries, taskID)
	m.mu.Unlock()

	m.segQueue.RemoveByTask(taskID)

	if download != nil {
		CleanupSegments(download.SegDir)
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = m.db.Exec(ctx,
			"UPDATE download_tasks SET status = 'cancelled' WHERE id = ?", taskID)
	}()

	m.emitProgress(taskID, 0, 0, 0, "cancelled", "")

	if m.eventBus != nil {
		m.eventBus.Emit("task:cancelled", map[string]any{
			"taskId":   taskID,
			"taskType": "video",
		})
	}

	m.mu.Lock()
	delete(m.activeDownloads, taskID)
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

// GetQueueLength returns the number of segments pending in the queue.
func (m *DownloadManager) GetQueueLength() int {
	return m.segQueue.GetQueueLength()
}

// GetConcurrentCount returns the number of goroutines currently
// downloading segments.
func (m *DownloadManager) GetConcurrentCount() int {
	return m.segQueue.GetConcurrentCount()
}

// Stop halts all downloads, cleans up segment directories, and marks
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
			CleanupSegments(download.SegDir)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = m.db.Exec(ctx,
				"UPDATE download_tasks SET status = 'cancelled', error_msg = 'Service shutdown, task cancelled' WHERE id = ?",
				download.TaskID)
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
			source_url = EXCLUDED.source_url,
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

// estimateAvgSegmentSize 估算 M3U8 分片的平均字节大小。
// M3U8 分片通常为 2–10 秒的流媒体内容，按典型 HLS 码率
// 1–5 Mbps 估算，取中间值 ~2 Mbps (250 KB/s) 作为默认码率。
// 此估算仅用于选择 IndexBuffer 的存储模式（内存 vs 磁盘），
// 不影响实际下载或文件大小准确性。
func estimateAvgSegmentSize(segments []M3U8Segment) int64 {
	if len(segments) == 0 {
		return 0
	}
	const defaultBitrateBytesPerSec = 250 * 1024 // ~2 Mbps → 250 KB/s
	var totalDuration float64
	for _, seg := range segments {
		if seg.Duration > 0 {
			totalDuration += seg.Duration
		}
	}
	if totalDuration == 0 {
		return int64(5 * defaultBitrateBytesPerSec)
	}
	avgDuration := totalDuration / float64(len(segments))
	return int64(avgDuration * defaultBitrateBytesPerSec)
}



