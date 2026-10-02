package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	orchsched "backend/internal/orchestrator/scheduler"
	"backend/internal/orchestrator/slot"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/taskstate"
)

func runCrashRecovery(database *db.Database, eventBus *infra.EventBus, dagOrch *dag.DagOrchestrator, logger *infra.Logger) {
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
				_, _ = database.Exec(recoveryCtx,
					`UPDATE galleries SET status = 'paused', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
					o.id)
			}
		}
	}

	_, _ = database.Exec(recoveryCtx,
		`UPDATE gallery_videos SET status = 'pending', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP WHERE status IN ('downloading', 'failed')`)

	recoveryStore := taskstate.NewStore(database, eventBus)
	if n, err := recoveryStore.RecoverStale(recoveryCtx); err != nil {
		logger.Warn("Crash recovery: video task reset failed", "error", err.Error())
	} else if n > 0 {
		logger.Info("Crash recovery: reset mid-pipeline video tasks to paused", "count", n)
	}

	dagOrch.ReconcileEntityStatuses(context.Background())
}

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

func (a *schedulerAdapter) IsExecuting(dagID, nodeID string) bool {
	return a.sched.IsExecuting(dagID, nodeID)
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

type orchestratorAdapter struct {
	orch *dag.DagOrchestrator
}

func (a *orchestratorAdapter) TransitionNode(dagID, nodeID, toState, reason, triggeredBy string) error {
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
	return a.orch.GetNodeForVerification(dagID, nodeID)
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

func isLikelyAntiBot(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	for _, sig := range []string{
		"cf-", "cloudflare", "challenge", "captcha", "turnstile",
		"403", "access denied", "forbidden",
		"deadline exceeded",
		"navigation failed",
		"context deadline exceeded",
	} {
		if strings.Contains(lower, sig) {
			return true
		}
	}
	return false
}

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

	var galleries, tasks int
	_ = database.QueryRow(ctx, `SELECT COUNT(*) FROM galleries`).Scan(&galleries)
	_ = database.QueryRow(ctx, `SELECT COUNT(*) FROM download_tasks`).Scan(&tasks)
	logger.Info("Database schema check passed", map[string]any{
		"galleries":     galleries,
		"downloadTasks": tasks,
	})
}

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
		return "completed"
	}

	switch {
	case zipCount > 0:
		return "completed"
	case expectedImgs == 0 && expectedVids == 0:
		return "failed"
	case downloadedImgs == expectedImgs && downloadedVids == expectedVids:
		return "completed"
	case downloadedImgs > 0 || downloadedVids > 0:
		return "partial"
	default:
		return "failed"
	}
}

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

func mountAssets(apiRouter http.Handler, assets http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api", apiRouter)
	mux.Handle("/api/", apiRouter)
	mux.Handle("/", assets)
	return mux
}