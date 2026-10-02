package executors

import (
	"context"
	"fmt"
	"time"

	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/taskprogress"
)

// StatusQueryFn queries the current status and error message of a video
// download task from the database. Returns (status, errorMsg, found).
type StatusQueryFn func(ctx context.Context, taskID int) (status string, errMsg string, found bool)

// TaskLoaderFn loads a video download task from the database and returns
// a fully populated DownloadTaskInput ready for StartDownload. If the
// M3U8 URL is not yet known, the loader should scrape the page URL to
// discover it before returning.
type TaskLoaderFn func(ctx context.Context, taskID int) (video.DownloadTaskInput, error)

// VideoDownloadExecutor bridges the legacy DownloadManager into the
// DAG executor system, enabling video download tasks to be scheduled
// through the DAG orchestrator with proper slot pool concurrency
// control instead of bypassing the scheduler entirely.
type VideoDownloadExecutor struct {
	logger        *infra.Logger
	downloadMgr   *video.DownloadManager
	statusQueryFn StatusQueryFn
	taskLoaderFn  TaskLoaderFn
	tracker       *taskprogress.VideoProgressTracker
	eventBus      *infra.EventBus
}

// NewVideoDownloadExecutor creates a video download executor that
// wraps the DownloadManager for DAG-compatible execution.
//
// taskLoaderFn is called at the start of Execute to load the full
// DownloadTaskInput (M3U8URL, Title, PageURL, etc.) from the database.
// If M3U8URL is empty, the loader should scrape the page to discover it.
// eventBus carries the DownloadManager's terminal task:completed /
// task:failed / task:cancelled events; when nil the executor falls back to
// database polling only.
func NewVideoDownloadExecutor(dm *video.DownloadManager, statusFn StatusQueryFn, taskLoaderFn TaskLoaderFn, tracker *taskprogress.VideoProgressTracker, eventBus *infra.EventBus) *VideoDownloadExecutor {
	return &VideoDownloadExecutor{
		logger:        infra.NewLogger("VideoDownloadExecutor"),
		downloadMgr:   dm,
		statusQueryFn: statusFn,
		taskLoaderFn:  taskLoaderFn,
		tracker:       tracker,
		eventBus:      eventBus,
	}
}

// Key returns the executor routing key, matching
// DagNodeDefinition.Executor in video DAG definitions.
func (e *VideoDownloadExecutor) Key() string { return "video:download" }

// Execute loads the task details, starts the download via DownloadManager
// (in a goroutine since StartDownload is blocking), and waits for the
// terminal outcome via EventBus events with a slow DB poll as the safety net.
func (e *VideoDownloadExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	taskID, ok := getIntFromConfig(node.Config, "taskId")
	if !ok {
		return false, fmt.Errorf("video executor: no taskId in config")
	}

	if e.downloadMgr == nil {
		e.logger.Warn("DownloadManager not available, simulating success", "nodeId", node.NodeID)
		return true, nil
	}

	// Load the full task details (M3U8URL, Title, PageURL, etc.) from DB.
	// If M3U8URL is empty, the loader scrapes the page to discover it.
	var task video.DownloadTaskInput
	if e.taskLoaderFn != nil {
		var err error
		task, err = e.taskLoaderFn(ctx, taskID)
		if err != nil {
			e.logger.Error("Failed to load video task", err, "nodeId", node.NodeID, "taskId", taskID)
			return false, fmt.Errorf("video executor: load task %d: %w", taskID, err)
		}
	} else {
		// Fallback: only ID is known; StartDownload will likely fail.
		task = video.DownloadTaskInput{ID: taskID}
	}

	e.logger.Info("Starting video download via DAG slot",
		"nodeId", node.NodeID, "taskId", taskID,
		"m3u8Url", task.M3U8URL, "title", task.Title)

	// StartDownload blocks until the download completes or fails.
	// Run it in a goroutine and wait for the outcome.
	go func() {
		if err := e.downloadMgr.StartDownload(ctx, task); err != nil {
			e.logger.Error("StartDownload returned error", err,
				"nodeId", node.NodeID, "taskId", taskID)
		}
	}()

	return e.waitTerminal(ctx, taskID)
}

// waitTerminal resolves the task's terminal status. Terminal EventBus events
// from the DownloadManager resolve promptly (the old design busy-polled the
// DB every second); a slow DB poll remains as the safety net for terminal
// writes that bypass the EventBus — notably the DAG terminal guard rail,
// which heals the row via raw SQL without emitting an event.
func (e *VideoDownloadExecutor) waitTerminal(ctx context.Context, taskID int) (bool, error) {
	type terminalEvent struct{ status, errMsg string }
	events := make(chan terminalEvent, 8)

	var unsubs []func()
	if e.eventBus != nil {
		// Subscribed BEFORE the download goroutine starts, so no terminal
		// event can slip past. Payloads carry taskId as int and taskType;
		// gallery/sniff completions are a different ID space and skipped.
		onEvent := func(payload any, status string) {
			m, ok := payload.(map[string]any)
			if !ok {
				return
			}
			switch tt, _ := m["taskType"].(string); tt {
			case "gallery", "sniff":
				return
			}
			id, ok := payloadTaskID(m["taskId"])
			if !ok || id != taskID {
				return
			}
			errMsg, _ := m["error"].(string)
			select {
			case events <- terminalEvent{status: status, errMsg: errMsg}:
			default: // buffer full: the fallback poll re-syncs within 5s
			}
		}
		unsubs = append(unsubs,
			e.eventBus.On("task:completed", func(p any) { onEvent(p, "completed") }),
			e.eventBus.On("task:failed", func(p any) { onEvent(p, "failed") }),
			e.eventBus.On("task:cancelled", func(p any) { onEvent(p, "cancelled") }),
		)
	}
	for _, unsub := range unsubs {
		defer unsub()
	}

	// Without a bus there is no push path at all: poll at the old 1s cadence.
	fallbackInterval := 5 * time.Second
	if e.eventBus == nil {
		fallbackInterval = 1 * time.Second
	}
	ticker := time.NewTicker(fallbackInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case ev := <-events:
			switch ev.status {
			case "completed":
				e.logger.Info("Video download completed via DAG", "taskId", taskID)
				return true, nil
			case "failed", "error":
				e.logger.Error("Video download failed via DAG", fmt.Errorf("%s", ev.errMsg), "taskId", taskID)
				return false, fmt.Errorf("video download failed: %s", ev.errMsg)
			case "cancelled":
				e.logger.Warn("Video download cancelled via DAG", "taskId", taskID)
				return false, fmt.Errorf("video download cancelled")
			}
		case <-ticker.C:
			status, errMsg, found := e.pollStatus(ctx, taskID)
			if !found {
				return false, fmt.Errorf("video task %d not found", taskID)
			}
			switch status {
			case "completed":
				e.logger.Info("Video download completed via DAG (fallback poll)", "taskId", taskID)
				return true, nil
			case "failed", "error":
				e.logger.Error("Video download failed via DAG", fmt.Errorf("%s", errMsg), "taskId", taskID)
				return false, fmt.Errorf("video download failed: %s", errMsg)
			case "cancelled":
				e.logger.Warn("Video download cancelled via DAG", "taskId", taskID)
				return false, fmt.Errorf("video download cancelled")
			}
			// pending/queued/paused/downloading/merging/transcoding: keep
			// waiting — terminal events or a later poll will resolve.
		}
	}
}

// pollStatus reads the task's current status from the DB, falling back to
// the tracker / download-manager views when no DB query is wired.
func (e *VideoDownloadExecutor) pollStatus(ctx context.Context, taskID int) (status, errMsg string, found bool) {
	if e.statusQueryFn != nil {
		return e.statusQueryFn(ctx, taskID)
	}
	if e.tracker != nil {
		// When no DB status query is available, check the
		// VideoProgressTracker for segment-level status.
		vps := e.tracker.GetSummary(taskID)
		if vps.TotalSegments > 0 {
			errMsg = ""
			if vps.Status == "failed" {
				errMsg = fmt.Sprintf("%d/%d segments failed", vps.FailedSegments, vps.TotalSegments)
			}
			return vps.Status, errMsg, true
		}
		if !e.downloadMgr.IsDownloading(taskID) {
			// Not downloading and no tracker data; verify via DB
			// before assuming completion.
			return "completed", "", true
		}
		return "downloading", "", true
	}
	// Fallback: check isDownloading via DownloadManager.
	if !e.downloadMgr.IsDownloading(taskID) {
		// Not downloading; assume completed or was never started.
		return "completed", "", true
	}
	return "downloading", "", true
}

// payloadTaskID extracts a numeric task ID from an event payload field.
func payloadTaskID(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	default:
		return 0, false
	}
}

// getIntFromConfig extracts an integer value from executor node config,
// handling both JSON number (float64) and integer types.
func getIntFromConfig(config map[string]any, key string) (int, bool) {
	v, ok := config[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}
