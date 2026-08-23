package dag

import (
	"fmt"
	"time"

	"backend/internal/idgen"
	"backend/internal/orchestrator"
)

// factory := NewDagFactory()
// def := factory.NewGalleryPipeline("https://...", "aimeizizi")
// dagID, err := orch.SubmitDag(ctx, def)
type DagFactory struct{}

// NewDagFactory creates a DAG blueprint factory.
func NewDagFactory() *DagFactory {
	return &DagFactory{}
}

// SelectGalleryPipeline chooses the appropriate gallery pipeline based
// on the current gallery state. This implements context-aware pipeline
// selection to avoid the cascade failure pattern where a full pipeline
// (with scrape) is used on a gallery that already has data, causing the
// scrape node to fail immediately and cascade to downstream nodes.
//
// Selection logic:
//   - "pending" / "scraping" → Full pipeline (scrape → download → extract → verify)
//   - "completed" / "downloaded" / "partial" / "failed" → Resume pipeline (download → extract → verify)
//   - unknown state → Full pipeline (safe default)
func (f *DagFactory) SelectGalleryPipeline(url, providerID string, galleryID int, status string) orchestrator.DagDefinition {
	switch status {
	case "pending", "scraping":
		return f.NewGalleryPipeline(url, providerID, galleryID)
	case "completed", "downloaded", "partial", "failed":
		return f.NewGalleryResumePipeline(galleryID)
	default:
		return f.NewGalleryPipeline(url, providerID, galleryID)
	}
}

// dagBlueprint holds the pre-configured parameters for building a node
// within a DAG pipeline, avoiding repeated hardcoded values across
// handler implementations.
type dagBlueprint struct {
	nodeID      string
	taskType    orchestrator.TaskType
	phase       orchestrator.TaskPhase
	deps        []string
	executor    string
	slotType    string
	priority    orchestrator.TaskPriority
	timeout     int
	maxRetries  int
	retryDelay  int
	nonCritical bool
}

// NewGalleryPipeline builds the full 4-node gallery processing DAG:
//
//	scrape (scraping slot) → download (download slot) → extract → verify
//
// Each node flows into the next via dependency edges. The scrape node
// acquires a scraping slot (max 3); the download node acquires a
// download slot (max 5). Extract and verify are slotless CPU/IO-bound
// operations.
func (f *DagFactory) NewGalleryPipeline(url, providerID string, galleryID int) orchestrator.DagDefinition {
	dagID := idgen.GenerateID()
	nodes := f.buildNodes(dagID, []dagBlueprint{
		{
			nodeID:     fmt.Sprintf("sc-%d", galleryID),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseScrape,
			deps:       []string{},
			executor:   "scrape",
			slotType:   "scraping",
			priority:   orchestrator.PriorityNormal,
			timeout:    300000,
			maxRetries: 2,
			retryDelay: 5000,
		},
		{
			nodeID:     fmt.Sprintf("dl-%d", galleryID),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseDownload,
			deps:       []string{fmt.Sprintf("sc-%d", galleryID)},
			executor:   "download",
			slotType:   "download",
			priority:   orchestrator.PriorityNormal,
			timeout:    3600000,
			maxRetries: 3,
			retryDelay: 30000,
		},
		{
			nodeID:      fmt.Sprintf("ex-%d", galleryID),
			taskType:    orchestrator.TaskTypeGallery,
			phase:       orchestrator.PhaseFinalize,
			deps:        []string{fmt.Sprintf("dl-%d", galleryID)},
			executor:    "extract",
			slotType:    "",
			priority:    orchestrator.PriorityNormal,
			timeout:     300000,
			maxRetries:  2,
			retryDelay:  10000,
			nonCritical: true,
		},
		{
			nodeID:     fmt.Sprintf("vf-%d", galleryID),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseFinalize,
			deps:       []string{fmt.Sprintf("ex-%d", galleryID)},
			executor:   "verify",
			slotType:   "",
			priority:   orchestrator.PriorityNormal,
			timeout:    60000,
			maxRetries: 1,
			retryDelay: 5000,
		},
	})

	// Inject url, galleryId, and providerId into node configs so
	// executors can look up the gallery record and scrape the page.
	// The download node gets skipVerify=true because the gallery
	// pipeline has a dedicated verify node (vf-{galleryId}) that
	// checks download completeness via the database rather than the
	// filesystem-based StateReconciler path (which requires savePath
	// in the Config that is determined dynamically at runtime).
	for i := range nodes {
		nodes[i].Config["url"] = url
		nodes[i].Config["galleryId"] = galleryID
		nodes[i].Config["providerId"] = providerID
		if nodes[i].ID == fmt.Sprintf("dl-%d", galleryID) {
			nodes[i].Config["skipVerify"] = true
		}
	}

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			SourceURL:  url,
			ProviderID: providerID,
			CreatedAt:  time.Now(),
		},
	}
}

// NewGalleryResumePipeline builds a 3-node download-only DAG for
// retrying partial/failed galleries whose metadata already exists in
// the database. Skipping the scrape phase avoids immediate failure
// when the gallery record already exists, which cascades to all
// downstream nodes.
//
//	download (download slot) → extract → verify
//
// Used by ShelfAction retry-failed when the gallery has been scraped
// but files are incomplete.
func (f *DagFactory) NewGalleryResumePipeline(galleryID int) orchestrator.DagDefinition {
	dagID := idgen.GenerateID()
	nodes := f.buildNodes(dagID, []dagBlueprint{
		{
			nodeID:     fmt.Sprintf("dl-%d", galleryID),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseDownload,
			deps:       []string{},
			executor:   "download",
			slotType:   "download",
			priority:   orchestrator.PriorityHigh, // Restore tasks jump the queue so resumed DAGs recover faster
			timeout:    3600000,
			maxRetries: 3,
			retryDelay: 30000,
		},
		{
			nodeID:      fmt.Sprintf("ex-%d", galleryID),
			taskType:    orchestrator.TaskTypeGallery,
			phase:       orchestrator.PhaseFinalize,
			deps:        []string{fmt.Sprintf("dl-%d", galleryID)},
			executor:    "extract",
			slotType:    "",
			priority:    orchestrator.PriorityNormal,
			timeout:     300000,
			maxRetries:  2,
			retryDelay:  10000,
			nonCritical: true,
		},
		{
			nodeID:     fmt.Sprintf("vf-%d", galleryID),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseFinalize,
			deps:       []string{fmt.Sprintf("ex-%d", galleryID)},
			executor:   "verify",
			slotType:   "",
			priority:   orchestrator.PriorityNormal,
			timeout:    60000,
			maxRetries: 1,
			retryDelay: 5000,
		},
	})

	// Inject galleryId and skipVerify into resume pipeline nodes.
	for i := range nodes {
		nodes[i].Config["galleryId"] = galleryID
		if nodes[i].ID == fmt.Sprintf("dl-%d", galleryID) {
			nodes[i].Config["skipVerify"] = true
		}
	}

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			CreatedAt: time.Now(),
		},
	}
}

// NewScrapeTask builds a single-node scrape DAG for one-off gallery
// scraping (preview/dry-run). This is the lightweight alternative to
// the full pipeline used in the /api/scrape endpoint.
func (f *DagFactory) NewScrapeTask(url, providerID string) orchestrator.DagDefinition {
	dagID := idgen.GenerateID()
	nodes := f.buildNodes(dagID, []dagBlueprint{
		{
			nodeID:     fmt.Sprintf("sc-%s-%d", providerID, time.Now().UnixMilli()),
			taskType:   orchestrator.TaskTypeGallery,
			phase:      orchestrator.PhaseScrape,
			deps:       []string{},
			executor:   "scrape",
			slotType:   "scraping",
			priority:   orchestrator.PriorityHigh,
			timeout:    120000,
			maxRetries: 2,
			retryDelay: 5000,
		},
	})

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			SourceURL:  url,
			ProviderID: providerID,
			CreatedAt:  time.Now(),
		},
	}
}

// NewVideoPipeline builds the two-node video processing DAG:
//
//	vsc (scraping slot, M3U8 identification) → vdl (download slot, download)
//
// The identification node acquires a *scraping* slot so video
// identification concurrency is bounded by the user's max scraping tasks
// setting (maxScrapingTasks → scraping slot). Previously identification
// ran inside the download executor and was only bounded by the download
// slot — every submitted video task looked like it was "identifying"
// (scraping) in the DB even when the scheduler had rejected it, which
// is the "all tasks started identifying / full" defect fixed by this split.
//
// Backward compatibility: DAGs restored from snapshots that still use
// the single-node vdl pipeline keep working — VideoDownloadExecutor's
// task loader falls back to identifying the M3U8 URL itself when
// m3u8_url is empty.
//
// taskSeq is the canonical uppercase-alphanumeric task identifier
// (download_tasks.seq), used as the node ID suffix for uniform
// letter+number ID format across the whole site.
func (f *DagFactory) NewVideoPipeline(taskSeq string, taskID int) orchestrator.DagDefinition {
	dagID := idgen.GenerateID()
	nodes := f.buildNodes(dagID, []dagBlueprint{
		{
			nodeID:     "vsc-" + taskSeq,
			taskType:   orchestrator.TaskTypeVideo,
			phase:      orchestrator.PhaseScrape,
			deps:       []string{},
			executor:   "video:scrape",
			slotType:   "scraping",
			priority:   orchestrator.PriorityNormal,
			timeout:    300000,
			maxRetries: 2,
			retryDelay: 5000,
		},
		{
			nodeID:     "vdl-" + taskSeq,
			taskType:   orchestrator.TaskTypeVideo,
			phase:      orchestrator.PhaseDownload,
			deps:       []string{"vsc-" + taskSeq},
			executor:   "video:download",
			slotType:   "download",
			priority:   orchestrator.PriorityNormal,
			timeout:    7200000,
			maxRetries: 1,
			retryDelay: 30000,
		},
	})

	// Inject seq into node config so VideoScrapeExecutor and
	// VideoDownloadExecutor can look up the download_tasks row by seq.
	// Both nodes skip the gallery-oriented verification path.
	for i := range nodes {
		nodes[i].Config["taskSeq"] = taskSeq
		nodes[i].Config["taskId"] = taskID
		nodes[i].Config["skipVerify"] = true
	}

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeVideo,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			SourceURL: "video-task:" + taskSeq,
			CreatedAt: time.Now(),
		},
	}
}

// NewSniffPipeline builds a single-node sniff DAG for M3U8 capture
// and line selection.
//
// taskSeq is the canonical uppercase-alphanumeric sniff task identifier
// (sniff_tasks.seq), used as the node ID suffix for uniform letter+
// number ID format across the whole site.
func (f *DagFactory) NewSniffPipeline(url string, taskSeq string) orchestrator.DagDefinition {
	dagID := idgen.GenerateID()
	nodes := f.buildNodes(dagID, []dagBlueprint{
		{
			nodeID:     "sn-" + taskSeq,
			taskType:   orchestrator.TaskTypeSniff,
			phase:      orchestrator.PhaseScrape,
			deps:       []string{},
			executor:   "sniff",
			slotType:   "sniff",
			priority:   orchestrator.PriorityLow,
			timeout:    300000,
			maxRetries: 3,
			retryDelay: 15000,
		},
	})

	for i := range nodes {
		nodes[i].Config["url"] = url
		nodes[i].Config["sniffSeq"] = taskSeq
	}

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeSniff,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			SourceURL: url,
			CreatedAt:  time.Now(),
		},
	}
}

// buildNodes converts a slice of blueprints into DagNodeDefinition
// instances with consistent slot requirement resolution and config
// seeding. Blueprints with an empty slotType produce nodes with no
// resource requirements (CPU/IO-bound nodes).
func (f *DagFactory) buildNodes(dagID string, blueprints []dagBlueprint) []orchestrator.DagNodeDefinition {
	nodes := make([]orchestrator.DagNodeDefinition, 0, len(blueprints))
	for _, bp := range blueprints {
		def := orchestrator.DagNodeDefinition{
			ID:           bp.nodeID,
			TaskType:     bp.taskType,
			Phase:        bp.phase,
			Dependencies: bp.deps,
			Executor:     bp.executor,
			Config: map[string]any{
				"dagId":  dagID,
				"nodeId": bp.nodeID,
			},
			Priority:    bp.priority,
			Timeout:     bp.timeout,
			MaxRetries:  bp.maxRetries,
			RetryDelay:  bp.retryDelay,
			NonCritical: bp.nonCritical,
		}

		if bp.slotType != "" {
			def.ResourceRequirements = []orchestrator.ResourceRequirement{
				{SlotType: bp.slotType, Count: 1, HoldUntil: "node_complete"},
			}
		}

		nodes = append(nodes, def)
	}
	return nodes
}
