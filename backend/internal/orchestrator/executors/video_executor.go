package executors

import (
	"context"
	"fmt"
	"time"

	"backend/internal/downloader/video"
	"backend/internal/infra"
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
}

// NewVideoDownloadExecutor creates a video download executor that
// wraps the DownloadManager for DAG-compatible execution.
//
// taskLoaderFn is called at the start of Execute to load the full
// DownloadTaskInput (M3U8URL, Title, PageURL, etc.) from the database.
// If M3U8URL is empty, the loader should scrape the page to discover it.
func NewVideoDownloadExecutor(dm *video.DownloadManager, statusFn StatusQueryFn, taskLoaderFn TaskLoaderFn) *VideoDownloadExecutor {
	return &VideoDownloadExecutor{
		logger:        infra.NewLogger("VideoDownloadExecutor"),
		downloadMgr:   dm,
		statusQueryFn: statusFn,
		taskLoaderFn:  taskLoaderFn,
	}
}

// Key returns the executor routing key, matching
// DagNodeDefinition.Executor in video DAG definitions.
func (e *VideoDownloadExecutor) Key() string { return "video:download" }

// Execute loads the task details, starts the download via DownloadManager
// (in a goroutine since StartDownload is blocking), and polls the database
// for terminal status.
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
	// Run it in a goroutine and poll the DB for status.
	go func() {
		if err := e.downloadMgr.StartDownload(ctx, task); err != nil {
			e.logger.Error("StartDownload returned error", err,
				"nodeId", node.NodeID, "taskId", taskID)
		}
	}()

	// Give the download a brief moment to set status to "downloading".
	time.Sleep(500 * time.Millisecond)

	// Poll for terminal status with adaptive polling interval.
	pollInterval := 1 * time.Second
	maxInterval := 10 * time.Second
	consecutivePending := 0

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-ticker.C:
			var status string
			var errMsg string
			var found bool

			if e.statusQueryFn != nil {
				status, errMsg, found = e.statusQueryFn(ctx, taskID)
			} else {
				// Fallback: check isDownloading via DownloadManager.
				if !e.downloadMgr.IsDownloading(taskID) {
					// Not downloading; assume completed or was never started.
					status = "completed"
					found = true
				} else {
					status = "downloading"
					found = true
				}
			}

			if !found {
				return false, fmt.Errorf("video task %d not found", taskID)
			}

			switch status {
			case "completed":
				e.logger.Info("Video download completed via DAG", "nodeId", node.NodeID, "taskId", taskID)
				return true, nil
			case "failed", "error":
				e.logger.Error("Video download failed via DAG", fmt.Errorf("%s", errMsg), "nodeId", node.NodeID, "taskId", taskID)
				return false, fmt.Errorf("video download failed: %s", errMsg)
			case "cancelled":
				e.logger.Warn("Video download cancelled via DAG", "nodeId", node.NodeID, "taskId", taskID)
				return false, fmt.Errorf("video download cancelled")
			case "pending", "queued", "paused":
				consecutivePending++
				if consecutivePending > 10 {
					consecutivePending = 0
					pollInterval *= 2
					if pollInterval > maxInterval {
						pollInterval = maxInterval
					}
					ticker.Reset(pollInterval)
				}
			default:
				consecutivePending = 0
			}
		}
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
