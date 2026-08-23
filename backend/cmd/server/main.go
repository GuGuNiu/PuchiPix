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

	database, dbErr := db.NewDatabase(cfg.DatabasePath, nil)
	if dbErr != nil {
		logger.Warn("Database unavailable, starting in degraded mode",
			"error", dbErr.Error())
	}

	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry
	var progressEngine *taskprogress.Engine
	var videoTracker *taskprogress.VideoProgressTracker

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
		flowCtrl := governor.NewFlowController(slotPool, sched, governor.DefaultFlowControllerConfig())
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
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := dagOrch.Shutdown(shutdownCtx); err != nil {
				logger.Error("DAG shutdown error", err)
			}
			sched.Stop()
		}()

		dataStore := sites.GetSiteDataStore()
		blocklistSvc := sites.NewBlocklistService(database)
		accountMgr := sites.NewSiteAccountManager(database)

		siteReg.Register(aimeizizi.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(kanav.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(siteSjs.NewProvider(dataStore, accountMgr))
		siteReg.Register(exhentai.NewProvider(dataStore))
		siteReg.Register(xsnvshen.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(fourkhd.NewProvider(dataStore, blocklistSvc))
		siteReg.Register(universal.NewProvider())
		logger.Info("Site providers registered", "count", 7)
	}

	h := api.New(database, eventBus)

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
