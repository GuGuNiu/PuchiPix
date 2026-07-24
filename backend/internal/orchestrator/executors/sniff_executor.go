package executors

import (
	"context"
	"fmt"
	"time"

	"backend/internal/infra"
)

// SniffExecutor bridges sniff tasks into the DAG executor system.
// It wraps the site provider's M3U8 sniffing capability (via chromedp
// network interception) and polls for completion.
type SniffExecutor struct {
	logger     *infra.Logger
	// sniffFn performs the actual sniff operation. The first return value
	// is the number of URLs discovered; the second is any error.
	sniffFn func(ctx context.Context, url string, siteID string) (int, error)
}

// NewSniffExecutor creates a sniff executor that delegates to the
// given sniff function (typically the universal scraper's ScrapePage).
func NewSniffExecutor(fn func(ctx context.Context, url string, siteID string) (int, error)) *SniffExecutor {
	return &SniffExecutor{
		logger:  infra.NewLogger("SniffExecutor"),
		sniffFn: fn,
	}
}

// Key returns the executor routing key, matching
// DagNodeDefinition.Executor in sniff DAG definitions.
func (e *SniffExecutor) Key() string { return "sniff" }

// Execute runs the sniff operation. The node config must contain
// "url" (the listing page URL) and "siteId" (the site identifier).
func (e *SniffExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	url, ok := node.Config["url"].(string)
	if !ok || url == "" {
		return false, fmt.Errorf("sniff executor: no url in config")
	}
	siteID, _ := node.Config["siteId"].(string)

	if e.sniffFn == nil {
		e.logger.Warn("No sniff function registered, simulating completion",
			"nodeId", node.NodeID, "dagId", node.DagID)
		return true, nil
	}

	e.logger.Info("Starting sniff",
		"nodeId", node.NodeID, "dagId", node.DagID, "url", url)

	// Run sniff with the node's timeout context.
	sniffCtx, sniffCancel := context.WithTimeout(ctx, 5*time.Minute)
	defer sniffCancel()

	found, err := e.sniffFn(sniffCtx, url, siteID)
	if err != nil {
		e.logger.Error("Sniff failed", err,
			"nodeId", node.NodeID, "dagId", node.DagID)
		return false, fmt.Errorf("sniff failed: %w", err)
	}

	e.logger.Info("Sniff completed",
		"nodeId", node.NodeID, "dagId", node.DagID,
		"urlsFound", found)
	return true, nil
}
