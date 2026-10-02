package app

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"backend/internal/api"
	"backend/internal/config"
	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/downloader/video"
	"backend/internal/idgen"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/governor"
	"backend/internal/orchestrator/policies"
	orchsched "backend/internal/orchestrator/scheduler"
	"backend/internal/orchestrator/slot"
	"backend/internal/sites"
	"backend/internal/sites/aimeizizi"
	"backend/internal/sites/exhentai"
	"backend/internal/sites/fourkhd"
	"backend/internal/sites/kanav"
	"backend/internal/sites/porn91"
	"backend/internal/sites/pornhub"
	siteSjs "backend/internal/sites/sjs"
	"backend/internal/sites/universal"
	"backend/internal/sites/xsnvshen"
	"backend/internal/sites/xvideos"
	"backend/internal/stealth"
	"backend/internal/taskprogress"
	"backend/internal/titleparser"
	"backend/resources"
)

type Options struct {
	Config *config.Config
	Dev    bool
	Assets http.Handler
}

type App struct {
	cfg    *config.Config
	isDev  bool
	assets http.Handler

	logger   *infra.Logger
	database *db.Database
	eventBus *infra.EventBus

	apiRouter http.Handler
	handlers  *api.Handlers

	dagOrch           *dag.DagOrchestrator
	sched             *orchsched.SchedulerEngine
	dm                *video.DownloadManager
	exeReg            *executors.Registry
	progressEngine    *taskprogress.Engine
	videoTracker      *taskprogress.VideoProgressTracker
	titleParser       *titleparser.Parser
	downloadDefaults  *downloader.DownloadDefaults
	blocklistSvc      *sites.BlocklistService
	flowCtrl          *governor.FlowController
	flowCtrlStarted   bool
	backpressureLayer *governor.BackpressureLayers
	backpressureOn    bool

	healthCancel       context.CancelFunc
	reactivationCancel context.CancelFunc
	zombieCancel       context.CancelFunc

	shutdownOnce sync.Once
}

func New(opts Options) (*App, error) {
	if opts.Config == nil {
		return nil, fmt.Errorf("app: Options.Config is required")
	}

	cfg := opts.Config
	isDev := opts.Dev

	infra.InitGlobalConfig("INFO", true)
	infra.InitGlobalConfig(cfg.LogLevel, isDev)
	infra.InitGlobalSink(cfg.LogSinkCapacity)
	logger := infra.NewLogger("Server")

	if isDev {
		logger.Info("Dev mode: log level set to INFO")
	}

	logger.Info("Configuration resolved",
		"dataDir", cfg.DataDir,
		"databasePath", cfg.DatabasePath)

	if abs, err := filepath.Abs(cfg.DatabasePath); err == nil {
		if info, statErr := os.Stat(abs); statErr == nil {
			logger.Info("Database file found",
				"path", abs,
				"sizeBytes", info.Size(),
				"sizeMB", info.Size()/(1024*1024))
		} else {
			logger.Warn("Database file does not exist yet — a NEW EMPTY database will be created",
				"path", abs,
				"hint", "if an existing database was expected, check DB_PATH / working directory (e.g. air hot-reload cwd drift)")
		}
	}

	database, dbErr := db.NewDatabase(cfg.DatabasePath, nil)
	if dbErr != nil {
		logger.Warn("Database unavailable, starting in degraded mode",
			"error", dbErr.Error())
	} else {
		validateDatabaseSchema(logger, database)
	}

	a := &App{
		cfg:       cfg,
		isDev:     isDev,
		assets:    opts.Assets,
		logger:    logger,
		database:  database,
		eventBus:  infra.NewEventBus(),
	}

	if database != nil {
		if err := a.wireDAG(cfg); err != nil {
			logger.Error("DAG orchestrator init failed", err)
		}
	}

	a.wireAPI(cfg)

	return a, nil
}

func (a *App) wireDAG(cfg *config.Config) error {
	logger := a.logger
	database := a.database
	eventBus := a.eventBus

	logger.Info("Initializing DAG scheduler")

	dlDefaults := &downloader.DownloadDefaults{
		MultiThread:            cfg.DownloadMultiThread,
		Concurrency:            cfg.DownloadConcurrency,
		MaxSpeed:               cfg.DownloadMaxSpeed,
		MinFileSize:            cfg.DownloadMinFileSize,
		GalleryImageConcurrent: cfg.GalleryImageConcurrent,
		VideoMaxConcurrent:     cfg.VideoMaxConcurrent,
		TSegmentConcurrent:     cfg.TSegmentConcurrent,
	}
	downloader.SetGlobalDownloadConcurrent(cfg.GlobalDownloadConcurrent)
	applyPersistedDownloadDefaults(dlDefaults, database, logger)

	a.downloadDefaults = dlDefaults

	eventStore := orchestrator.NewEventStore(database, eventBus)
	eventStore.StartAsyncWriter()

	siteReg := sites.GetSiteRegistry()

	progressEngine := taskprogress.NewEngine(logger)
	progressEngine.SetDatabase(database)
	var galleryProgressMu sync.Mutex
	galleryProgressLast := make(map[int]time.Time)
	progressEngine.SetOnProgress(func(galleryID int, summary taskprogress.GalleryProgressSummary) {
		galleryProgressMu.Lock()
		now := time.Now()
		if last, ok := galleryProgressLast[galleryID]; ok && now.Sub(last) < 250*time.Millisecond {
			galleryProgressMu.Unlock()
			return
		}
		galleryProgressLast[galleryID] = now
		galleryProgressMu.Unlock()
		eventBus.Emit("task:progress", map[string]any{
			"taskId":    galleryID,
			"taskType":  "gallery",
			"progress":  summary.Progress,
			"completed": summary.CompletedFiles,
			"total":     summary.TotalFiles,
			"failed":    summary.FailedFiles,
		})
	})
	a.progressEngine = progressEngine

	videoTracker := taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())
	a.videoTracker = videoTracker

	titleParser := titleparser.New()
	if models, err := titleparser.LoadModelsFromJSON(resources.CoserJSON); err == nil {
		titleParser.LoadModels(models)
		logger.Info("Title parser loaded models", "count", len(models))
	}
	if netredModels, err := titleparser.LoadModelsFromJSON(resources.NetredJSON); err == nil {
		titleParser.LoadModels(netredModels)
		logger.Info("Title parser loaded netred models", "count", len(netredModels))
	}
	if entries, err := resources.GameFS.ReadDir("game"); err == nil {
		totalChars := 0
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if data, err := resources.GameFS.ReadFile("game/" + entry.Name()); err == nil {
				if chars, err := titleparser.LoadGameCharactersFromJSON(data); err == nil {
					titleParser.LoadGameCharacters(chars)
					totalChars += len(chars)
				}
			}
		}
		logger.Info("Title parser loaded game characters", "count", totalChars)
	}
	a.titleParser = titleParser

	exeReg := executors.NewRegistry()
	a.exeReg = exeReg
	orchestrator.WireExecutors(exeReg, siteReg, database, eventBus, titleParser, progressEngine, videoTracker, cfg.DataDir, dlDefaults)

	slotPool := slot.NewSlotPool()
	slotPool.RegisterType(slot.SlotTypeDefinition{
		Key:        "scraping",
		Label:      "Scraping",
		DefaultMax: 5,
		Min:        1,
		Max:        50,
	})
	slotPool.RegisterType(slot.SlotTypeDefinition{
		Key:        "download",
		Label:      "Download",
		DefaultMax: 5,
		Min:        1,
		Max:        50,
	})
	slotPool.RegisterType(slot.SlotTypeDefinition{
		Key:        "sniff",
		Label:      "Sniff",
		DefaultMax: 1,
		Min:        1,
		Max:        10,
	})

	applyPersistedSlotMax(slotPool, database, logger, "max_concurrent_tasks", "download")
	applyPersistedSlotMax(slotPool, database, logger, "max_scraping_tasks", "scraping")
	applyPersistedSlotMax(slotPool, database, logger, "max_concurrent_sniff_tasks", "sniff")

	slotPool.SetStateChangeCallback(func(change slot.SlotStateChange) {
		eventBus.Emit("slot:stateChanged", map[string]any{
			"event":     change.Event,
			"slotType":  change.SlotType,
			"current":   change.Current,
			"max":       change.Max,
			"available": change.Available,
			"dagId":     change.DagID,
			"holderId":  change.HolderID,
			"ts":        time.Now().UnixMilli(),
		})
	})

	healthCtx, healthCancel := context.WithCancel(context.Background())
	a.healthCancel = healthCancel
	go slotPool.StartHealthCheck(healthCtx, 5*time.Second, 2*time.Hour+10*time.Minute)

	dagOrch := dag.NewDagOrchestrator(eventStore, slotPool)
	a.dagOrch = dagOrch

	stateReconciler := orchestrator.NewStateReconciler(database)
	dagOrch.SetReconciler(stateReconciler)

	taskTypeRegistry := orchestrator.NewTaskTypeRegistry()
	taskTypeRegistry.RegisterTransitionPolicy(orchestrator.TaskTypeGallery, policies.GalleryNodePolicy)
	dagOrch.SetTaskTypeRegistry(taskTypeRegistry)

	dagOrch.SetEventBus(eventBus)

	statusReporter := orchestrator.NewStatusReporter()
	dagOrch.SetStatusSyncFn(func(ctx context.Context, dagID, nodeID string, nodeDef orchestrator.DagNodeDefinition, state orchestrator.NodeState) {
		dbStatus, ok := statusReporter.MapNodeToEntityStatus(nodeDef, state)
		if !ok || dbStatus == "completed" {
			return
		}
		switch {
		case nodeDef.Config["galleryId"] != nil:
			gid := configInt(nodeDef.Config["galleryId"])
			if gid > 0 {
				_, err := database.Exec(ctx,
					`UPDATE galleries SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
					dbStatus, gid)
				if err != nil {
					logger.Warn("Node status sync failed (gallery)", "galleryId", gid, "error", err.Error())
				} else {
					eventBus.Emit("task:progress", map[string]any{
						"taskId":   gid,
						"taskType": "gallery",
						"status":   dbStatus,
					})
				}
			}
		case nodeDef.Config["taskSeq"] != nil:
			seq, _ := nodeDef.Config["taskSeq"].(string)
			if seq != "" {
				_, err := database.Exec(ctx,
					`UPDATE download_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE seq = ?`,
					dbStatus, seq)
				if err != nil {
					logger.Warn("Node status sync failed (video)", "seq", seq, "error", err.Error())
				} else if taskID := configInt(nodeDef.Config["taskId"]); taskID > 0 {
					eventBus.Emit("task:progress", map[string]any{
						"taskId":   taskID,
						"taskType": "video",
						"status":   dbStatus,
					})
				}
			}
		case nodeDef.Config["sniffSeq"] != nil:
			seq, _ := nodeDef.Config["sniffSeq"].(string)
			if seq != "" {
				_, err := database.Exec(ctx,
					`UPDATE sniff_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE seq = ?`,
					dbStatus, seq)
				if err != nil {
					logger.Warn("Node status sync failed (sniff)", "seq", seq, "error", err.Error())
				}
			}
		}
	})

	dagOrch.SetDagStatusSyncFn(func(ctx context.Context, dagID string, def orchestrator.DagDefinition, aggregateStatus string) {
		if len(def.Nodes) == 0 {
			return
		}
		switch {
		case def.TaskType == orchestrator.TaskTypeGallery:
			gid := configInt(def.Nodes[0].Config["galleryId"])
			if gid <= 0 {
				return
			}
			if aggregateStatus != "completed" {
				return
			}
			terminal := computeGalleryTerminalStatus(ctx, database, gid)
			res, err := database.Exec(ctx,
				`UPDATE galleries SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
				 WHERE id = ? AND status IN ('scraping', 'scraped', 'downloading', 'pending', 'paused', 'failed')`,
				terminal, gid)
			if err == nil {
				if n, _ := res.RowsAffected(); n > 0 {
					logger.Warn("DAG terminal guard rail filled gallery terminal status",
						map[string]any{"galleryId": gid, "dagId": dagID, "status": terminal})
					eventBus.Emit("task:progress", map[string]any{
						"taskId":   gid,
						"taskType": "gallery",
						"status":   terminal,
					})
				}
			}
		case def.TaskType == orchestrator.TaskTypeVideo:
			seq, _ := def.Nodes[0].Config["taskSeq"].(string)
			if seq == "" {
				return
			}
			if aggregateStatus != "completed" {
				return
			}
			res, err := database.Exec(ctx,
				`UPDATE download_tasks SET status = 'completed', progress = 100, updated_at = CURRENT_TIMESTAMP
				 WHERE seq = ? AND status IN ('scraping', 'downloading', 'merging', 'transcoding', 'probing', 'pending', 'paused', 'failed')`, seq)
			if err == nil {
				if n, _ := res.RowsAffected(); n > 0 {
					logger.Warn("DAG terminal guard rail filled video task status (executor write was missed)",
						map[string]any{"seq": seq, "dagId": dagID})
				}
			}
		}
	})

	sched := orchsched.NewSchedulerEngine(slotPool)
	a.sched = sched

	dagOrch.SetScheduler(&schedulerAdapter{sched: sched})
	sched.SetDagOrchestrator(&orchestratorAdapter{orch: dagOrch})

	flowCtrl := governor.NewFlowController(slotPool, sched, governor.DefaultFlowControllerConfig())
	a.flowCtrl = flowCtrl
	dagOrch.SetFlowController(flowCtrl)

	domainAdmission := stealth.GetDomainAdmissionController()
	applyPersistedDomainConfig(domainAdmission, database, logger)
	dagOrch.SetDomainAdmission(domainAdmission)

	sched.SetExecutorFunc(func(ctx context.Context, node orchsched.SchedulableNodeAdapter) (bool, error) {
		exec := exeReg.Get(node.ExecutorKey)
		if exec == nil {
			return false, fmt.Errorf("no executor registered for key: %s", node.ExecutorKey)
		}
		en := executors.ExecutorNode{
			NodeID:      node.NodeID,
			DagID:       node.DagID,
			TaskType:    string(node.TaskType),
			Phase:       string(node.Phase),
			ExecutorKey: node.ExecutorKey,
			Config:      node.Config,
		}
		return exec.Execute(ctx, en)
	})

	ctx := context.Background()
	if err := dagOrch.Initialize(ctx); err != nil {
		return err
	}

	flowCtrl.Start(ctx)
	a.flowCtrlStarted = true

	backpressureMonitor := governor.NewBackpressureMonitor(5 * time.Second)
	backpressureLayers := governor.RegisterBackpressureLayers(
		backpressureMonitor,
		flowCtrl.AdmissionController(),
		flowCtrl.PressureMonitor(),
		slotPool,
		sched,
		domainAdmission,
	)
	backpressureMonitor.Start(backpressureLayers.Start())
	a.backpressureLayer = backpressureLayers
	a.backpressureOn = true

	runCrashRecovery(database, eventBus, dagOrch, logger)

	sched.SyncQueueCapacityFromSlotPool()
	applyPersistedSchedulerConfig(sched, database, logger)
	sched.StartScanTimer(2 * time.Second)

	eventBus.On("gallery:stateChanged", func(payload any) {
		ev, ok := payload.(map[string]any)
		if !ok || database == nil {
			return
		}
		dagID, _ := ev["dagId"].(string)
		status, _ := ev["status"].(string)
		if status == "" || dagID == "" {
			return
		}
		go func(dagID, status string) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = database.Exec(ctx,
				`UPDATE galleries SET status = ?, error_msg = 'DAG ended with ' || ?, updated_at = CURRENT_TIMESTAMP WHERE dag_id = ?`,
				status, status, dagID)
		}(dagID, status)
	})

	reactivationCtx, reactivationCancel := context.WithCancel(context.Background())
	a.reactivationCancel = reactivationCancel
	dagOrch.StartAutoReactivation(reactivationCtx, 5*time.Second)

	zombieCtx, zombieCancel := context.WithCancel(context.Background())
	a.zombieCancel = zombieCancel
	dagOrch.StartZombieSweep(zombieCtx, 30*time.Second)

	logger.Info("DAG scheduler initialized")

	dataStore := sites.GetSiteDataStore()
	blocklistSvc := sites.NewBlocklistService(database)
	a.blocklistSvc = blocklistSvc
	accountMgr := sites.NewSiteAccountManager(database)

	siteReg.Register(aimeizizi.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(kanav.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(siteSjs.NewProvider(dataStore, accountMgr))
	siteReg.Register(exhentai.NewProvider(dataStore))
	siteReg.Register(xsnvshen.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(fourkhd.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(porn91.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(xvideos.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(pornhub.NewProvider(dataStore, blocklistSvc))
	siteReg.Register(universal.NewProvider())
	logger.Info("Site providers registered", "count", 10)

	return nil
}

func (a *App) wireAPI(cfg *config.Config) {
	logger := a.logger
	database := a.database
	eventBus := a.eventBus

	h := api.New(database, eventBus)
	h.WithDataDir(cfg.DataDir)

	if a.blocklistSvc != nil {
		h.WithBlocklist(a.blocklistSvc)
	}

	if database != nil {
		siteReg := sites.GetSiteRegistry()
		ouoOrch := orchestrator.NewOuoOrchestrator()

		dmCfg := video.DefaultManagerConfig()
		dmCfg.DownloadPath = filepath.Join(cfg.DataDir, "videos")
		dmCfg.SegmentsPath = filepath.Join(cfg.DataDir, "segments")
		dmCfg.MaxConcurrent = cfg.TSegmentConcurrent
		dm := video.NewDownloadManager(database, eventBus, dmCfg)
		applyPersistedTSConcurrency(dm, database, logger)

		dm.AutoConfigureGPU()
		gpuEnabled, gpuForce, _ := dm.GetGPUTranscodeStatus()
		a.downloadDefaults.GPUTranscode = gpuEnabled
		a.downloadDefaults.ForceGPUType = gpuForce

		dm.SetTracker(a.videoTracker)
		a.dm = dm

		if a.exeReg != nil {
			strategySelector := orchestrator.NewStrategySelector()
			delete(strategySelector.JSSites, "universal")

			statusFn := func(ctx context.Context, taskID int) (string, string, bool) {
				var status, errMsg string
				err := database.QueryRow(ctx,
					`SELECT status, COALESCE(error_msg, '') FROM download_tasks WHERE id = ?`,
					taskID).Scan(&status, &errMsg)
				if err != nil {
					return "", "", false
				}
				return status, errMsg, true
			}

			taskLoaderFn := func(ctx context.Context, taskID int) (video.DownloadTaskInput, error) {
				var seq string
				if err := database.QueryRow(ctx, "SELECT seq FROM download_tasks WHERE id = ?", taskID).Scan(&seq); err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("resolve seq for task %d: %w", taskID, err)
				}
				if seq == "" {
					seq = idgen.GenerateID()
					database.Exec(ctx, "UPDATE download_tasks SET seq = ? WHERE id = ?", seq, taskID)
				}
				return loadVideoTaskInput(ctx, database, h.SiteReg, strategySelector, eventBus, logger, a.titleParser, seq)
			}

			a.exeReg.Register(executors.NewVideoScrapeExecutor(func(ctx context.Context, taskSeq string) error {
				_, _, _, err := sniffVideoM3U8(ctx, database, h.SiteReg, strategySelector, eventBus, logger, a.titleParser, taskSeq)
				return err
			}))
			a.exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn, a.videoTracker, eventBus))
		}

		h.WithDag(a.dagOrch, a.sched, a.exeReg)
		h.WithServices(ouoOrch, dm, siteReg)
		h.WithProgressEngine(a.progressEngine, a.videoTracker)
		h.WithDownloadDefaults(a.downloadDefaults)
	}

	a.handlers = h
	a.apiRouter = api.NewRouter(h)
}

func (a *App) Router() http.Handler {
	if a.assets == nil {
		return a.apiRouter
	}
	return mountAssets(a.apiRouter, a.assets)
}

func (a *App) Database() *db.Database  { return a.database }
func (a *App) Config() *config.Config  { return a.cfg }
func (a *App) Logger() *infra.Logger   { return a.logger }
func (a *App) EventBus() *infra.EventBus { return a.eventBus }

func (a *App) Shutdown() {
	a.shutdownOnce.Do(func() {
		a.logger.Info("Shutting down application")

		if a.dm != nil {
			a.dm.Stop()
			a.logger.Info("Download manager stopped")
		}

		if a.flowCtrlStarted && a.flowCtrl != nil {
			a.flowCtrl.Stop()
			a.logger.Info("Flow controller stopped")
		}

		if a.backpressureOn && a.backpressureLayer != nil {
			a.backpressureLayer.Stop()
			a.logger.Info("Backpressure monitor stopped")
		}

		if a.healthCancel != nil {
			a.healthCancel()
		}
		if a.reactivationCancel != nil {
			a.reactivationCancel()
		}
		if a.zombieCancel != nil {
			a.zombieCancel()
		}

		if a.dagOrch != nil {
			dagShutdownCtx, dagShutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
			if err := a.dagOrch.Shutdown(dagShutdownCtx); err != nil {
				a.logger.Error("DAG shutdown error", err)
			}
			dagShutdownCancel()
		}

		if a.sched != nil {
			a.sched.Stop()
			a.logger.Info("Scheduler stopped")
		}

		if a.database != nil {
			a.database.Close()
		}
		a.logger.Info("Application exited")
	})
}