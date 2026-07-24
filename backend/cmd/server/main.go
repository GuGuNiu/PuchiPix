package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"

	"backend/internal/api"
	"backend/internal/config"
	"backend/internal/db"
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
	siteSjs "backend/internal/sites/sjs"
	"backend/internal/sites/universal"
	"backend/internal/sites/xsnvshen"
)

func main() {
	infra.InitGlobalConfig("INFO", true)

	// ── Embedded PostgreSQL ──
	// Starts a project-local PostgreSQL process. Falls back to external
	// PostgreSQL (or degraded mode) if startup fails ??5432 already in use,
	// binary download failure, etc.
	embeddedPg := startEmbeddedPG()
	if embeddedPg != nil {
		defer func() {
			if err := embeddedPg.Stop(); err != nil {
				fmt.Fprintf(os.Stderr, "embedded-postgres stop: %v\n", err)
			}
		}()
	}

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

	if embeddedPg != nil {
		logger.Info("Embedded PostgreSQL started", "port", 5432)
	}

	// ── Database ──
	database, dbErr := db.NewDatabase(cfg.DatabaseURL, nil)
	if dbErr != nil {
		logger.Warn("Database unavailable, starting in degraded mode")
	}

	// ── DAG Scheduler (only when database is available) ──
	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry

	if database != nil {
		logger.Info("Initializing DAG scheduler")

		// 1. EventStore ??persistence + event sourcing for DAG recovery
		eventStore := orchestrator.NewEventStore(database, eventBus)
		eventStore.StartAsyncWriter()

		// 2. Site Registry ??provider lookup for scrape executor
		siteReg := sites.GetSiteRegistry()

		// 3. Executor Registry ??routes node execution by key
		exeReg = executors.NewRegistry()
		orchestrator.WireExecutors(exeReg, siteReg, database)

		// 4. Slot Pool ??concurrency control
		slotPool := slot.NewSlotPool()
		slotPool.RegisterType(slot.SlotTypeDefinition{
			Key:        "scraping",
			Label:      "Scraping",
			DefaultMax: 3,
			Min:        1,
			Max:        5,
		})
		slotPool.RegisterType(slot.SlotTypeDefinition{
			Key:        "download",
			Label:      "Download",
			DefaultMax: 5,
			Min:        1,
			Max:        10,
		})
		slotPool.RegisterType(slot.SlotTypeDefinition{
			Key:        "sniff",
			Label:      "Sniff",
			DefaultMax: 1,
			Min:        1,
			Max:        3,
		})

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

		// 10. Start periodic scan + queue capacity sync
		sched.SyncQueueCapacityFromSlotPool()
		sched.StartScanTimer(2 * time.Second)

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
		siteReg.Register(siteSjs.NewProvider(dataStore, accountMgr))
		siteReg.Register(exhentai.NewProvider(dataStore))
		siteReg.Register(xsnvshen.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(universal.NewProvider())
		logger.Info("Site providers registered", "count", 5)
	}

	// ── HTTP Handlers ──
	h := api.New(database, eventBus)

	// Inject DAG and service dependencies when database is available
	if database != nil {
		siteReg := sites.GetSiteRegistry()
		ouoOrch := orchestrator.NewOuoOrchestrator()
		dm := video.NewDownloadManager(database, eventBus, video.DefaultManagerConfig())

		// Register the video download executor now that DownloadManager
		// is available. WireExecutors (called during DAG init above) only
		// registers gallery executors because DownloadManager is created
		// later. Without this, video DAGs fail with "no executor
		// registered for key: video:download".
		if exeReg != nil {
			statusFn := func(ctx context.Context, taskID int) (string, string, bool) {
				var status, errMsg string
				err := database.QueryRow(ctx,
					`SELECT status, COALESCE(error_msg, '') FROM download_tasks WHERE id = $1`,
					taskID).Scan(&status, &errMsg)
				if err != nil {
					return "", "", false
				}
				return status, errMsg, true
			}

			// taskLoaderFn loads the full DownloadTaskInput from the
			// database. If m3u8_url is empty, it scrapes the page URL
			// via the universal scraper to discover the M3U8 stream URL.
			taskLoaderFn := func(ctx context.Context, taskID int) (video.DownloadTaskInput, error) {
				var pageURL, m3u8URL string
				err := database.QueryRow(ctx,
					`SELECT url, m3u8_url FROM download_tasks WHERE id = $1`,
					taskID).Scan(&pageURL, &m3u8URL)
				if err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("query task %d: %w", taskID, err)
				}

				// If M3U8 URL is already known, use it directly.
				if m3u8URL != "" {
					return video.DownloadTaskInput{
						ID:      taskID,
						M3U8URL: m3u8URL,
						PageURL: pageURL,
					}, nil
				}

				// M3U8 URL not yet discovered — scrape the page.
				logger.Info(fmt.Sprintf("M3U8 URL empty for task %d, scraping page: %s", taskID, pageURL))

				scrapeCtx, scrapeCancel := context.WithTimeout(ctx, 2*time.Minute)
				defer scrapeCancel()

				result, err := universal.ScrapePage(scrapeCtx, pageURL)
				if err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("scrape page for M3U8: %w", err)
				}
				if result.M3U8URL == "" {
					return video.DownloadTaskInput{}, fmt.Errorf("no M3U8 URL found on page: %s", pageURL)
				}

				// Persist the discovered M3U8 URL for future retries.
				_, _ = database.Exec(ctx,
					`UPDATE download_tasks SET m3u8_url = $1 WHERE id = $2`,
					result.M3U8URL, taskID)

				return video.DownloadTaskInput{
					ID:      taskID,
					M3U8URL: result.M3U8URL,
					PageURL: pageURL,
					Title:   result.Title,
					Tags:    result.Tags,
					Actors:  result.Actors,
				}, nil
			}

			exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn))
		}

		h.WithDag(dagOrch, sched, exeReg)
		h.WithServices(ouoOrch, dm, siteReg)
	}

	router := api.NewRouter(h, eventBus)

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

// startEmbeddedPG attempts to start a project-local PostgreSQL 16 instance.
// Returns nil if startup fails ??the server will fall back to the external
// PostgreSQL configured in DATABASE_URL, or degraded mode if that also fails.
func startEmbeddedPG() *embeddedpostgres.EmbeddedPostgres {
	basePath := filepath.Join("..", "data", "postgres")

	pgCfg := embeddedpostgres.DefaultConfig().
		Username("puchipix").
		Password("puchipix").
		Database("puchipix").
		Version(embeddedpostgres.V16).
		Locale("C").
		Encoding("UTF8").
		Port(5432).
		RuntimePath(filepath.Join(basePath, "run")).
		DataPath(filepath.Join(basePath, "data")).
		BinariesPath(filepath.Join(basePath, "bin")).
		StartTimeout(30 * time.Second).
		StartParameters(map[string]string{
			"fsync":              "off",
			"full_page_writes":   "off",
			"max_wal_senders":    "0",
			"wal_level":          "minimal",
			"checkpoint_timeout": "1h",
			"autovacuum":         "off",
		}).
		Logger(io.Discard)

	pg := embeddedpostgres.NewDatabase(pgCfg)
	if err := pg.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "embedded-postgres start: %v\n", err)
		return nil
	}
	return pg
}
