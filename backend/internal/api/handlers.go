package api

import (
	"sync"

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
	"backend/internal/taskstate"
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
	Blocklist      *sites.BlocklistService
	DataDir        string
	deletionLocks  sync.Map
	sniffCreateMu  sync.Mutex
	// progressReplay caches the latest task:progress payload per task so
	// every (re)connecting SSE client resumes with fresh state for all
	// live tasks, not just the single event kept by the EventBus.
	progressReplay progressReplayCache
	// stateStore is the entity-status transition authority for user-action
	// writes (pause/cancel/submit-failure) on video tasks.
	stateStore *taskstate.Store
}

func New(database *db.Database, eventBus *infra.EventBus) *Handlers {
	return &Handlers{
		DB:         database,
		EventBus:   eventBus,
		stateStore: taskstate.NewStore(database, eventBus),
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

// WithDownloadDefaults shares the DownloadDefaults pointer so task-settings
// updates mutate the live concurrency limits.
func (h *Handlers) WithDownloadDefaults(dd *downloader.DownloadDefaults) *Handlers {
	h.DlDefaults = dd
	return h
}

func (h *Handlers) WithBlocklist(service *sites.BlocklistService) *Handlers {
	h.Blocklist = service
	return h
}

func (h *Handlers) WithDataDir(dataDir string) *Handlers {
	h.DataDir = dataDir
	return h
}

func (h *Handlers) lockDeletionPath(key string) func() {
	if key == "" {
		return func() {}
	}
	value, _ := h.deletionLocks.LoadOrStore(key, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}
