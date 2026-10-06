package dag

import (
	"fmt"
	"time"

	"backend/internal/idgen"
	"backend/internal/orchestrator"
)

type DagFactory struct{}

// NewDagFactory creates a DAG blueprint factory.
func NewDagFactory() *DagFactory {
	return &DagFactory{}
}

// SelectGalleryPipeline picks the gallery pipeline for the current gallery
// state. Context-aware selection avoids a cascade failure: a full pipeline
// runs its scrape on a gallery that already has data, and the scrape
// executor wipes gallery_images/gallery_videos and re-inserts every row as
// pending, resetting the checkpoint of files already on disk.
//
// Selection logic (scrapeDataExists = image_count > 0 || video_count > 0):
//   - scrape data missing: Full pipeline (scrape, download, extract, verify)
//   - scrape data present: Resume pipeline (download, extract, verify)
//
// The choice is keyed on scrape data rather than the galleries.status
// column because status labels ("failed", "partial", "completed") do not
// reliably indicate whether gallery_images rows exist: a gallery can be
// marked failed before scraping populated anything, or hold a full image
// list while some files are still pending.
func (f *DagFactory) SelectGalleryPipeline(url, providerID string, galleryID int, scrapeDataExists bool) orchestrator.DagDefinition {
	if scrapeDataExists {
		return f.NewGalleryResumePipeline(galleryID)
	}
	return f.NewGalleryPipeline(url, providerID, galleryID)
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
//	scrape (scraping slot), download (download slot), extract, verify
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

	// Inject url, galleryId, providerId and siteId into node configs so
	// executors can look up the gallery record and scrape the page, and the
	// per-domain admission gate can resolve the site's domain pool. The
	// download node gets skipVerify=true because the gallery pipeline has a
	// dedicated verify node (vf-{galleryId}) that checks download
	// completeness via the database rather than the filesystem-based
	// StateReconciler path (which requires savePath in the Config that is
	// determined dynamically at runtime).
	for i := range nodes {
		nodes[i].Config["url"] = url
		nodes[i].Config["galleryId"] = galleryID
		nodes[i].Config["providerId"] = providerID
		nodes[i].Config["siteId"] = providerID
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
// the database. Skipping the scrape phase is required, not merely
// convenient: the scrape executor treats an existing gallery as a
// re-scrape, DELETEs all gallery_images/gallery_videos rows and
// re-inserts them as pending, so routing a retry of a partially
// downloaded gallery through the full pipeline would reset the
// checkpoint of every file already on disk and re-download the whole
// gallery.
//
//	download (download slot), extract, verify
//
// Used by shelf retry-failed / GalleryFileRetry (via
// SelectGalleryPipeline) when the gallery has been scraped but files
// are incomplete or failed.
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
// scraping (preview/dry-run), the lightweight alternative to the full
// pipeline used in the /api/scrape endpoint.
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

	for i := range nodes {
		nodes[i].Config["url"] = url
		nodes[i].Config["providerId"] = providerID
		nodes[i].Config["siteId"] = providerID
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

// NewVideoPipeline builds the two-node video processing DAG:
//
//	vsc (scraping slot, M3U8 identification), vdl (download slot, download)
//
// The identification node acquires a scraping slot so video identification
// concurrency is bounded by the user's max scraping tasks setting
// (maxScrapingTasks). Identification inside the download executor would
// only be bounded by the download slot, making every submitted video task
// look like it was identifying even when the scheduler had rejected it.
//
// DAGs restored from snapshots that still use the single-node vdl pipeline
// keep working: VideoDownloadExecutor's task loader falls back to
// identifying the M3U8 URL itself when m3u8_url is empty.
//
// taskSeq is the canonical uppercase-alphanumeric task identifier
// (download_tasks.seq), used as the node ID suffix for uniform
// letter+number ID format across the whole site.
//
// siteID resolves the site's domain pool for the per-domain admission gate.
// It is not injected into node config as a URL because the video pipeline
// carries no page URL; the identification node looks the task row up by
// taskSeq instead.
func (f *DagFactory) NewVideoPipeline(taskSeq string, taskID int, siteID string) orchestrator.DagDefinition {
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
		nodes[i].Config["siteId"] = siteID
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
// (sniff_tasks.seq), used as the node ID suffix for uniform letter+number ID
// format across the whole site.
//
// siteId is read by SniffExecutor to resolve the site's domain pool.
func (f *DagFactory) NewSniffPipeline(url string, taskSeq string, siteID string) orchestrator.DagDefinition {
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
		nodes[i].Config["siteId"] = siteID
	}

	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeSniff,
		Nodes:    nodes,
		Metadata: orchestrator.DagMetadata{
			SourceURL: url,
			CreatedAt: time.Now(),
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
