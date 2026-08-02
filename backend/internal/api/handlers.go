package api

import (
	"backend/internal/db"
	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/scheduler"
	"backend/internal/sites"
	"backend/internal/taskprogress"
)

// Handlers holds shared dependencies for all API endpoint handlers,
// injected at router construction time to avoid global state.
type Handlers struct {
	DB             *db.Database
	EventBus       *infra.EventBus
	DagOrch        *dag.DagOrchestrator
	Sched          *scheduler.SchedulerEngine
	ExeReg         *executors.Registry
	OuoOrch        *orchestrator.OuoOrchestrator
	DownloadMgr    *video.DownloadManager
	SiteReg        *sites.SiteRegistry
	ProgressEngine *taskprogress.Engine
	VideoTracker   *taskprogress.VideoProgressTracker
}

// New creates a Handlers instance with the given dependencies.
func New(database *db.Database, eventBus *infra.EventBus) *Handlers {
	return &Handlers{
		DB:       database,
		EventBus: eventBus,
	}
}

// WithDag injects the DAG orchestrator, scheduler engine, and executor
// registry for API endpoints that depend on the DAG scheduler.
func (h *Handlers) WithDag(dagOrch *dag.DagOrchestrator, sched *scheduler.SchedulerEngine, exeReg *executors.Registry) *Handlers {
	h.DagOrch = dagOrch
	h.Sched = sched
	h.ExeReg = exeReg
	return h
}

// WithServices injects the OUO orchestrator, download manager, and
// site registry for API endpoints that depend on these services.
func (h *Handlers) WithServices(ouoOrch *orchestrator.OuoOrchestrator, dm *video.DownloadManager, sr *sites.SiteRegistry) *Handlers {
	h.OuoOrch = ouoOrch
	h.DownloadMgr = dm
	h.SiteReg = sr
	return h
}

// WithProgressEngine injects the task progress engine and video
// segment tracker for fine-grained progress and retry support.
func (h *Handlers) WithProgressEngine(pe *taskprogress.Engine, vt *taskprogress.VideoProgressTracker) *Handlers {
	h.ProgressEngine = pe
	h.VideoTracker = vt
	return h
}
