package api

import (
	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/scheduler"
	"backend/internal/sites"
	"backend/internal/taskprogress"
)

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
	DlDefaults     *downloader.DownloadDefaults
}

func New(database *db.Database, eventBus *infra.EventBus) *Handlers {
	return &Handlers{
		DB:       database,
		EventBus: eventBus,
	}
}

func (h *Handlers) WithDag(dagOrch *dag.DagOrchestrator, sched *scheduler.SchedulerEngine, exeReg *executors.Registry) *Handlers {
	h.DagOrch = dagOrch
	h.Sched = sched
	h.ExeReg = exeReg
	return h
}

func (h *Handlers) WithServices(ouoOrch *orchestrator.OuoOrchestrator, dm *video.DownloadManager, sr *sites.SiteRegistry) *Handlers {
	h.OuoOrch = ouoOrch
	h.DownloadMgr = dm
	h.SiteReg = sr
	return h
}

func (h *Handlers) WithProgressEngine(pe *taskprogress.Engine, vt *taskprogress.VideoProgressTracker) *Handlers {
	h.ProgressEngine = pe
	h.VideoTracker = vt
	return h
}

// WithDownloadDefaults injects the shared DownloadDefaults pointer so
// task-settings updates can mutate concurrency limits at runtime.
func (h *Handlers) WithDownloadDefaults(dd *downloader.DownloadDefaults) *Handlers {
	h.DlDefaults = dd
	return h
}
