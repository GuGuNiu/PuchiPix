package executors

import (
	"context"
	"fmt"
	"sync"

	"backend/internal/infra"
)

// Executor is the interface that node executors implement to perform
// the actual work of a DAG node.
type Executor interface {
	// Key returns the executor's routing key, matching DagNodeDefinition.Executor.
	Key() string
	// Execute runs the node's work and returns the result.
	Execute(ctx context.Context, node ExecutorNode) (bool, error)
}

// ExecutorNode carries the data an executor needs to run a node.
type ExecutorNode struct {
	NodeID      string
	DagID       string
	TaskType    string
	Phase       string
	ExecutorKey string
	Config      map[string]any
}

// Registry holds all registered executors and routes execution calls
// to the correct one based on the executor key.
type Registry struct {
	mu        sync.RWMutex
	executors map[string]Executor
	logger    *infra.Logger
}

// NewRegistry creates an empty executor registry.
func NewRegistry() *Registry {
	return &Registry{
		executors: make(map[string]Executor),
		logger:    infra.NewLogger("ExecutorRegistry"),
	}
}

// Register adds an executor to the registry.
func (r *Registry) Register(e Executor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.executors[e.Key()] = e
	r.logger.Info("Executor registered", "key", e.Key())
}

// Get retrieves an executor by key.
func (r *Registry) Get(key string) Executor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.executors[key]
}

// ScrapeExecutor handles the scrape phase, calling the site provider
// to extract gallery metadata.
type ScrapeExecutor struct {
	logger *infra.Logger
	providerFn func(ctx context.Context, url string) (map[string]any, error)
}

// NewScrapeExecutor creates a scrape executor with the given provider callback.
func NewScrapeExecutor(providerFn func(ctx context.Context, url string) (map[string]any, error)) *ScrapeExecutor {
	return &ScrapeExecutor{
		logger:     infra.NewLogger("ScrapeExecutor"),
		providerFn: providerFn,
	}
}

func (e *ScrapeExecutor) Key() string { return "scrape" }

func (e *ScrapeExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	url, ok := node.Config["url"].(string)
	if !ok {
		return false, fmt.Errorf("scrape executor: no url in config")
	}
	if e.providerFn == nil {
		e.logger.Warn("No provider function registered, simulating success", "nodeId", node.NodeID)
		return true, nil
	}
	data, err := e.providerFn(ctx, url)
	if err != nil {
		e.logger.Error("Scrape failed", err, "nodeId", node.NodeID, "dagId", node.DagID)
		return false, err
	}
	if data != nil {
		e.logger.Info("Scrape completed", "nodeId", node.NodeID, "dagId", node.DagID)
	}
	return true, nil
}

// DownloadExecutor handles the download phase, with domain fallback
// support to switch to backup domains when the primary is unavailable.
// When galleryDownloadFn is set and the node Config contains a
// "galleryId", it switches to gallery batch download mode.
type DownloadExecutor struct {
	logger            *infra.Logger
	downloadFn        func(ctx context.Context, url, savePath string, domains []string) error
	galleryDownloadFn func(ctx context.Context, galleryID int) error
}

// NewDownloadExecutor creates a download executor with the given
// download callback that supports domain fallback.
func NewDownloadExecutor(fn func(ctx context.Context, url, savePath string, domains []string) error) *DownloadExecutor {
	return &DownloadExecutor{
		logger:      infra.NewLogger("DownloadExecutor"),
		downloadFn: fn,
	}
}

// WithGalleryDownload sets the gallery batch download function.
func (e *DownloadExecutor) WithGalleryDownload(fn func(ctx context.Context, galleryID int) error) *DownloadExecutor {
	e.galleryDownloadFn = fn
	return e
}

func (e *DownloadExecutor) Key() string { return "download" }

func (e *DownloadExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	// Gallery batch download mode: when galleryId is present in Config,
	// download all gallery images/videos from the database.
	if e.galleryDownloadFn != nil {
		if gid, ok := node.Config["galleryId"]; ok {
			var galleryID int
			switch v := gid.(type) {
			case int:
				galleryID = v
			case float64:
				galleryID = int(v)
			}
			if galleryID > 0 {
				e.logger.Info("Starting gallery batch download",
					"nodeId", node.NodeID, "dagId", node.DagID, "galleryId", galleryID)
				err := e.galleryDownloadFn(ctx, galleryID)
				if err != nil {
					e.logger.Error("Gallery download failed", err, "nodeId", node.NodeID, "galleryId", galleryID)
					return false, err
				}
				e.logger.Info("Gallery download completed", "nodeId", node.NodeID, "galleryId", galleryID)
				return true, nil
			}
		}
	}

	// Single-file download mode (original behavior).
	url, _ := node.Config["url"].(string)
	savePath, _ := node.Config["savePath"].(string)
	var domains []string
	if d, ok := node.Config["fallbackDomains"].([]any); ok {
		for _, v := range d {
			if s, ok := v.(string); ok {
				domains = append(domains, s)
			}
		}
	}

	if e.downloadFn == nil {
		e.logger.Warn("No download function registered, simulating success", "nodeId", node.NodeID)
		return true, nil
	}

	err := e.downloadFn(ctx, url, savePath, domains)
	if err != nil {
		e.logger.Error("Download failed (all domains exhausted)", err, "nodeId", node.NodeID, "dagId", node.DagID)
		return false, err
	}
	e.logger.Info("Download completed", "nodeId", node.NodeID, "dagId", node.DagID)
	return true, nil
}

// VerifyExecutor handles the verify phase, checking downloaded content
// and triggering needs_retry when verification finds missing data.
type VerifyExecutor struct {
	logger      *infra.Logger
	verifyFn    func(ctx context.Context, node ExecutorNode) (string, int, string)
}

// NewVerifyExecutor creates a verify executor with the given verify callback.
// The callback returns (status, corrected, reason).
func NewVerifyExecutor(fn func(ctx context.Context, node ExecutorNode) (string, int, string)) *VerifyExecutor {
	return &VerifyExecutor{
		logger:   infra.NewLogger("VerifyExecutor"),
		verifyFn: fn,
	}
}

func (e *VerifyExecutor) Key() string { return "verify" }

func (e *VerifyExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	if e.verifyFn == nil {
		e.logger.Warn("No verify function registered, simulating success", "nodeId", node.NodeID)
		return true, nil
	}
	status, corrected, reason := e.verifyFn(ctx, node)
	switch status {
	case "passed":
		e.logger.Info("Verification passed", "nodeId", node.NodeID, "corrected", corrected, "reason", reason)
		return true, nil
	case "needs_retry":
		e.logger.Warn("Verification needs retry", "nodeId", node.NodeID, "reason", reason)
		return false, fmt.Errorf("needs_retry: %s", reason)
	default:
		e.logger.Error("Verification failed", nil, "nodeId", node.NodeID, "reason", reason)
		return false, fmt.Errorf("verification failed: %s", reason)
	}
}

// ExtractExecutor handles the extract phase, decompressing archives.
type ExtractExecutor struct {
	logger     *infra.Logger
	extractFn  func(ctx context.Context, archivePath, destPath, password string) error
}

// NewExtractExecutor creates an extract executor with the given callback.
func NewExtractExecutor(fn func(ctx context.Context, archivePath, destPath, password string) error) *ExtractExecutor {
	return &ExtractExecutor{
		logger:    infra.NewLogger("ExtractExecutor"),
		extractFn: fn,
	}
}

func (e *ExtractExecutor) Key() string { return "extract" }

func (e *ExtractExecutor) Execute(ctx context.Context, node ExecutorNode) (bool, error) {
	archivePath, _ := node.Config["archivePath"].(string)
	destPath, _ := node.Config["destPath"].(string)
	password, _ := node.Config["password"].(string)

	if e.extractFn == nil {
		e.logger.Warn("No extract function registered, simulating success", "nodeId", node.NodeID)
		return true, nil
	}

	if err := e.extractFn(ctx, archivePath, destPath, password); err != nil {
		e.logger.Error("Extraction failed", err, "nodeId", node.NodeID)
		return false, err
	}
	e.logger.Info("Extraction completed", "nodeId", node.NodeID, "archivePath", archivePath)
	return true, nil
}
