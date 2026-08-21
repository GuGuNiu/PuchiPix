package executors

import (
	"context"
	"fmt"

	"backend/internal/infra"
)

// VideoScrapeFn identifies the M3U8 stream URL for a video task and
// persists it (m3u8_url + video_infos) so the downstream download node
// can start immediately. Returning nil with no error when the M3U8 URL
// is already known makes the node idempotent across retries.
type VideoScrapeFn func(ctx context.Context, taskID int) error

// VideoScrapeExecutor owns the "识别" (identification) phase of a video
// task. It is a first-class DAG node that acquires the *scraping* slot
// (the same pool the user controls via "识别中最大数量" / maxScrapingTasks),
// so identification concurrency is strictly bounded — previously the
// identification ran inside the download executor and was only bounded
// by the download slot, making the scraping-slot setting meaningless
// for video tasks (the root cause of "全部启动识别，没有压住 N 个").
type VideoScrapeExecutor struct {
	logger   *infra.Logger
	scrapeFn VideoScrapeFn
}

// NewVideoScrapeExecutor creates the video identification executor.
// scrapeFn is injected by the server main (where DB / site registry /
// strategy selector live) to avoid an import cycle.
func NewVideoScrapeExecutor(fn VideoScrapeFn) *VideoScrapeExecutor {
	return &VideoScrapeExecutor{
		logger:   infra.NewLogger("VideoScrapeExecutor"),
		scrapeFn: fn,
	}
}

// Key returns the executor routing key, matching
// DagNodeDefinition.Executor in the video pipeline's scrape node.
func (e *VideoScrapeExecutor) Key() string { return "video:scrape" }

// Execute identifies the M3U8 URL for the task and persists it. A
// completed identification is re-entrant: the injected fn returns nil
// when m3u8_url is already stored.
func (e *VideoScrapeExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	taskID, ok := getIntFromConfig(node.Config, "taskId")
	if !ok {
		return false, fmt.Errorf("video:scrape executor: no taskId in config")
	}

	if e.scrapeFn == nil {
		e.logger.Warn("No video scrape function registered, simulating success", "nodeId", node.NodeID, "taskId", taskID)
		return true, nil
	}

	e.logger.Info("Identifying M3U8 stream for video task",
		"nodeId", node.NodeID, "dagId", node.DagID, "taskId", taskID)

	if err := e.scrapeFn(ctx, taskID); err != nil {
		e.logger.Error("Video M3U8 identification failed", err,
			"nodeId", node.NodeID, "taskId", taskID)
		return false, err
	}

	e.logger.Info("Video M3U8 identification completed",
		"nodeId", node.NodeID, "taskId", taskID)
	return true, nil
}
