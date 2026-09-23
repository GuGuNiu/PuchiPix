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
	"backend/internal/taskprogress"
	"backend/internal/titleparser"
	"backend/resources"
)

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

	// Pre-open visibility check: surface WHICH database file we are about
	// to open and whether it already exists. The 260821 incident had air
	// hot-reload silently resolve to an empty backend/data database — every
	// API then 404'd while the server looked healthy. An about-to-be-created
	// file is often legitimate (first run), but it deserves a loud warning.
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
		// Post-open schema sanity check: a healthy database must contain the
		// core entity tables. An empty schema here means we just created a
		// fresh DB (first run) or opened the WRONG file — failing fast beats
		// serving 404s from a silently-empty database.
		validateDatabaseSchema(logger, database)
	}

	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry
	var progressEngine *taskprogress.Engine
	var videoTracker *taskprogress.VideoProgressTracker
	var dm *video.DownloadManager
	var flowCtrl *governor.FlowController
	var flowCtrlStarted bool

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

	if database != nil {
		logger.Info("Initializing DAG scheduler")

		eventStore := orchestrator.NewEventStore(database, eventBus)
		eventStore.StartAsyncWriter()

		siteReg := sites.GetSiteRegistry()

		progressEngine = taskprogress.NewEngine(logger)
		progressEngine.SetDatabase(database)
		videoTracker = taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())

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
		go slotPool.StartHealthCheck(healthCtx, 5*time.Second, 10*time.Minute)
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
				gid, _ := nodeDef.Config["galleryId"].(int)
				if gid > 0 {
					_, err := database.Exec(ctx,
						`UPDATE galleries SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						dbStatus, gid)
					if err != nil {
						logger.Warn("Node status sync failed (gallery)", "galleryId", gid, "error", err.Error())
					}
					// Emit the synced status so SSE clients see the SAME
					// value the DB now holds — the FSM→DB→SSE chain must be
					// atomic from the frontend's perspective. Previously the
					// API layer duplicated both the DB write and a hardcoded
					// SSE status after resume/retry, which reintroduced the
					// "fake scraping" divergence (260821/260822) whenever the
					// hardcoded label disagreed with what statusSync wrote.
					eventBus.Emit("task:progress", map[string]any{
						"taskId":   gid,
						"taskType": "gallery",
						"status":   dbStatus,
					})
				}
			case nodeDef.Config["taskSeq"] != nil:
				seq, _ := nodeDef.Config["taskSeq"].(string)
				if seq != "" {
					_, err := database.Exec(ctx,
						`UPDATE download_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE seq = ?`,
						dbStatus, seq)
					if err != nil {
						logger.Warn("Node status sync failed (video)", "seq", seq, "error", err.Error())
					}
					if taskID, _ := nodeDef.Config["taskId"].(int); taskID > 0 {
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

		// DAG-level terminal guard rail (see DagOrchestrator.checkDagCompletion).
		// Entity completion is normally written by executors together with
		// richer data (sizes / file paths / partial classification). But two
		// documented gaps left entities permanently stuck in an ACTIVE status
		// after the whole DAG finished:
		//
		//   1. Post-download nodes (extract/verify) transition through
		//      QUEUED/RUNNING, and statusSync maps PhaseFinalize back to
		//      "downloading" — overwriting the executor's terminal write
		//      ("100% + downloading forever", 260820/01).
		//   2. An executor crash between node completion and its final
		//      UPDATE leaves nothing to write the terminal status at all
		//      (260817 ticket 06 crash-recovery blind spot).
		//
		// This guard rail runs once at DAG terminal aggregate and performs a
		// CONDITIONAL write: it only touches entities still holding an active
		// status, and derives the gallery terminal label from content counts
		// (mirroring the executor's completed/partial semantics) so a
		// partial download is never masked as completed. Executor-owned
		// terminal statuses (completed/partial/failed/cancelled) are never
		// clobbered because the WHERE clause excludes them.
		dagOrch.SetDagStatusSyncFn(func(ctx context.Context, dagID string, def orchestrator.DagDefinition, aggregateStatus string) {
			if len(def.Nodes) == 0 {
				return
			}
			switch {
			case def.TaskType == orchestrator.TaskTypeGallery:
				gid, _ := def.Nodes[0].Config["galleryId"].(int)
				if gid <= 0 {
					return
				}
				if aggregateStatus != "completed" {
					return
				}
				terminal := computeGalleryTerminalStatus(ctx, database, gid)
				// The healable set includes 'failed': a verify needs_retry
				// writes "failed", and if its auto-retry then succeeds, the
				// finalize nodes no longer rewrite the entity (see
				// StatusReporter) — only this guard rail can restore the
				// content-derived terminal status. The computed terminal is
				// derived from real content counts, so a genuine failure
				// (nothing downloaded) still resolves to failed/partial.
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
					 WHERE seq = ? AND status IN ('scraping', 'downloading', 'merging', 'transcoding', 'pending', 'paused', 'failed')`, seq)
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

		// Flow control: front-gate admission controller + adaptive
		// governor. Limits task entry rate based on factory pressure
		// (slot usage + queue depth). Prevents large batch imports
		// from overwhelming the task factory. Enabled by default;
		// the Governor adjusts admission rate automatically.
		//
		// Placed after sched+slotPool are wired so the PressureMonitor
		// can read real-time queue depth via sched.QueueDepth().
		flowCtrl = governor.NewFlowController(slotPool, sched, governor.DefaultFlowControllerConfig())
		dagOrch.SetFlowController(flowCtrl)

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

		// Start the flow control governor after the orchestrator is
		// initialized. The governor's control loop samples pressure
		// every tick interval and adjusts admission rate.
		flowCtrl.Start(ctx)
		flowCtrlStarted = true

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
						// Align with the DAG restore semantics: snapshot.go
						// defaultOnRestart / galleryOnRestart transition every
						// non-terminal node to PAUSED after restart, so the DB
						// must say "paused" (user decides when to resume) rather
						// than "pending" — otherwise the frontend shows waiting
						// while the DAG actually holds the node paused.
						_, _ = database.Exec(recoveryCtx,
							`UPDATE galleries SET status = 'paused', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
							o.id)
					}
				}
			}

			_, _ = database.Exec(recoveryCtx,
				`UPDATE gallery_videos SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'failed')`)

			_, _ = database.Exec(recoveryCtx,
				`UPDATE download_tasks SET status = 'paused', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'scraping')`)
		}

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

		logger.Info("DAG scheduler initialized")

		// Do NOT call eventStore.Flush() here: dagOrch.Shutdown already
		// invokes it. A duplicate call obscures the persistence ownership.
		// dagOrch.Shutdown() and sched.Stop() are called inline in the
		// graceful shutdown section below, BEFORE database.Close() — the
		// final snapshot needs DB access.

		dataStore := sites.GetSiteDataStore()
		blocklistSvc := sites.NewBlocklistService(database)
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

	if database != nil {
		siteReg := sites.GetSiteRegistry()
		ouoOrch := orchestrator.NewOuoOrchestrator()
		dmCfg := video.DefaultManagerConfig()
		dmCfg.DownloadPath = filepath.Join(cfg.DataDir, "videos")
		dmCfg.SegmentsPath = filepath.Join(cfg.DataDir, "segments")
		dm = video.NewDownloadManager(database, eventBus, dmCfg)

		// Auto-enable GPU transcoding on discrete GPUs and disable it on
		// integrated/unknown GPUs (the user can override from the config
		// page). Runs once when no persisted choice exists.
		dm.AutoConfigureGPU()
		// Mirror the GPU decision to the gallery pipeline so gallery video
		// merge honors the same gpu_transcode setting as the independent
		// video pipeline.
		gpuEnabled, gpuForce, _ := dm.GetGPUTranscodeStatus()
		dlDefaults.GPUTranscode = gpuEnabled
		dlDefaults.ForceGPUType = gpuForce

		// Inject the video segment tracker into the download manager so
		// that RegisterSegments and UpdateSegment are called from the
		// download pipeline. This bridges the gap where the tracker was
		// initialized but never connected to the segment queue.
		dm.SetTracker(videoTracker)

		// WireExecutors (called during DAG init above) only registers gallery
		// executors; DownloadManager is created later. Video DAGs would fail
		// with "no executor registered for key: video:download" without this.
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

			// taskLoaderFn loads the full DownloadTaskInput from the
			// database. If m3u8_url is empty, it scrapes the page URL
			// via the universal scraper to discover the M3U8 stream URL.
			// Uses StrategySelector to choose HTTP-first vs chromedp based
			// on site configuration and runtime conditions, with automatic
			// domain failover through DomainHealthTracker.
			strategySelector := orchestrator.NewStrategySelector()
			// Remove hardcoded "universal" from JSSites so it participates
			// in the auto-selection path instead of being forced chromedp.
			delete(strategySelector.JSSites, "universal")

			taskLoaderFn := func(ctx context.Context, taskID int) (video.DownloadTaskInput, error) {
				// Delegate to the shared video preparation helper: ensures the
				// M3U8 URL is identified (idempotent; a legacy single-node DAG may
				// reach the download node without a preceding video:scrape node)
				// and assembles the full DownloadTaskInput (referer domains, metadata).
				//
				// The helper now uses canonical seq IDs, so we look up the seq
				// from the numeric taskID first.
				var seq string
				if err := database.QueryRow(ctx, "SELECT seq FROM download_tasks WHERE id = ?", taskID).Scan(&seq); err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("resolve seq for task %d: %w", taskID, err)
				}
				if seq == "" {
					seq = idgen.GenerateID()
					database.Exec(ctx, "UPDATE download_tasks SET seq = ? WHERE id = ?", seq, taskID)
				}
				return loadVideoTaskInput(ctx, database, h.SiteReg, strategySelector, eventBus, logger, seq)
			}

			// Register the video identification executor (video:scrape). The
			// identification runs in a dedicated DAG node that acquires the
			// *scraping* slot, so video identification concurrency is bounded
			// by maxScrapingTasks — the fix for "all tasks started identifying / full".
			//
			// The scrapeFn receives the canonical taskSeq (uppercase-alphanumeric)
			// and looks up the task by seq, unifying ID format across the site.
			exeReg.Register(executors.NewVideoScrapeExecutor(func(ctx context.Context, taskSeq string) error {
				_, _, _, err := sniffVideoM3U8(ctx, database, h.SiteReg, strategySelector, eventBus, logger, taskSeq)
				return err
			}))
			exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn, videoTracker))

			// No DAG recovery here: unfinished tasks stay 'pending' after restart.
			// The user's "start" action creates a fresh DAG when ready.
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

	// ── Graceful shutdown sequence ──
	// Order matters: each step depends on the ones before it still being
	// alive. The database must be the LAST resource closed because
	// dagOrch.Shutdown() writes a final snapshot to it.
	//
	// 1. Stop HTTP server (no new requests)
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server forced to shutdown", err)
	}

	// 2. Stop DownloadManager (cancel active downloads, write cancelled
	// status to DB — needs DB still open)
	if dm != nil {
		dm.Stop()
		logger.Info("Download manager stopped")
	}

	// 3. Stop FlowController governor loop (stop admission rate adjustments)
	if flowCtrlStarted {
		flowCtrl.Stop()
		logger.Info("Flow controller stopped")
	}

	// 4. DAG orchestrator shutdown: drain scheduler, flush event store,
	// write final snapshot — all need DB access.
	if dagOrch != nil {
		dagShutdownCtx, dagShutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := dagOrch.Shutdown(dagShutdownCtx); err != nil {
			logger.Error("DAG shutdown error", err)
		}
		dagShutdownCancel()
	}

	// 5. Stop scheduler (after DAG drain is complete)
	if sched != nil {
		sched.Stop()
		logger.Info("Scheduler stopped")
	}

	// 6. Close database (LAST — after all DB writers have stopped)
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
	// Delegate to the orchestrator's production implementation, which
	// returns a *orchestrator.DagNodeForVerification (or nil if the
	// DAG/node does not exist). Previously this returned nil unconditionally,
	// breaking the entire verification chain (StateReconciler could never
	// be invoked). The scheduler calls this during the VERIFYING phase to
	// drive side-effect checks and needs_retry auto-retry.
	return a.orch.GetNodeForVerification(dagID, nodeID)
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
// app_configs and applies them to the engine at startup (260817 ticket 11),
// mirroring applyPersistedSlotMax: user-saved starvation threshold /
// lottery rate / max schedule iterations survive restarts. The engine's
// setters validate ranges; invalid or absent keys keep defaults.
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
// the database opens. NewDatabase applies embedded migrations, so a healthy
// path always has them; a missing table means the file is not a PuchiPix
// database (wrong path resolved — e.g. air hot-reload cwd drift, 260821) or
// the migration failed. Either way the operator must know immediately.
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
// from its persisted content counts, mirroring the download executor's
// own semantics ("completed" only when every expected file was downloaded,
// "partial" when some succeeded, "failed" when nothing did). It is used by
// the DAG-level terminal guard rail so a crashed or overwritten executor
// write cannot leave the entity stuck at "downloading" — and so a partial
// download is never masked as completed by the guard rail itself.
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
		// Cannot inspect content: fall back to "completed" — the DAG
		// aggregate already said the pipeline finished successfully.
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

// preWriteVideoInfo writes scraped metadata (title, tags, actors,
// categories, director) to the video_infos table immediately after
// scraping completes and before the download starts. This mirrors the
// original TS scrapeVideoAsync behavior where downloadTask.update with
// videoInfo was called right after scraping, so users can see metadata
// during the potentially long download phase.
// marshalStrSlice serializes a string slice to JSON, returning "[]" for
// nil slices instead of "null" (json.Marshal(nil) produces "null").
func marshalStrSlice(s []string) []byte {
	if s == nil {
		return []byte("[]")
	}
	b, _ := json.Marshal(s)
	return b
}

func preWriteVideoInfo(ctx context.Context, database *db.Database, taskID int, result *sites.ScrapeResult) {
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tagsJSON := marshalStrSlice(result.Tags)
	actorsJSON := marshalStrSlice(result.Actors)
	categoriesJSON := marshalStrSlice(result.Categories)

	// Non-empty guard on every metadata column: a later scrape attempt
	// (e.g. retry) that returns no tags/actors must NOT wipe metadata
	// already persisted by a previous successful scrape. This mirrors
	// the CASE-guarded upsert in DownloadManager.upsertVideoInfo —
	// without it an empty retry erased good tags/actors (2026-09-05
	// defect: "empty result upserted over good metadata").
	_, err := database.Exec(writeCtx, `
		INSERT INTO video_infos (task_id, title, source_url, tags, actors, categories, director)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (task_id) DO UPDATE SET
			title = CASE WHEN COALESCE(EXCLUDED.title, '') != '' THEN EXCLUDED.title ELSE video_infos.title END,
			source_url = EXCLUDED.source_url,
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
