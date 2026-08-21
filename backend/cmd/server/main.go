package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/policies"
	orchsched "backend/internal/orchestrator/scheduler"
	"backend/internal/orchestrator/slot"
	"backend/internal/sites"
	"backend/internal/sites/aimeizizi"
	"backend/internal/sites/exhentai"
	"backend/internal/sites/kanav"
	"backend/internal/sites/fourkhd"
	siteSjs "backend/internal/sites/sjs"
	"backend/internal/sites/universal"
	"backend/internal/sites/xsnvshen"
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

	// ── Database ──
	database, dbErr := db.NewDatabase(cfg.DatabasePath, nil)
	if dbErr != nil {
		logger.Warn("Database unavailable, starting in degraded mode",
			"error", dbErr.Error())
	}

	// ── DAG Scheduler (only when database is available) ──
	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry
	var progressEngine *taskprogress.Engine
	var videoTracker *taskprogress.VideoProgressTracker

	// dlDefaults is declared outside the if-block so both the first
	// (WireExecutors) and second (WithDownloadDefaults) if-database
	// scopes can access it. Task-settings updates mutate this pointer
	// at runtime to change gallery/video concurrency live.
	dlDefaults := &downloader.DownloadDefaults{
		MultiThread:            cfg.DownloadMultiThread,
		Concurrency:            cfg.DownloadConcurrency,
		MaxSpeed:               cfg.DownloadMaxSpeed,
		MinFileSize:            cfg.DownloadMinFileSize,
		GalleryImageConcurrent: cfg.GalleryImageConcurrent,
		VideoMaxConcurrent:     cfg.VideoMaxConcurrent,
		TSegmentConcurrent:     cfg.TSegmentConcurrent,
	}
	// Configure the process-wide aggregate download cap (pressure valve).
	downloader.SetGlobalDownloadConcurrent(cfg.GlobalDownloadConcurrent)

	if database != nil {
		logger.Info("Initializing DAG scheduler")

		// 1. EventStore ??persistence + event sourcing for DAG recovery
		eventStore := orchestrator.NewEventStore(database, eventBus)
		eventStore.StartAsyncWriter()

		// 2. Site Registry ??provider lookup for scrape executor
		siteReg := sites.GetSiteRegistry()

		// 3. Initialize progress tracking engine and video segment tracker.
		// These are created early so they can be passed to WireExecutors
		// for gallery pipeline integration, and later to DownloadManager
		// and VideoDownloadExecutor for video pipeline integration.
		progressEngine = taskprogress.NewEngine(logger)
		// Attach the database so per-file progress and the download-phase
		// state machine can be persisted for checkpoint-based retry.
		progressEngine.SetDatabase(database)
		videoTracker = taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())

		// 3a. Build title parser with embedded model/character data.
		// The parser is used in the scrape pipeline to extract protagonist
		// names from gallery titles when the site provider does not return one.
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

		// 4. Slot Pool ??concurrency control
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

		// 4a. Load persisted concurrency settings from app_configs so the
		// user's saved "识别中最大数量" / "下载并发" / "嗅探并发" values are
		// applied at startup. Previously these were only written by the
		// settings API and applied to the live pool at save time — a
		// restart silently reverted the pool to the hardcoded defaults,
		// which made a raised scraping cap appear to "顶破设计范围".
		applyPersistedSlotMax(slotPool, database, logger, "max_concurrent_tasks", "download")
		applyPersistedSlotMax(slotPool, database, logger, "max_scraping_tasks", "scraping")
		applyPersistedSlotMax(slotPool, database, logger, "max_concurrent_sniff_tasks", "sniff")

		// 4b. Stream slot state changes over the EventBus so SSE clients
		// (via /api/tasks/stream, which forwards slot:stateChanged) observe
		// acquire / release / max / quota updates in real-time without
		// polling. Payload mirrors the SlotStateChange shape with an extra
		// timestamp.
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

		// 4c. Periodic slot-pool health check: self-heal running-vs-
		// activeSlots drift (P-SLOT-01 ghost slots) and release stale
		// holders that outlive the 10-minute video/download timeout.
		// Runs until the process exits (background context, cancelled
		// by the deferred cancel below).
		healthCtx, healthCancel := context.WithCancel(context.Background())
		go slotPool.StartHealthCheck(healthCtx, 5*time.Second, 10*time.Minute)
		defer healthCancel()

		// 5. DagOrchestrator ??full lifecycle management
		dagOrch = dag.NewDagOrchestrator(eventStore, slotPool)

		// 5b. StateReconciler ??verifies node side effects (needs_retry
		// auto-retry for interrupted scrapes, RESUME_VERIFY checkpoint
		// recovery). Injected into the orchestrator so the scheduler's
		// GetNodeForVerification callback can route to it.
		stateReconciler := orchestrator.NewStateReconciler(database)
		dagOrch.SetReconciler(stateReconciler)

		// 5c. TaskTypeRegistry ??registers per-TaskType TransitionPolicy
		// so nodes get config-driven state-machine behavior (guards,
		// actions, retryPolicy, onPause/onResume/onRestart) even when
		// their DagNodeDefinition was persisted before the strategy
		// layer existed. This ports the 260720 TS TaskTypeRegistry.
		taskTypeRegistry := orchestrator.NewTaskTypeRegistry()
		taskTypeRegistry.RegisterTransitionPolicy(orchestrator.TaskTypeGallery, policies.GalleryNodePolicy)
		dagOrch.SetTaskTypeRegistry(taskTypeRegistry)

		// Wire EventBus into DagOrchestrator so SSE/WS clients receive
		// dag:nodeProgress events for real-time gallery DAG progress.
		dagOrch.SetEventBus(eventBus)

		// 5d. Node-level DB status sync: push FSM states back to the
		// entity tables (galleries / download_tasks / sniff_tasks) via
		// orchestrator.StatusReporter. Unlike the previous
		// terminal-states-only mapping, every user-observable state is
		// now reported:
		//   QUEUED/ALLOCATED/RUNNING → scraping/downloading/sniffing
		//   READY (scheduler-rejected) → pending (等待中)
		//   PAUSED → paused; FAILED/TIMEOUT → failed; CANCELLED → cancelled
		// This closes the defect where rejected nodes left the DB stuck
		// at "scraping" — every batch-created task looked like it was
		// identifying ("全部启动识别/满仓") while the scheduler had never
		// dispatched it (metrics showed totalScheduled << task count).
		// "completed" is intentionally NOT written here: the executors
		// write it with richer data (file counts, paths, partial).
		// Best-effort: failures are logged, never fatal.
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
				}
			case nodeDef.Config["taskId"] != nil:
				tid, _ := nodeDef.Config["taskId"].(int)
				if tid > 0 {
					_, err := database.Exec(ctx,
						`UPDATE download_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						dbStatus, tid)
					if err != nil {
						logger.Warn("Node status sync failed (video)", "taskId", tid, "error", err.Error())
					}
				}
			case nodeDef.Config["sniffId"] != nil:
				sid, _ := nodeDef.Config["sniffId"].(int)
				if sid > 0 {
					_, err := database.Exec(ctx,
						`UPDATE sniff_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						dbStatus, sid)
					if err != nil {
						logger.Warn("Node status sync failed (sniff)", "sniffId", sid, "error", err.Error())
					}
				}
			}
		})

		// 6. SchedulerEngine ??node selection and dispatch
		sched = orchsched.NewSchedulerEngine(slotPool)

		// 7. Wire scheduler ??orchestrator via adapters (both directions)
		schedAdapter := &schedulerAdapter{sched: sched}
		dagOrch.SetScheduler(schedAdapter)

		orchAdapter := &orchestratorAdapter{orch: dagOrch}
		sched.SetDagOrchestrator(orchAdapter)

		// 8. Wire executor function ??the bridge from scheduler to executors
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

		// 9. Initialize (restore from snapshots, replay events)
		ctx := context.Background()
		if err := dagOrch.Initialize(ctx); err != nil {
			logger.Error("DAG orchestrator init failed", err)
		}

		// 9b. Per the design requirement, ALL unfinished tasks should
		// transition to PAUSED on restart — no auto-execution. The
		// onRestart policy in restoreDag (snapshot.go) handles the
		// DAG-level state transitions (RUNNING/QUEUED/READY/etc. →
		// PAUSED). We intentionally do NOT call ReactivateReadyNodes
		// here, because that would immediately re-submit paused nodes
		// for execution. The periodic auto-reactivation ticker (started
		// below) only processes READY nodes, and since all restored
		// nodes are PAUSED, it remains a no-op until the user manually
		// starts or resumes tasks via the UI.

		// 9c. Crash recovery: reset stale gallery and video statuses to
		// 'pending' so the user sees them as "等待中" in the UI. We do
		// NOT auto-recreate DAGs — the user decides when to start each
		// task. After a server crash, in-flight galleries are left with
		// "downloading" or "scraped" status; this step resets them to
		// "pending" and leaves DAG recreation to the user's "start"
		// action.
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
						// Reset gallery status to pending — do NOT recreate
						// the DAG; the user starts it manually.
						_, _ = database.Exec(recoveryCtx,
							`UPDATE galleries SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
							o.id)
					}
				}
			}

		// Also reset stale gallery_videos statuses.
		_, _ = database.Exec(recoveryCtx,
			`UPDATE gallery_videos SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'failed')`)

		// Reset stale video tasks (download_tasks) status to 'pending'.
		// NOTE: Must include 'scraping' (identifying phase) — tasks
		// crashed during identification were previously left stranded
		// in 'scraping' because this query only covered
		// 'downloading' + 'pending'.
		_, _ = database.Exec(recoveryCtx,
			`UPDATE download_tasks SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'pending', 'scraping')`)
		}

		// 10. Start periodic scan + queue capacity sync
		sched.SyncQueueCapacityFromSlotPool()
		sched.StartScanTimer(2 * time.Second)

		// 10a. Sync DAG terminal failures back to the galleries table.
		// The DAG orchestrator emits gallery:stateChanged when a gallery
		// DAG ends failed/cancelled; executors may have left
		// galleries.status at 'completed'/'partial' (their local view),
		// so without this the frontend shows a completed gallery that
		// actually failed verification. This subscription keeps the DB
		// the single source of truth for the shelf UI.
		//
		// The DB write runs in a fire-and-forget goroutine so the
		// EventBus emitter (DAG orchestrator) is never blocked on DB
		// I/O. The write is idempotent (UPDATE ... WHERE dag_id = ?)
		// and best-effort (failures only lose a status sync that the
		// next event or manual refresh will correct).
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

		// 10b. Periodic READY-node reactivation. A node whose Submit was
		// rejected (queue full / draining) is rolled back to READY by
		// submitToScheduler; nothing else ever re-submits it, so without
		// this ticker such nodes (and their DAGs) stall forever until a
		// manual `puchipix-cli trigger`. The scan converges once the
		// scheduler queue frees up.
		reactivationCtx, reactivationCancel := context.WithCancel(context.Background())
		dagOrch.StartAutoReactivation(reactivationCtx, 5*time.Second)
		defer reactivationCancel()

		logger.Info("DAG scheduler initialized")

		// Shutdown hook for graceful DAG teardown.
		// Shutdown sequence: drain scheduler ??flush event store ??snapshot.
		// eventStore.Flush() is invoked inside dagOrch.Shutdown; do NOT call
		// it again here ??Flush is idempotent (guarded by asyncStarted) but a
		// duplicate call obscures the ownership of the persistence sequence.
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := dagOrch.Shutdown(shutdownCtx); err != nil {
				logger.Error("DAG shutdown error", err)
			}
			sched.Stop()
		}()

		// 11. Supporting services ??blocklist, accounts, OUO, downloads
		dataStore := sites.GetSiteDataStore()
		blocklistSvc := sites.NewBlocklistService(database)
		accountMgr := sites.NewSiteAccountManager(database)

		// 12. Register all site providers onto the registry
		siteReg.Register(aimeizizi.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(kanav.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(siteSjs.NewProvider(dataStore, accountMgr))
		siteReg.Register(exhentai.NewProvider(dataStore))
		siteReg.Register(xsnvshen.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(fourkhd.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(universal.NewProvider())
		logger.Info("Site providers registered", "count", 7)
	}

	// ── HTTP Handlers ──
	h := api.New(database, eventBus)

	// Inject DAG and service dependencies when database is available
	if database != nil {
		siteReg := sites.GetSiteRegistry()
		ouoOrch := orchestrator.NewOuoOrchestrator()
		dmCfg := video.DefaultManagerConfig()
		dmCfg.DownloadPath = filepath.Join(cfg.DataDir, "videos")
		dmCfg.SegmentsPath = filepath.Join(cfg.DataDir, "segments")
		dm := video.NewDownloadManager(database, eventBus, dmCfg)

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

		// Register the video download executor now that DownloadManager
		// is available. WireExecutors (called during DAG init above) only
		// registers gallery executors because DownloadManager is created
		// later. Without this, video DAGs fail with "no executor
		// registered for key: video:download".
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
				return loadVideoTaskInput(ctx, database, h.SiteReg, strategySelector, eventBus, logger, taskID)
			}

			// Register the video identification executor (video:scrape). The
			// identification runs in a dedicated DAG node that acquires the
			// *scraping* slot, so video identification concurrency is bounded
			// by maxScrapingTasks — the fix for "大量任务全部启动识别/满仓".
			exeReg.Register(executors.NewVideoScrapeExecutor(func(ctx context.Context, taskID int) error {
				_, _, _, err := sniffVideoM3U8(ctx, database, h.SiteReg, strategySelector, eventBus, logger, taskID)
				return err
			}))
		exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn, videoTracker))

		// Post-executor-registration video DAG recovery is intentionally
		// skipped. Per the design requirement, unfinished tasks should
		// remain in 'pending' status after restart — the user decides when
		// to start each task via the UI. The DB status reset (earlier in
		// the crash recovery block) already marked these tasks 'pending';
		// no DAG recreation is needed because the user's "start" action
		// will create a fresh DAG when ready.
	}

		// Progress engine and video tracker were created earlier during
		// DAG initialization so they could be passed to WireExecutors.
		// Here we just inject them into the API handlers.

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

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("Shutting down server")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("Server forced to shutdown", err)
	}
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
// saved "识别中最大数量" / "下载并发" / "嗅探并发" values survive restarts.
// No-op when the config key is absent or invalid (pool keeps defaults).
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

	_, err := database.Exec(writeCtx, `
		INSERT INTO video_infos (task_id, title, source_url, tags, actors, categories, director)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (task_id) DO UPDATE SET
			title = EXCLUDED.title,
			source_url = EXCLUDED.source_url,
			tags = EXCLUDED.tags,
			actors = EXCLUDED.actors,
			categories = EXCLUDED.categories,
			director = EXCLUDED.director
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
