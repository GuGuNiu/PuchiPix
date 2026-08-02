package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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

	// ── Database ──
	database, dbErr := db.NewDatabase(cfg.DatabasePath, nil)
	if dbErr != nil {
		logger.Warn("Database unavailable, starting in degraded mode")
	}

	// ── DAG Scheduler (only when database is available) ──
	var dagOrch *dag.DagOrchestrator
	var sched *orchsched.SchedulerEngine
	var exeReg *executors.Registry
	var progressEngine *taskprogress.Engine
	var videoTracker *taskprogress.VideoProgressTracker

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
		videoTracker = taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())

		// 3a. Build title parser with embedded model/character data.
		// The parser is used in the scrape pipeline to extract protagonist
		// names from gallery titles when the site provider does not return one.
		titleParser := titleparser.New()
		if models, err := titleparser.LoadModelsFromJSON(resources.CoserJSON); err == nil {
			titleParser.LoadModels(models)
			logger.Info("Title parser loaded models", "count", len(models))
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

		// 4. Executor Registry ??routes node execution by key
		exeReg = executors.NewRegistry()
		orchestrator.WireExecutors(exeReg, siteReg, database, eventBus, titleParser, progressEngine, videoTracker)

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

		// 4b. Stream slot state changes over the EventBus so SSE clients
		// (GET /api/slots/stream) observe acquire / release / max / quota
		// updates in real-time without polling. Payload mirrors the
		// SlotStateChange shape with an extra timestamp.
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

		// 9b. Reactivate READY nodes that were restored from snapshots
		// but never submitted to the scheduler's ReadyQueue. Without this
		// call, any DAG whose nodes are in "ready" state after a server
		// restart will be stuck forever �?the scan timer only dispatches
		// nodes already in the queue, but the queue is empty because
		// SubmitDag �?activateReadyNodes only runs for newly created DAGs.
		// This is the root cause of 11 pending DAGs that never execute
		// their scrape nodes after restart.
		dagOrch.ReactivateReadyNodes(ctx)

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
				var pageURL, m3u8URL, storedTitle string
				err := database.QueryRow(ctx,
					`SELECT url, COALESCE(m3u8_url, ''), COALESCE(title, '') FROM download_tasks WHERE id = ?`,
					taskID).Scan(&pageURL, &m3u8URL, &storedTitle)
				if err != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("query task %d: %w", taskID, err)
				}

				// If M3U8 URL is already known, use it directly with
				// lightweight best-effort metadata scrape.
				if m3u8URL != "" {
					task := video.DownloadTaskInput{
						ID:      taskID,
						M3U8URL: m3u8URL,
						PageURL: pageURL,
						Title:   storedTitle,
					}
					metaCtx, metaCancel := context.WithTimeout(ctx, 30*time.Second)
					defer metaCancel()
					if meta, metaErr := universal.ScrapePage(metaCtx, pageURL); metaErr == nil {
						task.Title = meta.Title
						task.Tags = meta.Tags
						task.Actors = meta.Actors
						task.Categories = meta.Categories
						task.Director = meta.Director
					}
					return task, nil
				}

				// M3U8 URL not yet discovered �?strategy-driven scrape with
				// domain fallback. First, look up the site module to get
				// mirror domains and scraping strategy.
				var siteID string
				var mirrorDomains []string
				if h.SiteReg != nil {
					if mod, ok := h.SiteReg.GetModuleByUrl(pageURL); ok {
						siteID = mod.ID
						mirrorDomains = mod.Domains
					}
				}

				// Determine strategy. TaskTypeVideo with missing M3U8
				// triggers the full strategy selection chain.
				strategy := strategySelector.Select(orchestrator.SelectStrategyInput{
					SiteID:   siteID,
					TaskType: orchestrator.TaskTypeVideo,
				})

				var result *sites.ScrapeResult
				var scrapeErr error

				switch strategy {
				case orchestrator.StrategyHTTP:
					scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
						return universal.ScrapePageHTTP(ctx, url)
					}
					scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
					defer cancel()
					result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

				case orchestrator.StrategyChromedp:
					scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
						return universal.ScrapePage(ctx, url)
					}
					scrapeCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
					defer cancel()
					result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

				default: // StrategyAuto
					// HTTP first. If it returns a valid M3U8, use it.
					// Otherwise fall back to chromedp.
					logger.Info(fmt.Sprintf("M3U8 URL empty for task %d, trying HTTP scrape", taskID))
					scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
					defer cancel()
					scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
						return universal.ScrapePageHTTP(ctx, url)
					}
					result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

					// Quality gate: if HTTP didn't find a M3U8 or produced
					// empty results, escalate to chromedp.
					if scrapeErr != nil || (result != nil && result.M3U8URL == "" && result.Title == "") {
						logger.Info(fmt.Sprintf("HTTP scrape insufficient for task %d, escalating to chromedp", taskID))
						scrapeCtx2, cancel2 := context.WithTimeout(ctx, 2*time.Minute)
						defer cancel2()
						scrapeFn2 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
							return universal.ScrapePage(ctx, url)
						}
						result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx2, pageURL, mirrorDomains, scrapeFn2)

						// Last resort: if headless chromedp also failed and the
						// error pattern suggests CloudFlare/WAF blocking, try a
						// visible (headful) browser. Anti-bot systems can detect
						// headless Chrome via navigator.webdriver and other
						// fingerprint signals; a visible browser often bypasses
						// these checks.
						if scrapeErr != nil && isLikelyAntiBot(scrapeErr) {
							logger.Info(fmt.Sprintf("headless chromedp blocked for task %d, trying headful browser", taskID))
							scrapeCtx3, cancel3 := context.WithTimeout(ctx, 40*time.Second)
							defer cancel3()
							scrapeFn3 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
								return universal.ScrapePageHeadful(ctx, url)
							}
							result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx3, pageURL, mirrorDomains, scrapeFn3)
						}
					}
				}

				if scrapeErr != nil {
					return video.DownloadTaskInput{}, fmt.Errorf("scrape page for M3U8: %w", scrapeErr)
				}
				if result.M3U8URL == "" {
					return video.DownloadTaskInput{}, fmt.Errorf("no M3U8 URL found on page: %s", pageURL)
				}

				// Persist the discovered M3U8 URL for future retries.
				_, _ = database.Exec(ctx,
					`UPDATE download_tasks SET m3u8_url = ?, title = ? WHERE id = ?`,
					result.M3U8URL, result.Title, taskID)

				// Pre-write video metadata immediately after scraping.
				preWriteVideoInfo(ctx, database, taskID, result)

				return video.DownloadTaskInput{
					ID:         taskID,
					M3U8URL:    result.M3U8URL,
					PageURL:    pageURL,
					Title:      result.Title,
					Tags:       result.Tags,
					Actors:     result.Actors,
					Categories: result.Categories,
					Director:   result.Director,
				}, nil
			}

		exeReg.Register(executors.NewVideoDownloadExecutor(dm, statusFn, taskLoaderFn, videoTracker))
	}

	// Progress engine and video tracker were created earlier during
	// DAG initialization so they could be passed to WireExecutors.
	// Here we just inject them into the API handlers.

	h.WithDag(dagOrch, sched, exeReg)
	h.WithServices(ouoOrch, dm, siteReg)
	h.WithProgressEngine(progressEngine, videoTracker)
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
		"deadline exceeded",                   // headless Chrome stuck on JS challenge
		"navigation failed",                  // chromedp couldn't even load the page
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
// TS scrapeVideoAsync behavior where prisma.downloadTask.update with
// videoInfo was called right after scraping, so users can see metadata
// during the potentially long download phase.
func preWriteVideoInfo(ctx context.Context, database *db.Database, taskID int, result *sites.ScrapeResult) {
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tagsJSON, _ := json.Marshal(result.Tags)
	actorsJSON, _ := json.Marshal(result.Actors)
	categoriesJSON, _ := json.Marshal(result.Categories)

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
