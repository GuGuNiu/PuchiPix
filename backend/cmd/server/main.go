package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
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
	"backend/internal/taskstate"
	"backend/internal/titleparser"
	"backend/resources"
)

func configInt(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int8:
		return int(v)
	case int16:
		return int(v)
	case int32:
		return int(v)
	case int64:
		return int(v)
	case uint:
		return int(v)
	case uint8:
		return int(v)
	case uint16:
		return int(v)
	case uint32:
		return int(v)
	case uint64:
		return int(v)
	case float32:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return int(n)
		}
	case string:
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return 0
}

func main() {
	infra.InitGlobalConfig("INFO", true)

	cfg, err := config.Load()
	if err != nil {
		logger := infra.NewLogger("Server")
		logger.Error("Config load failed", err)
		os.Exit(1)
	}

	isDev := os.Getenv("GO_ENV") != "production"
	infra.InitGlobalConfig(cfg.LogLevel, isDev)
	infra.InitGlobalSink(cfg.LogSinkCapacity)
	logger := infra.NewLogger("Server")

	eventBus := infra.NewEventBus()

	if isDev {
		logger.Info("Dev mode: log level set to INFO")
	}

	logger.Info("Configuration resolved",
		"dataDir", cfg.DataDir,
		"databasePath", cfg.DatabasePath)

	// Surface which database file is about to be opened and whether it
	// already exists, because a hot reload that resolves a different path
	// yields an empty database where every API 404s while the server still
	// looks healthy. A file about to be created is often legitimate on a
	// first run, but still warrants a warning.
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
		// A healthy database must contain the core entity tables. An empty
		// schema means a freshly created DB or the wrong file was opened, and
		// failing fast beats serving 404s from an empty database.
		validateDatabaseSchema(logger, database)
	}

	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry
	var progressEngine *taskprogress.Engine
	var videoTracker *taskprogress.VideoProgressTracker
	var dm *video.DownloadManager
	var blocklistSvc *sites.BlocklistService
	var flowCtrl *governor.FlowController
	var flowCtrlStarted bool
	var backpressureLayers *governor.BackpressureLayers
	var backpressureStarted bool
	var titleParser *titleparser.Parser

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

	if database != nil {
		logger.Info("Initializing DAG scheduler")

		eventStore := orchestrator.NewEventStore(database, eventBus)
		eventStore.StartAsyncWriter()

		siteReg := sites.GetSiteRegistry()

		progressEngine = taskprogress.NewEngine(logger)
		progressEngine.SetDatabase(database)
		// Push per-file gallery progress onto the SSE bus: the onProgress
		// hook was never wired, so file-count progress was poll-only via
		// /api/shelf/{id}/files/progress. Events are throttled per gallery;
		// the payload shape matches the frontend GalleryProgressInfo fields
		// (completed/total/failed + progress), and omitting status keeps the
		// entity status owned by the DAG sync / executors.
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
		videoTracker = taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())

		titleParser = titleparser.New()
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

		exeReg = executors.NewRegistry()
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
		// The stale-slot timeout must exceed the largest node timeout
		// (video download: 2h). executeNode settles every node at its
		// context deadline, so a slot held longer than that bound belongs
		// to a genuinely leaked goroutine. The old 10m value stripped
		// slots from healthy long downloads and let the scheduler
		// over-commit download concurrency.
		go slotPool.StartHealthCheck(healthCtx, 5*time.Second, 2*time.Hour+10*time.Minute)
		defer healthCancel()

		dagOrch = dag.NewDagOrchestrator(eventStore, slotPool)

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

		// Entities can end a DAG in an active status for two reasons:
		// post-download nodes (extract/verify) transition through
		// QUEUED/RUNNING, and statusSync maps PhaseFinalize back to
		// "downloading", overwriting the executor's terminal write; or an
		// executor crashes between node completion and its final UPDATE, so
		// no terminal write happens at all.
		//
		// This guard rail runs once at DAG terminal aggregate and performs a
		// conditional write: it only touches entities still holding an
		// active status, and derives the gallery terminal label from content
		// counts (mirroring the executor's completed/partial semantics) so a
		// partial download is never masked as completed. Executor-owned
		// terminal statuses (completed/partial/failed/cancelled) are never
		// clobbered because the WHERE clause excludes them.
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
				// 'failed' is in the healable set because a verify
				// needs_retry writes "failed"; when its auto-retry succeeds the
				// finalize nodes no longer rewrite the entity, so only this
				// guard rail can restore the content-derived terminal status.
				// A genuine failure (nothing downloaded) still resolves to
				// failed/partial.
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

		sched = orchsched.NewSchedulerEngine(slotPool)

		schedAdapter := &schedulerAdapter{sched: sched}
		dagOrch.SetScheduler(schedAdapter)

		orchAdapter := &orchestratorAdapter{orch: dagOrch}
		sched.SetDagOrchestrator(orchAdapter)

		// The flow control governor is wired after sched+slotPool so the
		// PressureMonitor can read real-time queue depth via
		// sched.QueueDepth().
		flowCtrl = governor.NewFlowController(slotPool, sched, governor.DefaultFlowControllerConfig())
		dagOrch.SetFlowController(flowCtrl)

		// Per-domain admission: spreads admitted nodes across a site's
		// mirror domains so a large batch does not concentrate on one
		// origin, and so a domain that degrades mid-run stops receiving new
		// work. Rejection keeps the node QUEUED, matching flow control.
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
			logger.Error("DAG orchestrator init failed", err)
		}

		// Started after the orchestrator is initialized so the control loop
		// has a real pressure source to sample.
		flowCtrl.Start(ctx)
		flowCtrlStarted = true

		// Sample every backpressure layer, including the per-domain gate, so
		// a stall can be attributed to a specific layer instead of inferred.
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
		backpressureStarted = true

		{
			recoveryCtx := context.Background()
			staleStatuses := []string{"downloading", "scraped", "scraping"}
			for _, staleStatus := range staleStatuses {
				rows, qErr := database.Query(recoveryCtx,
					`SELECT id, source_url, site_id FROM galleries WHERE status = ?`, staleStatus)
				if qErr != nil {
					continue
				}
				type orphan struct {
					id        int
					sourceURL string
					siteID    string
				}
				var orphans []orphan
				for rows.Next() {
					var o orphan
					if scanErr := rows.Scan(&o.id, &o.sourceURL, &o.siteID); scanErr == nil {
						orphans = append(orphans, o)
					}
				}
				rows.Close()

				if len(orphans) > 0 {
					logger.Info("Crash recovery: resetting stale galleries",
						"status", staleStatus, "count", len(orphans))
					for _, o := range orphans {
						// DAG restore moves every non-terminal node to PAUSED
						// after a restart, so the row must say "paused" and
						// leave the resume decision to the user; "pending" would
						// show a waiting task in the frontend while the DAG
						// actually holds it paused.
						_, _ = database.Exec(recoveryCtx,
							`UPDATE galleries SET status = 'paused', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
							o.id)
					}
				}
			}

			_, _ = database.Exec(recoveryCtx,
				`UPDATE gallery_videos SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'failed')`)

			// Video tasks left mid-pipeline (downloading/scraping, and now
			// also merging/transcoding/probing) go to paused so the user can
			// resume them; previously a crash during merge/transcode left the
			// row stuck forever with no retry action available.
			recoveryStore := taskstate.NewStore(database, eventBus)
			if n, err := recoveryStore.RecoverStale(recoveryCtx); err != nil {
				logger.Warn("Crash recovery: video task reset failed", "error", err.Error())
			} else if n > 0 {
				logger.Info("Crash recovery: reset mid-pipeline video tasks to paused", "count", n)
			}
		}

		// Heal entity rows whose DAG already reached a terminal state
		// while the process was down: the completion-time guard rail only
		// fires in-process, so without this those rows keep an active
		// label until the next DAG event touches them.
		dagOrch.ReconcileEntityStatuses(context.Background())

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
		dagOrch.StartAutoReactivation(reactivationCtx, 5*time.Second)
		defer reactivationCancel()

		// The zombie sweep re-drives nodes whose executor vanished while
		// their FSM stayed ALLOCATED/RUNNING — the wedge where slots sit
		// free, the queue is empty, and frozen in-progress rows pile up.
		zombieCtx, zombieCancel := context.WithCancel(context.Background())
		dagOrch.StartZombieSweep(zombieCtx, 30*time.Second)
		defer zombieCancel()

		logger.Info("DAG scheduler initialized")

		// Do not call eventStore.Flush() here: dagOrch.Shutdown owns that
		// call, and invoking it twice obscures which layer is responsible
		// for persistence. dagOrch.Shutdown() and sched.Stop() run in the
		// shutdown sequence below, before database.Close(), because the
		// final snapshot needs DB access.

		dataStore := sites.GetSiteDataStore()
		blocklistSvc = sites.NewBlocklistService(database)
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
	}

	h := api.New(database, eventBus)
	h.WithDataDir(cfg.DataDir)
	if blocklistSvc != nil {
		h.WithBlocklist(blocklistSvc)
	}

	if database != nil {
		siteReg := sites.GetSiteRegistry()
		ouoOrch := orchestrator.NewOuoOrchestrator()
		dmCfg := video.DefaultManagerConfig()
		dmCfg.DownloadPath = filepath.Join(cfg.DataDir, "videos")
		dmCfg.SegmentsPath = filepath.Join(cfg.DataDir, "segments")
		dmCfg.MaxConcurrent = cfg.TSegmentConcurrent
		dm = video.NewDownloadManager(database, eventBus, dmCfg)
		applyPersistedTSConcurrency(dm, database, logger)

		// Auto-enable GPU transcoding on discrete GPUs and disable it on
		// integrated/unknown GPUs (the user can override from the config
		// page). Runs once when no persisted choice exists.
		dm.AutoConfigureGPU()
		// The gallery pipeline honors the same gpu_transcode setting for its
		// embedded video merge.
		gpuEnabled, gpuForce, _ := dm.GetGPUTranscodeStatus()
		dlDefaults.GPUTranscode = gpuEnabled
		dlDefaults.ForceGPUType = gpuForce

		// The tracker is created before the manager, so it must be injected
		// here for RegisterSegments and UpdateSegment to be called from the
		// download pipeline.
		dm.SetTracker(videoTracker)

		// WireExecutors runs during DAG init above, before the
		// DownloadManager exists, so the video executors are registered
		// here; otherwise video DAGs fail with "no executor registered for
		// key: video:download".
		if exeReg != nil {
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

			// The scrape executor can discover the M3U8 stream when m3u8_url
			// is still empty, and the strategy selector picks HTTP-first or
			// chromedp from site configuration and runtime conditions with
			// domain failover through DomainHealthTracker.
			strategySelector := orchestrator.NewStrategySelector()
			// "universal" is removed so it participates in auto-selection
			// instead of being pinned to chromedp.
			delete(strategySelector.JSSites, "universal")

			taskLoaderFn := func(ctx context.Context, taskID int) (video.DownloadTaskInput, error) {
				// The shared helper ensures the M3U8 URL is identified
				// (idempotent, since a single-node DAG can reach the download
				// node with no preceding video:scrape node) and assembles the
				// full input including referer domains and metadata. The
				// helper keys on seq, so it is resolved from taskID first.
				var seq string
				if err := database.QueryRow(ctx, "SELECT seq FROM download_tasks WHERE id = ?", taskID).Scan(&seq); err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("resolve seq for task %d: %w", taskID, err)
				}
				if seq == "" {
					seq = idgen.GenerateID()
					database.Exec(ctx, "UPDATE download_tasks SET seq = ? WHERE id = ?", seq, taskID)
				}
				return loadVideoTaskInput(ctx, database, h.SiteReg, strategySelector, eventBus, logger, titleParser, seq)
			}

			// Video identification runs in a dedicated DAG node holding the
			// *scraping* slot, so its concurrency is bounded by
			// maxScrapingTasks. The callback receives the canonical
			// uppercase-alphanumeric taskSeq, so lookups are uniform.
			exeReg.Register(executors.NewVideoScrapeExecutor(func(ctx context.Context, taskSeq string) error {
				_, _, _, err := sniffVideoM3U8(ctx, database, h.SiteReg, strategySelector, eventBus, logger, titleParser, taskSeq)
				return err
			}))
			exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn, videoTracker, eventBus))

			// Unfinished tasks stay 'pending' after restart; the user's
			// "start" action creates a fresh DAG.
		}

		h.WithDag(dagOrch, sched, exeReg)
		h.WithServices(ouoOrch, dm, siteReg)
		h.WithProgressEngine(progressEngine, videoTracker)
		h.WithDownloadDefaults(dlDefaults)
	}

	router := api.NewRouter(h)

	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		logger.Info(fmt.Sprintf("HTTP server listening on %s", addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error", err)
			os.Exit(1)
		}
	}()

	// Dev-only pprof endpoint (localhost, separate port) for goroutine
	// dumps when diagnosing stuck downloads: GET /debug/pprof/goroutine?debug=2
	if isDev {
		pprofMux := http.NewServeMux()
		pprofMux.HandleFunc("/debug/pprof/", pprof.Index)
		pprofMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		pprofMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		pprofMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		pprofMux.HandleFunc("/debug/pprof/trace", pprof.Trace)
		pprofSrv := &http.Server{
			Addr:         "127.0.0.1:10551",
			Handler:      pprofMux,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 60 * time.Second,
		}
		go func() {
			logger.Info("pprof server listening on 127.0.0.1:10551")
			if err := pprofSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				logger.Error("pprof server error", err)
			}
		}()
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("Shutting down server")

	// Shutdown order matters: each step depends on the ones before it still
	// being alive. The database is closed last because dagOrch.Shutdown()
	// writes a final snapshot to it.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server forced to shutdown", err)
	}

	// Cancelling downloads writes "cancelled" rows, so the DB must still be open.
	if dm != nil {
		dm.Stop()
		logger.Info("Download manager stopped")
	}

	if flowCtrlStarted {
		flowCtrl.Stop()
		logger.Info("Flow controller stopped")
	}

	if backpressureStarted && backpressureLayers != nil {
		backpressureLayers.Stop()
		logger.Info("Backpressure monitor stopped")
	}

	// Draining the scheduler, flushing the event store, and writing the final
	// snapshot all need DB access.
	if dagOrch != nil {
		dagShutdownCtx, dagShutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := dagOrch.Shutdown(dagShutdownCtx); err != nil {
			logger.Error("DAG shutdown error", err)
		}
		dagShutdownCancel()
	}

	// Stopped after the DAG drain is complete.
	if sched != nil {
		sched.Stop()
		logger.Info("Scheduler stopped")
	}

	// Last: every DB writer has stopped by now.
	if database != nil {
		database.Close()
	}
	logger.Info("Server exited")
}

// schedulerAdapter bridges DagOrchestrator.SchedulerInterface to the
// SchedulerEngine, converting between orchestrator.SchedulableNode and
// scheduler.SchedulableNodeAdapter.
type schedulerAdapter struct {
	sched *orchsched.SchedulerEngine
}

func (a *schedulerAdapter) Submit(node orchestrator.SchedulableNode) bool {
	return a.sched.Submit(orchsched.SchedulableNodeAdapter{
		NodeID:               node.NodeID,
		DagID:                node.DagID,
		TaskType:             string(node.TaskType),
		Phase:                string(node.Phase),
		ExecutorKey:          node.ExecutorKey,
		Priority:             int(node.Priority),
		ResourceRequirements: convertResourceReqs(node.ResourceRequirements),
		Config:               node.Config,
		SubmittedAt:          node.SubmittedAt,
		TimeoutMs:            node.TimeoutMs,
		NonCritical:          node.NonCritical,
	})
}

// SubmitWithDelay bridges the orchestrator's non-blocking retry backoff
// to the scheduler's delayed submission.
func (a *schedulerAdapter) SubmitWithDelay(node orchestrator.SchedulableNode, delay time.Duration) {
	a.sched.SubmitWithDelay(orchsched.SchedulableNodeAdapter{
		NodeID:               node.NodeID,
		DagID:                node.DagID,
		TaskType:             string(node.TaskType),
		Phase:                string(node.Phase),
		ExecutorKey:          node.ExecutorKey,
		Priority:             int(node.Priority),
		ResourceRequirements: convertResourceReqs(node.ResourceRequirements),
		Config:               node.Config,
		SubmittedAt:          node.SubmittedAt,
		TimeoutMs:            node.TimeoutMs,
		NonCritical:          node.NonCritical,
	}, delay)
}

// UpdateNodePriority bridges dynamic priority adjustment to the
// scheduler's ready queue.
func (a *schedulerAdapter) UpdateNodePriority(dagID, nodeID string, newPriority int) bool {
	return a.sched.UpdateNodePriority(dagID, nodeID, newPriority)
}

func (a *schedulerAdapter) HasNode(dagID, nodeID string) bool {
	return a.sched.HasNode(dagID, nodeID)
}

func (a *schedulerAdapter) CancelNode(dagID, nodeID string) {
	a.sched.CancelNode(dagID, nodeID)
}

func (a *schedulerAdapter) CancelRunningNode(dagID, nodeID string) {
	a.sched.CancelRunningNode(dagID, nodeID)
}

func (a *schedulerAdapter) WaitForDag(ctx context.Context, dagID string) error {
	return a.sched.WaitForDag(ctx, dagID)
}

func (a *schedulerAdapter) OnSlotFreed(slotType string) {
	a.sched.OnSlotFreed(slotType)
}

func convertResourceReqs(reqs []orchestrator.ResourceRequirement) []slot.ResourceRequirement {
	out := make([]slot.ResourceRequirement, len(reqs))
	for i, r := range reqs {
		out[i] = slot.ResourceRequirement{
			SlotType:  r.SlotType,
			Count:     r.Count,
			HoldUntil: r.HoldUntil,
		}
	}
	return out
}

// orchestratorAdapter bridges the scheduler's DagOrchestratorInterface to
// the DagOrchestrator, converting between the simplified scheduler
// callback signatures and the full orchestrator API.
type orchestratorAdapter struct {
	orch *dag.DagOrchestrator
}

func (a *orchestratorAdapter) TransitionNode(dagID, nodeID string, toState string, reason, triggeredBy string) error {
	ctx := context.Background()
	return a.orch.TransitionNode(ctx, dagID, nodeID, orchestrator.NodeState(toState), orchestrator.TransitionContext{
		Reason:      reason,
		TriggeredBy: triggeredBy,
	})
}

func (a *orchestratorAdapter) OnNodeCompleted(dagID, nodeID string, success bool, data map[string]any, errMsg string) error {
	ctx := context.Background()
	result := orchestrator.NodeExecutionResult{
		Success: success,
		Data:    data,
	}
	if !success && errMsg != "" {
		result.Error = &orchestrator.NodeError{
			Code:    "EXECUTION_FAILED",
			Message: errMsg,
		}
	}
	return a.orch.OnNodeCompleted(ctx, dagID, nodeID, result)
}

func (a *orchestratorAdapter) ReactivateReadyNodes() {
	ctx := context.Background()
	a.orch.ReactivateReadyNodes(ctx)
}

func (a *orchestratorAdapter) GetNodeForVerification(dagID, nodeID string) interface{} {
	// Returning the real node matters: the scheduler calls this during the
	// VERIFYING phase to drive side-effect checks and needs_retry
	// auto-retry, so a nil here disables the whole verification chain.
	return a.orch.GetNodeForVerification(dagID, nodeID)
}

func (a *schedulerAdapter) IsExecuting(dagID, nodeID string) bool {
	return a.sched.IsExecuting(dagID, nodeID)
}

func applyPersistedDownloadDefaults(defaults *downloader.DownloadDefaults, database *db.Database, logger *infra.Logger) {
	if defaults == nil || database == nil {
		return
	}
	read := func(key string) int {
		var value string
		if err := database.QueryRow(context.Background(), "SELECT value FROM app_configs WHERE key = ?", key).Scan(&value); err != nil {
			return 0
		}
		n, err := strconv.Atoi(value)
		if err != nil || n <= 0 {
			return 0
		}
		return n
	}
	if n := read("ts_segment_concurrent"); n > 0 {
		if n > 200 {
			n = 200
		}
		defaults.TSegmentConcurrent = n
		logger.Info("Applied persisted TS segment concurrency to gallery defaults", "max", n)
	}
	if n := read("gallery_image_concurrent"); n > 0 {
		if n > 50 {
			n = 50
		}
		defaults.GalleryImageConcurrent = n
		logger.Info("Applied persisted gallery image concurrency", "max", n)
	}
}

func applyPersistedTSConcurrency(dm *video.DownloadManager, database *db.Database, logger *infra.Logger) {
	if dm == nil || database == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var value string
	if err := database.QueryRow(ctx, "SELECT value FROM app_configs WHERE key = 'ts_segment_concurrent'").Scan(&value); err != nil {
		return
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return
	}
	dm.SetMaxConcurrent(n)
	logger.Info("Applied persisted TS segment concurrency", "max", n)
}

// applyPersistedSlotMax reads a persisted concurrency setting from
// app_configs and applies it to the slot pool at startup, so the user's
// saved scraping max / download concurrency / sniff concurrency values
// survive restarts. No-op when the config key is absent or invalid
// (pool keeps defaults).
func applyPersistedSlotMax(sp *slot.SlotPool, database *db.Database, logger *infra.Logger, dbKey, slotType string) {
	if sp == nil || database == nil {
		return
	}
	var val string
	if err := database.QueryRow(context.Background(),
		`SELECT value FROM app_configs WHERE key = ?`, dbKey).Scan(&val); err != nil || val == "" {
		return
	}
	n, err := strconv.Atoi(val)
	if err != nil || n <= 0 {
		return
	}
	sp.UpdateMax(slotType, n)
	logger.Info("Applied persisted slot max from app_configs",
		"slotType", slotType, "max", n, "configKey", dbKey)
}

// applyPersistedSchedulerConfig loads the scheduler tuning keys from
// app_configs so user-saved starvation threshold, lottery rate, and max
// schedule iterations survive restarts. The engine setters validate ranges,
// so an invalid or absent key keeps the default.
func applyPersistedSchedulerConfig(se *orchsched.SchedulerEngine, database *db.Database, logger *infra.Logger) {
	if se == nil || database == nil {
		return
	}
	read := func(key string) string {
		var val string
		if err := database.QueryRow(context.Background(),
			`SELECT value FROM app_configs WHERE key = ?`, key).Scan(&val); err != nil {
			return ""
		}
		return val
	}

	if val := read("scheduler_starvation_threshold"); val != "" {
		if minutes, err := strconv.ParseFloat(val, 64); err == nil {
			if se.SetStarvationThreshold(time.Duration(minutes * float64(time.Minute))) {
				logger.Info("Applied persisted scheduler config",
					"key", "scheduler_starvation_threshold", "value", val)
			}
		}
	}
	if val := read("scheduler_starvation_lottery_rate"); val != "" {
		if rate, err := strconv.ParseFloat(val, 64); err == nil {
			if se.SetStarvationLotteryRate(rate) {
				logger.Info("Applied persisted scheduler config",
					"key", "scheduler_starvation_lottery_rate", "value", val)
			}
		}
	}
	if val := read("scheduler_max_schedule_iterations"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			if se.SetMaxScheduleIterations(n) {
				logger.Info("Applied persisted scheduler config",
					"key", "scheduler_max_schedule_iterations", "value", val)
			}
		}
	}
}

// applyPersistedDomainConfig loads the per-domain admission tuning keys from
// app_configs so user-saved values survive restarts. Out-of-range values are
// clamped rather than rejected, so a bad manual edit degrades to a usable
// setting instead of disabling the gate.
func applyPersistedDomainConfig(ctrl *stealth.DomainAdmissionController, database *db.Database, logger *infra.Logger) {
	if ctrl == nil {
		return
	}
	cfg := stealth.DefaultDomainAdmissionConfig()

	read := func(key string) string {
		var val string
		if err := database.QueryRow(context.Background(),
			`SELECT value FROM app_configs WHERE key = ?`, key).Scan(&val); err != nil {
			return ""
		}
		return val
	}

	if val := read("domain_max_concurrent"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			cfg.MaxPerDomain = clampInt(n, 1, 20)
		}
	}
	if val := read("domain_probe_threshold"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			cfg.ProbeThreshold = clampInt(n, 1, 500)
		}
	}
	if val := read("domain_probe_concurrency"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			cfg.ProbeConcurrency = clampInt(n, 1, 16)
		}
	}
	if val := read("domain_cooldown_base_ms"); val != "" {
		if ms, err := strconv.Atoi(val); err == nil && ms > 0 {
			base := time.Duration(ms) * time.Millisecond
			if base < 5*time.Second {
				base = 5 * time.Second
			}
			if base > 10*time.Minute {
				base = 10 * time.Minute
			}
			stealth.GetDomainHealthTracker().SetCooldown(base)
		}
	}

	ctrl.Configure(cfg)
	logger.Info("Per-domain admission configured",
		"maxPerDomain", cfg.MaxPerDomain,
		"probeThreshold", cfg.ProbeThreshold,
		"probeConcurrency", cfg.ProbeConcurrency)
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// isLikelyAntiBot checks whether a scrape error pattern suggests the
// page is protected by a CloudFlare/WAF challenge that blocks headless
// Chrome. When true, the caller should escalate to a headful (visible)
// browser as a last resort.
func isLikelyAntiBot(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	for _, sig := range []string{
		"cf-", "cloudflare", "challenge", "captcha", "turnstile",
		"403", "access denied", "forbidden",
		"deadline exceeded", // headless Chrome stuck on JS challenge
		"navigation failed", // chromedp couldn't even load the page
		"context deadline exceeded",
	} {
		if strings.Contains(lower, sig) {
			return true
		}
	}
	return false
}

// validateDatabaseSchema verifies the core entity tables exist right after
// the database opens. NewDatabase applies embedded migrations, so a missing
// table means the resolved path points at a different file or a migration
// failed, and the operator needs to know immediately.
func validateDatabaseSchema(logger *infra.Logger, database *db.Database) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var missing []string
	for _, table := range []string{"galleries", "download_tasks", "sniff_tasks"} {
		var name string
		err := database.QueryRow(ctx,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name)
		if err != nil || name == "" {
			missing = append(missing, table)
		}
	}
	if len(missing) > 0 {
		logger.Error("Database schema check FAILED — core tables missing; the server may be pointed at the wrong database file",
			map[string]any{"missingTables": strings.Join(missing, ", ")})
		return
	}

	// Visibility: report row counts so an accidentally-empty database is
	// obvious at startup rather than discovered through mysterious 404s.
	var galleries, tasks int
	_ = database.QueryRow(ctx, `SELECT COUNT(*) FROM galleries`).Scan(&galleries)
	_ = database.QueryRow(ctx, `SELECT COUNT(*) FROM download_tasks`).Scan(&tasks)
	logger.Info("Database schema check passed", map[string]any{
		"galleries":     galleries,
		"downloadTasks": tasks,
	})
}

// computeGalleryTerminalStatus derives a gallery's terminal status label
// from its persisted content counts, matching the download executor's own
// semantics: "completed" only when every expected file was downloaded,
// "partial" when some succeeded, "failed" when nothing did. The DAG-level
// terminal guard rail uses it so a crashed or overwritten executor write
// cannot leave the entity stuck at "downloading", and so a partial download
// is never masked as completed.
//
// ZIP-downloaded galleries have no per-file gallery_images/videos records;
// a gallery_download_infos row with a non-zero actual_size marks that the
// archive pipeline finished, so those are classified "completed".
func computeGalleryTerminalStatus(ctx context.Context, database *db.Database, galleryID int) string {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var expectedImgs, downloadedImgs, expectedVids, downloadedVids, zipCount int
	err := database.QueryRow(queryCtx, `
		SELECT
			(SELECT COUNT(*) FROM gallery_images WHERE gallery_id = ?1) AS expected_imgs,
			(SELECT COUNT(*) FROM gallery_images WHERE gallery_id = ?1 AND status = 'downloaded') AS downloaded_imgs,
			(SELECT COUNT(*) FROM gallery_videos WHERE gallery_id = ?1) AS expected_vids,
			(SELECT COUNT(*) FROM gallery_videos WHERE gallery_id = ?1 AND status = 'downloaded') AS downloaded_vids,
			(SELECT COUNT(*) FROM gallery_download_infos WHERE gallery_id = ?1 AND COALESCE(actual_size, 0) > 0) AS zip_count`,
		galleryID).Scan(&expectedImgs, &downloadedImgs, &expectedVids, &downloadedVids, &zipCount)
	if err != nil {
		// The DAG aggregate already reported success, so fall back to
		// "completed" when the content counts cannot be read.
		return "completed"
	}

	switch {
	case zipCount > 0:
		return "completed"
	case expectedImgs == 0 && expectedVids == 0:
		// No content records at all and no ZIP — treat as failed so the
		// shelf surfaces an actionable state instead of a fake completion.
		return "failed"
	case downloadedImgs == expectedImgs && downloadedVids == expectedVids:
		return "completed"
	case downloadedImgs > 0 || downloadedVids > 0:
		return "partial"
	default:
		return "failed"
	}
}

// marshalStrSlice serializes a string slice to JSON, returning "[]" for
// nil slices instead of "null" (json.Marshal(nil) produces "null").
func marshalStrSlice(s []string) []byte {
	if s == nil {
		return []byte("[]")
	}
	b, _ := json.Marshal(s)
	return b
}

// preWriteVideoInfo writes scraped metadata (title, tags, actors,
// categories, director) to video_infos right after scraping and before the
// download starts, so metadata is visible during the download phase.
func preWriteVideoInfo(ctx context.Context, database *db.Database, taskID int, result *sites.ScrapeResult) {
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tagsJSON := marshalStrSlice(result.Tags)
	actorsJSON := marshalStrSlice(result.Actors)
	categoriesJSON := marshalStrSlice(result.Categories)

	// Every metadata column is guarded against a non-empty overwrite: a later
	// scrape attempt that returns no tags or actors must not wipe what an
	// earlier successful scrape persisted.
	_, err := database.Exec(writeCtx, `
		INSERT INTO video_infos (task_id, title, source_url, tags, actors, categories, director)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (task_id) DO UPDATE SET
			title = CASE WHEN COALESCE(EXCLUDED.title, '') != '' THEN EXCLUDED.title ELSE video_infos.title END,
			source_url = CASE WHEN COALESCE(EXCLUDED.source_url, '') != '' THEN EXCLUDED.source_url ELSE video_infos.source_url END,
			tags = CASE WHEN EXCLUDED.tags != '[]' AND EXCLUDED.tags != '' THEN EXCLUDED.tags ELSE video_infos.tags END,
			actors = CASE WHEN EXCLUDED.actors != '[]' AND EXCLUDED.actors != '' THEN EXCLUDED.actors ELSE video_infos.actors END,
			categories = CASE WHEN EXCLUDED.categories != '[]' AND EXCLUDED.categories != '' THEN EXCLUDED.categories ELSE video_infos.categories END,
			director = CASE WHEN COALESCE(EXCLUDED.director, '') != '' THEN EXCLUDED.director ELSE video_infos.director END
	`, taskID, result.Title, result.PageURL,
		string(tagsJSON), string(actorsJSON), string(categoriesJSON),
		result.Director)
	if err != nil {
		infra.NewLogger("Server").Warn("Failed to pre-write video metadata",
			infra.LogContext{Extra: map[string]any{
				"taskId": taskID,
				"error":  err.Error(),
			}})
	}
}
