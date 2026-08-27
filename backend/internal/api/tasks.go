package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend/internal/api/internal/task_compute"
	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/idgen"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/sites"
	"backend/internal/urlutil"
)

func (h *Handlers) getTaskDagID(ctx context.Context, taskID int) string {
	if h.DB == nil {
		return ""
	}
	var dagID string
	err := h.DB.QueryRow(ctx, "SELECT COALESCE(dag_id, '') FROM download_tasks WHERE id = ?", taskID).Scan(&dagID)
	if err != nil {
		return ""
	}
	return dagID
}

func (h *Handlers) updateTaskDagID(ctx context.Context, taskID int, dagID string) {
	h.DB.Exec(ctx, "UPDATE download_tasks SET dag_id = ? WHERE id = ?", dagID, taskID)
}

var unicodeEscapeRe = regexp.MustCompile(`\\u([0-9a-fA-F]{4})`)

// decodeUnicodeEscapes handles legacy DB rows where the regex-based
// scraper stored undecoded escape sequences (e.g. "\u5973\u795e" instead of "女神").
func decodeUnicodeEscapes(s string) string {
	return unicodeEscapeRe.ReplaceAllStringFunc(s, func(match string) string {
		hex := match[2:]
		if code, err := strconv.ParseInt(hex, 16, 32); err == nil {
			return string(rune(code))
		}
		return match
	})
}

// parsePersonForDisplay converts the DB-stored actors JSON string into a
// human-readable comma-separated display string. Fixes the double-serialization
// issue where the JSON array was re-serialized by writeJSON.
func parsePersonForDisplay(raw string) string {
	if raw == "" || raw == "null" || raw == "[]" {
		return ""
	}
	var actors []string
	if err := json.Unmarshal([]byte(raw), &actors); err == nil {
		for i, a := range actors {
			actors[i] = decodeUnicodeEscapes(a)
		}
		return strings.Join(actors, ", ")
	}
	return decodeUnicodeEscapes(raw)
}

func (h *Handlers) TaskList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)

	rows, err := h.DB.Query(r.Context(),
		`SELECT dt.id, dt.url, dt.m3u8_url, dt.status, dt.progress,
		       dt.file_path, dt.format, dt.priority, dt.error_msg,
		       dt.site_id, dt.seq, dt.created_at, dt.updated_at,
		       COALESCE(NULLIF(vi.title, ''), '') AS title,
		       COALESCE(NULLIF(vi.actors, 'null'), '') AS protagonist,
		       COALESCE(dt.total_segments, 0) AS total_segments,
		       COALESCE(dt.completed_segments, 0) AS completed_segments,
		       COALESCE(vi.file_size, 0) AS file_size
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.queryFailed"))
		return
	}
	defer rows.Close()

	tasks := []db.DownloadTask{}
	var ca, ua db.SQLTime
	for rows.Next() {
		var t db.DownloadTask
		if err := rows.Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.SiteID, &t.Seq, &ca, &ua, &t.Title, &t.Person, &t.TotalSegments, &t.Segment, &t.FileSize); err != nil {
			continue
		}
		t.Person = parsePersonForDisplay(t.Person)
		t.CreatedAt = ca.Time
		t.UpdatedAt = ua.Time
		t.Title = task_compute.StripPersonFromTitle(t.Title, t.Person)
		t.EffectiveStatus = task_compute.ComputeEffectiveStatus(t.Status, "video", 0, 0)
		t.ProgressStage = task_compute.ComputeProgressStage(t.Status, "video", t.Progress)
		t.AllowedActions = task_compute.ComputeAllowedActions(t.Status, "video")
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
}

// unifiedFetchLimit caps per-table queries when merging results.
// Each table fetches this many newest rows; the merged result is then
// sorted and truncated to taskStreamMaxInitialTasks.
const unifiedFetchLimit = 2000

func (h *Handlers) TaskListUnified(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	ctx := r.Context()
	tasks := make([]map[string]any, 0, unifiedFetchLimit)

	// Query each table separately with LIMIT, then merge and sort.
	// This avoids "UNION ALL + ORDER BY id DESC" which forces SQLite to
	// materialize and sort the full cross-table result before limiting.
	// With separate queries, each uses the primary-key rowid index scan
	// (O(limit)), and the final merge sort is O(n log n) on 3*limit rows.

	// 1) Video tasks (download_tasks + video_infos)
	videoRows, err := h.DB.Query(ctx,
		`SELECT 'video' AS task_type, dt.id, dt.url, dt.status, dt.progress,
		        COALESCE(dt.file_path, '') AS file_path,
		        COALESCE(dt.format, '') AS format,
		        COALESCE(dt.priority, 0) AS priority,
		        COALESCE(dt.error_msg, '') AS error_msg,
		        COALESCE(dt.site_id, '') AS site_id,
		        dt.seq,
		        COALESCE(NULLIF(vi.title, ''), '') AS title,
		        COALESCE(NULLIF(vi.actors, 'null'), '') AS protagonist,
		        0 AS image_count, 0 AS video_count,
		        0 AS total_size, 0 AS downloaded_size,
		        false AS content_verified,
		        COALESCE(dt.total_segments, 0) AS total_segments,
		        COALESCE(dt.completed_segments, 0) AS completed_segments,
		        dt.created_at, dt.updated_at
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ?`, unifiedFetchLimit)
	if err == nil {
		for videoRows.Next() {
			var r unifiedTaskRow
			if err := videoRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
				&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
				&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
				&r.DownloadedSize, &r.ContentVerified,
				&r.TotalSegments, &r.CompletedSegments,
				&r.CreatedAt, &r.UpdatedAt); err != nil {
				continue
			}
			tasks = append(tasks, h.enrichUnifiedTask(r))
		}
		videoRows.Close()
	}

	// 2) Gallery tasks
	galleryRows, err := h.DB.Query(ctx,
		`SELECT 'gallery' AS task_type, id, COALESCE(source_url, '') AS url,
		        COALESCE(status, 'pending') AS status,
		        CASE
		            WHEN COALESCE(status, 'pending') = 'completed' THEN 100
		            WHEN COALESCE(content_verified, false) AND (COALESCE(image_count, 0) + COALESCE(video_count, 0)) > 0 THEN 99
		            WHEN COALESCE(total_size, 0) > 0 THEN
		                CASE
		                    WHEN CAST(COALESCE(downloaded_size, 0) * 100.0 / NULLIF(total_size, 0) AS INTEGER) > 99 THEN 99
		                    ELSE CAST(COALESCE(downloaded_size, 0) * 100.0 / NULLIF(total_size, 0) AS INTEGER)
		                END
		            ELSE 0
		        END AS progress,
		        COALESCE(save_path, '') AS file_path, '' AS format,
		        0 AS priority, COALESCE(error_msg, '') AS error_msg,
		        COALESCE(site_id, '') AS site_id,
		        seq, COALESCE(title, '') AS title,
		        COALESCE(protagonist, '') AS protagonist,
		        COALESCE(image_count, 0) AS image_count,
		        COALESCE(video_count, 0) AS video_count,
		        COALESCE(total_size, 0) AS total_size,
		        COALESCE(downloaded_size, 0) AS downloaded_size,
		        COALESCE(content_verified, false) AS content_verified,
		        0 AS total_segments, 0 AS completed_segments,
		        created_at, updated_at
		 FROM galleries
		 ORDER BY id DESC LIMIT ?`, unifiedFetchLimit)
	if err == nil {
		for galleryRows.Next() {
			var r unifiedTaskRow
			if err := galleryRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
				&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
				&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
				&r.DownloadedSize, &r.ContentVerified,
				&r.TotalSegments, &r.CompletedSegments,
				&r.CreatedAt, &r.UpdatedAt); err != nil {
				continue
			}
			tasks = append(tasks, h.enrichUnifiedTask(r))
		}
		galleryRows.Close()
	}

	// NOTE: Sniff tasks are intentionally excluded from the unified task
	// list. They have their own dedicated pool (slot type "sniff", max=1)
	// and are managed through the separate /sniff page and /api/sniff
	// endpoints. Mixing them into the main pool would violate the
	// historical design of an independent sniff pool.

	// Merge sort by ID descending (same visual order as before)
	sort.Slice(tasks, func(i, j int) bool {
		idI, _ := tasks[i]["ID"].(int)
		idJ, _ := tasks[j]["ID"].(int)
		return idI > idJ
	})

	// Final truncation to cap response size
	if len(tasks) > taskStreamMaxInitialTasks {
		tasks = tasks[:taskStreamMaxInitialTasks]
	}

	writeJSON(w, http.StatusOK, tasks)
}

// enrichUnifiedTask converts a unifiedTaskRow into the enriched map
// returned by TaskListUnified, applying person parsing and task_compute
// enrichment (EffectiveStatus / ProgressStage / AllowedActions).
func (h *Handlers) enrichUnifiedTask(r unifiedTaskRow) map[string]any {
	return task_compute.EnrichTaskMap(map[string]any{
		"TaskType":         r.TaskType,
		"ID":               r.ID,
		"URL":              r.URL,
		"Status":           r.Status,
		"Progress":         r.Progress,
		"FilePath":         r.FilePath,
		"Format":           r.Format,
		"Priority":         r.Priority,
		"ErrorMsg":         r.ErrorMsg,
		"SiteID":           r.SiteID,
		"DisplayID":        r.Seq,
		"GalleryTitle":     r.Title,
		"Person":           parsePersonForDisplay(r.Protagonist),
		"ImageCount":       r.ImageCount,
		"VideoCount":       r.VideoCount,
		"GalleryTotalSize": r.TotalSize,
		"Segment":          r.CompletedSegments,
		"TotalSegments":    r.TotalSegments,
		"CreatedAt":        r.CreatedAt,
		"UpdatedAt":        r.UpdatedAt,
	})
}

// TaskPage returns a paginated slice of unified tasks. Used by the frontend
// infinite-scroll when the initial SSE snapshot only covers the first page.
//
// Query params:
//   - page     : 1-based page number (default 1)
//   - pageSize : rows per page (default 100, max 500)
//
// Each table is queried separately with LIMIT/OFFSET, then results are
// merged and re-sorted by id DESC. This is O(offset + limit) per table
// which is acceptable for typical page sizes; for very deep pagination
// a keyset (WHERE id < lastSeenID) would be preferable but requires
// tracking lastSeen across tables which is more complex.
func (h *Handlers) TaskPage(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"tasks":      []any{},
			"totalCount": 0,
			"page":       1,
			"pageSize":   100,
			"hasMore":    false,
		})
		return
	}

	// Parse pagination params
	page := 1
	pageSize := 100
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(r.URL.Query().Get("pageSize")); err == nil && ps > 0 {
		if ps > 500 {
			ps = 500
		}
		pageSize = ps
	}

	ctx := r.Context()

	// Get total count (fast with SQLite COUNT(*))
	var galleryCount, videoCount int
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries").Scan(&galleryCount)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks").Scan(&videoCount)
	totalCount := galleryCount + videoCount

	// For deep pagination, fetch a generous window from each table and
	// merge-sort. This keeps the code simple while still being fast for
	// reasonable page depths (page * pageSize <= ~5000).
	fetchLimit := page * pageSize
	if fetchLimit > 2000 {
		fetchLimit = 2000 // cap to avoid excessive memory use
	}

	tasks := make([]map[string]any, 0, fetchLimit)

	// 1) Video tasks
	videoRows, err := h.DB.Query(ctx,
		`SELECT 'video' AS task_type, dt.id, dt.url, dt.status, dt.progress,
		        COALESCE(dt.file_path, '') AS file_path,
		        COALESCE(dt.format, '') AS format,
		        COALESCE(dt.priority, 0) AS priority,
		        COALESCE(dt.error_msg, '') AS error_msg,
		        COALESCE(dt.site_id, '') AS site_id,
		        dt.seq,
		        COALESCE(NULLIF(vi.title, ''), '') AS title,
		        COALESCE(NULLIF(vi.actors, 'null'), '') AS protagonist,
		        0 AS image_count, 0 AS video_count,
		        0 AS total_size, 0 AS downloaded_size,
		        false AS content_verified,
		        COALESCE(dt.total_segments, 0) AS total_segments,
		        COALESCE(dt.completed_segments, 0) AS completed_segments,
		        dt.created_at, dt.updated_at
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ?`, fetchLimit)
	if err == nil {
		for videoRows.Next() {
			var r unifiedTaskRow
			if err := videoRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
				&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
				&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
				&r.DownloadedSize, &r.ContentVerified,
				&r.TotalSegments, &r.CompletedSegments,
				&r.CreatedAt, &r.UpdatedAt); err != nil {
				continue
			}
			tasks = append(tasks, h.enrichUnifiedTask(r))
		}
		videoRows.Close()
	}

	// 2) Gallery tasks
	galleryRows, err := h.DB.Query(ctx,
		`SELECT 'gallery' AS task_type, id, COALESCE(source_url, '') AS url,
		        COALESCE(status, 'pending') AS status,
		        CASE
		            WHEN COALESCE(status, 'pending') = 'completed' THEN 100
		            WHEN COALESCE(content_verified, false) AND (COALESCE(image_count, 0) + COALESCE(video_count, 0)) > 0 THEN 99
		            WHEN COALESCE(total_size, 0) > 0 THEN
		                CASE
		                    WHEN CAST(COALESCE(downloaded_size, 0) * 100.0 / NULLIF(total_size, 0) AS INTEGER) > 99 THEN 99
		                    ELSE CAST(COALESCE(downloaded_size, 0) * 100.0 / NULLIF(total_size, 0) AS INTEGER)
		                END
		            ELSE 0
		        END AS progress,
		        COALESCE(save_path, '') AS file_path, '' AS format,
		        0 AS priority, COALESCE(error_msg, '') AS error_msg,
		        COALESCE(site_id, '') AS site_id,
		        seq, COALESCE(title, '') AS title,
		        COALESCE(protagonist, '') AS protagonist,
		        COALESCE(image_count, 0) AS image_count,
		        COALESCE(video_count, 0) AS video_count,
		        COALESCE(total_size, 0) AS total_size,
		        COALESCE(downloaded_size, 0) AS downloaded_size,
		        COALESCE(content_verified, false) AS content_verified,
		        0 AS total_segments, 0 AS completed_segments,
		        created_at, updated_at
		 FROM galleries
		 ORDER BY id DESC LIMIT ?`, fetchLimit)
	if err == nil {
		for galleryRows.Next() {
			var r unifiedTaskRow
			if err := galleryRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
				&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
				&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
				&r.DownloadedSize, &r.ContentVerified,
				&r.TotalSegments, &r.CompletedSegments,
				&r.CreatedAt, &r.UpdatedAt); err != nil {
				continue
			}
			tasks = append(tasks, h.enrichUnifiedTask(r))
		}
		galleryRows.Close()
	}

	// NOTE: Sniff tasks excluded — independent pool via /api/sniff.

	// Merge sort by ID descending
	sort.Slice(tasks, func(i, j int) bool {
		idI, _ := tasks[i]["ID"].(int)
		idJ, _ := tasks[j]["ID"].(int)
		return idI > idJ
	})

	// Slice out the requested page
	offset := (page - 1) * pageSize
	if offset > len(tasks) {
		tasks = nil
	} else {
		end := offset + pageSize
		if end > len(tasks) {
			end = len(tasks)
		}
		tasks = tasks[offset:end]
	}

	hasMore := (page*pageSize) < totalCount

	writeJSON(w, http.StatusOK, map[string]any{
		"tasks":      tasks,
		"totalCount": totalCount,
		"page":       page,
		"pageSize":   pageSize,
		"hasMore":    hasMore,
	})
}

func (h *Handlers) TaskCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var req struct {
		URL      string `json:"url"`
		Format   string `json:"format"`
		Seq      string `json:"seq"`
		Priority int    `json:"priority"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.missingUrl"))
		return
	}

	// Run the URL through the unified preprocessing pipeline. This
	// consolidates cleaning, normalization, M3U8 detection, site
	// matching, page-type identification, task routing, and Referer-
	// domain injection into a single call, eliminating the scattered
	// logic that historically caused MacCMS encoding bugs, CDN 403
	// failures, and misrouted tasks.
	route := urlutil.NormalizeAndRoute(req.URL, h.SiteReg)
	cleanedURL := urlutil.CleanURL(req.URL)
	normalizedURL := route.NormalizedURL

	switch route.Route {
	case urlutil.RouteSniff:
		h.createSniffTask(w, r, cleanedURL, route.SiteID, req.Seq)
		return
	case urlutil.RouteGallery:
		if route.Provider != nil {
			h.createGalleryTask(w, r, cleanedURL, normalizedURL, route.Provider, req.Seq)
			return
		}
	case urlutil.RouteUnknown:
		// URL did not match any provider and is not an M3U8 stream.
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unrecognizedUrl"))
		return
	}

	if req.Format == "" {
		req.Format = "mp4"
	}
	if req.Priority == 0 {
		req.Priority = 1
	}

	siteID := ""
	if h.SiteReg != nil {
		if mod, ok := h.SiteReg.GetModuleByUrl(cleanedURL); ok {
			siteID = mod.ID
		}
	}

	if dup := h.checkVideoTaskDuplicate(r, normalizedURL); dup != nil {
		writeJSON(w, http.StatusConflict, dup)
		return
	}
	if dup := h.checkGalleryDuplicate(r, normalizedURL, cleanedURL); dup != nil {
		writeJSON(w, http.StatusConflict, dup)
		return
	}

	var seqPtr *string
	if req.Seq != "" {
		seqPtr = &req.Seq
	} else {
		generated := idgen.GenerateID()
		seqPtr = &generated
	}

	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO download_tasks (url, m3u8_url, status, progress, file_path, format, priority, error_msg, site_id, seq)
		 VALUES (?, '', 'pending', 0, '', ?, ?, '', ?, ?)
		 RETURNING id`,
		normalizedURL, req.Format, req.Priority, siteID, seqPtr).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewVideoPipeline(*seqPtr, id)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
			h.DB.Exec(r.Context(),
				"UPDATE download_tasks SET status = 'failed', error_msg = ? WHERE id = ?",
				"DAG submission failed: "+submitErr.Error(), id)
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
		h.updateTaskDagID(r.Context(), id, dagID)
	}

	if h.EventBus != nil {
		now := time.Now()
		eventStatus := "pending"
		_ = h.DB.QueryRow(r.Context(),
			"SELECT status FROM download_tasks WHERE id = ?", id).Scan(&eventStatus)
		h.EventBus.Emit("task:created", db.DownloadTask{
			ID:        id,
			URL:       normalizedURL,
			Status:    eventStatus,
			Progress:  0,
			Format:    req.Format,
			Priority:  req.Priority,
			SiteID:    siteID,
			Seq:       seqPtr,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	var created db.DownloadTask
	var ca, ua db.SQLTime
	err = h.DB.QueryRow(r.Context(),
		`SELECT dt.id, dt.url, dt.m3u8_url, dt.status, dt.progress,
		       dt.file_path, dt.format, dt.priority, dt.error_msg,
		       dt.site_id, dt.seq, dt.created_at, dt.updated_at,
		       '' AS title, '' AS protagonist,
		       COALESCE(dt.total_segments, 0), COALESCE(dt.completed_segments, 0),
		       0 AS file_size
		FROM download_tasks dt WHERE dt.id = ?`, id).
		Scan(&created.ID, &created.URL, &created.M3U8URL, &created.Status, &created.Progress,
			&created.FilePath, &created.Format, &created.Priority, &created.ErrorMsg,
			&created.SiteID, &created.Seq, &ca, &ua, &created.Title, &created.Person,
			&created.TotalSegments, &created.Segment, &created.FileSize)
	if err == nil {
		created.CreatedAt = ca.Time
		created.UpdatedAt = ua.Time
		created.EffectiveStatus = task_compute.ComputeEffectiveStatus(created.Status, "video", 0, 0)
		created.ProgressStage = task_compute.ComputeProgressStage(created.Status, "video", created.Progress)
		created.AllowedActions = task_compute.ComputeAllowedActions(created.Status, "video")
		writeJSON(w, http.StatusCreated, created)
	} else {
		writeJSON(w, http.StatusCreated, map[string]any{"ID": id, "DisplayID": *seqPtr, "Status": "pending", "SiteID": siteID, "dagId": dagID})
	}
}

func (h *Handlers) createGalleryTask(w http.ResponseWriter, r *http.Request, pageURL, normalizedURL string, provider sites.SiteProvider, userSeq string) {
	siteID := provider.SiteID()

	if dup := h.checkGalleryDuplicate(r, normalizedURL, pageURL); dup != nil {
		writeJSON(w, http.StatusConflict, dup)
		return
	}

	var seqPtr *string
	if userSeq != "" {
		seqPtr = &userSeq
	} else {
		generated := idgen.GenerateID()
		seqPtr = &generated
	}

	scrapedDomain := ""
	if parsed, err := url.Parse(pageURL); err == nil {
		scrapedDomain = parsed.Hostname()
	}

	var galleryID int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO galleries (seq, source_url, site_id, scraped_domain, status, download_method)
		 VALUES (?, ?, ?, ?, 'pending', 'pending')
		 RETURNING id`,
		seqPtr, normalizedURL, siteID, scrapedDomain).Scan(&galleryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewGalleryPipeline(normalizedURL, siteID, galleryID)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
			h.DB.Exec(r.Context(),
				"UPDATE galleries SET status = 'failed', error_msg = ? WHERE id = ?",
				"DAG submission failed: "+submitErr.Error(), galleryID)
			if h.EventBus != nil {
				h.EventBus.Emit("task:failed", map[string]any{
					"taskId":   galleryID,
					"taskType": "gallery",
					"error":    "DAG submission failed: " + submitErr.Error(),
				})
			}
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
		h.updateGalleryDagID(r.Context(), galleryID, dagID)

		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"status":   "scraping",
			})
		}
	}

	if h.EventBus != nil {
		eventStatus := "pending"
		_ = h.DB.QueryRow(r.Context(),
			"SELECT COALESCE(status, 'pending') FROM galleries WHERE id = ?", galleryID).Scan(&eventStatus)
		h.EventBus.Emit("gallery:created", map[string]any{
			"ID":         galleryID,
			"SourceURL":  normalizedURL,
			"SiteID":     siteID,
			"Status":     eventStatus,
			"DagID":      dagID,
			"DisplayID":  *seqPtr,
			"TaskType":   "gallery",
			"CreatedAt":  time.Now(),
			"UpdatedAt":  time.Now(),
		})
	}

	responseStatus := "pending"
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(status, 'pending') FROM galleries WHERE id = ?", galleryID).Scan(&responseStatus)
	writeJSON(w, http.StatusCreated, map[string]any{
		"TaskType":        "gallery",
		"ID":              galleryID,
		"DisplayID":       *seqPtr,
		"URL":             normalizedURL,
		"Status":          responseStatus,
		"SiteID":          siteID,
		"CreatedAt":       time.Now(),
		"UpdatedAt":       time.Now(),
		"EffectiveStatus": task_compute.ComputeEffectiveStatus(responseStatus, "gallery", 0, 0),
		"ProgressStage":   task_compute.ComputeProgressStage(responseStatus, "gallery", 0),
		"AllowedActions":  task_compute.ComputeAllowedActions(responseStatus, "gallery"),
	})
}

func (h *Handlers) createSniffTask(w http.ResponseWriter, r *http.Request, pageURL, siteID, userSeq string) {
	var seqPtr *string
	if userSeq != "" {
		seqPtr = &userSeq
	} else {
		generated := idgen.GenerateID()
		seqPtr = &generated
	}

	var sniffID int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO sniff_tasks (seq, url, site_id, status)
		 VALUES (?, ?, ?, 'pending')
		 RETURNING id`,
		seqPtr, pageURL, siteID).Scan(&sniffID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewSniffPipeline(pageURL, *seqPtr)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
			h.DB.Exec(r.Context(),
				"UPDATE sniff_tasks SET status = 'failed', error_msg = ? WHERE id = ?",
				"DAG submission failed: "+submitErr.Error(), sniffID)
			if h.EventBus != nil {
				h.EventBus.Emit("task:failed", map[string]any{
					"taskId":   sniffID,
					"taskType": "sniff",
					"error":    "DAG submission failed: " + submitErr.Error(),
				})
			}
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
		h.DB.Exec(r.Context(), "UPDATE sniff_tasks SET dag_id = ? WHERE id = ?", dagID, sniffID)
	}

	if h.EventBus != nil {
		h.EventBus.Emit("task:created", map[string]any{
			"ID":         sniffID,
			"DisplayID":  *seqPtr,
			"URL":        pageURL,
			"Status":     "pending",
			"TaskType":   "sniff",
			"SiteID":     siteID,
			"DagID":      dagID,
			"CreatedAt":  time.Now(),
			"UpdatedAt":  time.Now(),
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"TaskType":        "sniff",
		"ID":              sniffID,
		"DisplayID":       *seqPtr,
		"URL":             pageURL,
		"Status":          "pending",
		"SiteID":          siteID,
		"CreatedAt":       time.Now(),
		"UpdatedAt":       time.Now(),
		"EffectiveStatus": task_compute.ComputeEffectiveStatus("pending", "sniff", 0, 0),
		"ProgressStage":   task_compute.ComputeProgressStage("pending", "sniff", 0),
		"AllowedActions":  task_compute.ComputeAllowedActions("pending", "sniff"),
	})
}

// checkVideoTaskDuplicate returns a 409 response if a duplicate video
// task is found via exact URL, mirror-domain, or path-signature matching.
func (h *Handlers) checkVideoTaskDuplicate(r *http.Request, normalizedURL string) map[string]any {
	ctx := r.Context()

	var existingID int
	var existingStatus string
	var existingSeq *string
	err := h.DB.QueryRow(ctx,
		`SELECT id, status, seq FROM download_tasks WHERE url = ? LIMIT 1`,
		normalizedURL).Scan(&existingID, &existingStatus, &existingSeq)
	if err == nil {
		seqStr := ""
		if existingSeq != nil {
			seqStr = *existingSeq
		}
		return map[string]any{
			"type":           "video",
			"matchType":      "exact",
			"taskId":         existingID,
			"existingStatus": existingStatus,
			"existingUrl":    normalizedURL,
			"displayId":      seqStr,
		}
	}

	if h.SiteReg != nil {
		if mod, ok := h.SiteReg.GetModuleByUrl(normalizedURL); ok && len(mod.Domains) > 1 {
			mirrorInfo := urlutil.GenerateMirrorURLs(normalizedURL, mod.Domains)
			for _, mirrorURL := range mirrorInfo.Mirrors {
				if mirrorURL == normalizedURL {
					continue
				}
				err := h.DB.QueryRow(ctx,
					`SELECT id, status, seq FROM download_tasks WHERE url = ? LIMIT 1`,
					mirrorURL).Scan(&existingID, &existingStatus, &existingSeq)
				if err == nil {
					seqStr := ""
					if existingSeq != nil {
						seqStr = *existingSeq
					}
					return map[string]any{
						"type":           "video",
						"matchType":      "mirror",
						"taskId":         existingID,
						"existingStatus": existingStatus,
						"existingUrl":    mirrorURL,
						"displayId":      seqStr,
					}
				}
			}
		}
	}

	signature := urlutil.GetURLSignature(normalizedURL)
	if len(signature) > 1 {
		rows, err := h.DB.Query(ctx,
			`SELECT id, status, seq, url FROM download_tasks WHERE url LIKE '%' || ? LIMIT 5`,
			signature)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var status, dbURL string
				var seq *string
				if err := rows.Scan(&id, &status, &seq, &dbURL); err != nil {
					continue
				}
				if urlutil.GetURLSignature(dbURL) == signature {
					seqStr := ""
					if seq != nil {
						seqStr = *seq
					}
					return map[string]any{
						"type":           "video",
						"matchType":      "path",
						"taskId":         id,
						"existingStatus": status,
						"existingUrl":    dbURL,
						"displayId":      seqStr,
					}
				}
			}
		}
	}

	return nil
}

// checkGalleryDuplicate returns a 409 response if a duplicate gallery
// is found via exact URL, mirror-domain, or path-signature matching.
func (h *Handlers) checkGalleryDuplicate(r *http.Request, normalizedURL, rawURL string) map[string]any {
	ctx := r.Context()

	var galleryID int
	var galleryStatus string
	var gallerySeq *string
	var galleryTitle string
	err := h.DB.QueryRow(ctx,
		`SELECT id, status, seq, COALESCE(title, '') FROM galleries WHERE source_url = ? LIMIT 1`,
		normalizedURL).Scan(&galleryID, &galleryStatus, &gallerySeq, &galleryTitle)
	if err == nil {
		seqStr := ""
		if gallerySeq != nil {
			seqStr = *gallerySeq
		}
		return map[string]any{
			"type":           "gallery",
			"matchType":      "exact",
			"galleryId":      galleryID,
			"existingStatus": galleryStatus,
			"existingUrl":    normalizedURL,
			"existingTitle":  galleryTitle,
			"displayId":      seqStr,
		}
	}

	if h.SiteReg != nil {
		if mod, ok := h.SiteReg.GetModuleByUrl(normalizedURL); ok && len(mod.Domains) > 1 {
			mirrorInfo := urlutil.GenerateMirrorURLs(normalizedURL, mod.Domains)
			for _, mirrorURL := range mirrorInfo.Mirrors {
				if mirrorURL == normalizedURL {
					continue
				}
				err := h.DB.QueryRow(ctx,
					`SELECT id, status, seq, COALESCE(title, '') FROM galleries WHERE source_url = ? LIMIT 1`,
					mirrorURL).Scan(&galleryID, &galleryStatus, &gallerySeq, &galleryTitle)
				if err == nil {
					seqStr := ""
					if gallerySeq != nil {
						seqStr = *gallerySeq
					}
					return map[string]any{
						"type":           "gallery",
						"matchType":      "mirror",
						"galleryId":      galleryID,
						"existingStatus": galleryStatus,
						"existingUrl":    mirrorURL,
						"existingTitle":  galleryTitle,
						"displayId":      seqStr,
					}
				}
			}
		}
	}

	signature := urlutil.GetURLSignature(normalizedURL)
	if len(signature) > 1 {
		rows, err := h.DB.Query(ctx,
			`SELECT id, status, seq, COALESCE(title, ''), source_url FROM galleries WHERE source_url LIKE '%' || ? LIMIT 5`,
			signature)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var status, dbURL, title string
				var seq *string
				if err := rows.Scan(&id, &status, &seq, &title, &dbURL); err != nil {
					continue
				}
				if urlutil.GetURLSignature(dbURL) == signature {
					seqStr := ""
					if seq != nil {
						seqStr = *seq
					}
					return map[string]any{
						"type":           "gallery",
						"matchType":      "path",
						"galleryId":      id,
						"existingStatus": status,
						"existingUrl":    dbURL,
						"existingTitle":  title,
						"displayId":      seqStr,
					}
				}
			}
		}
	}

	return nil
}

func (h *Handlers) TaskDetail(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	var t db.DownloadTask
	err := h.DB.QueryRow(r.Context(),
		`SELECT dt.id, dt.url, dt.m3u8_url, dt.status, dt.progress,
		       dt.file_path, dt.format, dt.priority, dt.error_msg,
		       dt.site_id, dt.seq, dt.created_at, dt.updated_at,
		       COALESCE(NULLIF(vi.title, ''), '') AS title,
		       COALESCE(NULLIF(vi.actors, 'null'), '') AS protagonist,
		       COALESCE(dt.total_segments, 0) AS total_segments,
		       COALESCE(dt.completed_segments, 0) AS completed_segments,
		       COALESCE(vi.file_size, 0) AS file_size
		FROM download_tasks dt
		LEFT JOIN video_infos vi ON dt.id = vi.task_id
		WHERE dt.id = ?`, id).
		Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.SiteID, &t.Seq, &t.CreatedAt, &t.UpdatedAt, &t.Title, &t.Person, &t.TotalSegments, &t.Segment, &t.FileSize)
	if err != nil {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}
	t.Person = parsePersonForDisplay(t.Person)
	t.Title = task_compute.StripPersonFromTitle(t.Title, t.Person)
	t.EffectiveStatus = task_compute.ComputeEffectiveStatus(t.Status, "video", 0, 0)
	t.ProgressStage = task_compute.ComputeProgressStage(t.Status, "video", t.Progress)
	t.AllowedActions = task_compute.ComputeAllowedActions(t.Status, "video")
	writeJSON(w, http.StatusOK, t)
}

// TaskAction routes start/pause/resume/cancel/retry operations through the
// DAG orchestrator for slot pool concurrency control.
func (h *Handlers) TaskAction(w http.ResponseWriter, r *http.Request) {
	if h.DownloadMgr == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.tasks.schedulerRequired"))
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	switch req.Action {
	case "start":
		// Route through DAG for slot pool concurrency control. If the task
		// already has a live DAG, resume paused nodes or retry failed ones
		// instead of blindly submitting a brand-new DAG — a duplicate DAG
		// made the old (paused) and new DAG download the same files
		// concurrently, causing download anomalies after resume.
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" {
			if st := h.DagOrch.GetDagStatus(dagID); st != nil {
				hasPaused, hasFailed := false, false
				for _, ns := range st.Nodes {
					switch ns.State {
					case orchestrator.NodeStatePaused:
						hasPaused = true
					case orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout, orchestrator.NodeStateNeedsRetry:
						hasFailed = true
					}
				}
				var actErr error
				switch {
				case hasPaused:
					actErr = h.DagOrch.ResumeDag(r.Context(), dagID, "")
				case hasFailed:
					actErr = h.DagOrch.RetryDag(r.Context(), dagID, "")
				default:
					// Already running / finished: report live state, do not
					// create a duplicate DAG.
					writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "already-running"})
					return
				}
				if actErr != nil {
					writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.startFailed"))
					return
				}
				// Transition nodes to PREPARING state for optimistic UI feedback
				h.transitionDagNodesToPreparing(r.Context(), dagID)
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "preparing"})
				return
			}
		}
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.startFailed"))
			return
		}
		// Transition newly submitted DAG nodes to PREPARING for optimistic UI
		h.transitionDagNodesToPreparing(r.Context(), dagID)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "preparing"})

	case "pause":
		// Route through DAG orchestrator for proper state management.
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.PauseDag(r.Context(), dagID); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "paused"})
			return
		}
		// Legacy fallback for tasks without DAG (e.g., pre-DAG tasks).
		if err := h.DownloadMgr.PauseDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "paused"})

	case "resume":
		// Route through DAG orchestrator for proper state management.
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.ResumeDag(r.Context(), dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.resumeFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "resumed"})
			return
		}
		// Legacy fallback for tasks without DAG (e.g., pre-DAG tasks).
		if err := h.DownloadMgr.ResumeDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.resumeFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "resumed"})

	case "cancel":
		// Route through DAG orchestrator for proper state management and resource cleanup.
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.CancelDag(r.Context(), dagID); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.cancelFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "cancelled"})
			return
		}
		h.DownloadMgr.CancelDownload(id)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})

	case "retry":
		if h.DagOrch == nil && h.DownloadMgr == nil {
			writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.tasks.schedulerRequired"))
			return
		}

		h.cleanupVideoTaskCache(r.Context(), id)

		// RetryDag reuses the existing DAG instead of cancel+resubmit,
		// avoiding a race window that can produce duplicate DAGs.
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.RetryDag(r.Context(), dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})
			return
		}
		if h.DownloadMgr != nil {
			h.DownloadMgr.CancelDownload(id)
		}
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
			return
		}
		h.updateTaskDagID(r.Context(), id, dagID)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

// transitionDagNodesToPreparing transitions all non-terminal nodes in a DAG
// to PREPARING state, providing immediate optimistic feedback to the UI that
// the task is being prepared. This is called after start/resume/retry operations
// so the user sees "准备中" instantly instead of waiting for the actual state.
func (h *Handlers) transitionDagNodesToPreparing(ctx context.Context, dagID string) {
	if h.DagOrch == nil || dagID == "" {
		return
	}
	st := h.DagOrch.GetDagStatus(dagID)
	if st == nil {
		return
	}
	for _, ns := range st.Nodes {
		// Only transition nodes that are in a state that allows PREPARING
		switch ns.State {
		case orchestrator.NodeStatePending, orchestrator.NodeStatePaused,
			orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout,
			orchestrator.NodeStateNeedsRetry, orchestrator.NodeStateReady:
			_ = h.DagOrch.TransitionNode(ctx, dagID, ns.NodeID, orchestrator.NodeStatePreparing,
				orchestrator.TransitionContext{Reason: "optimistic_preparing", TriggeredBy: "api"})
		}
	}
}

func (h *Handlers) submitVideoDag(r *http.Request, taskID int) (string, error) {
	if h.DagOrch == nil {
		return "", fmt.Errorf("DAG orchestrator not available")
	}

	var seq string
	if err := h.DB.QueryRow(r.Context(), "SELECT seq FROM download_tasks WHERE id = ?", taskID).Scan(&seq); err != nil {
		return "", fmt.Errorf("query task seq: %w", err)
	}
	if seq == "" {
		seq = idgen.GenerateID()
		h.DB.Exec(r.Context(), "UPDATE download_tasks SET seq = ? WHERE id = ?", seq, taskID)
	}

	def := dag.NewDagFactory().NewVideoPipeline(seq, taskID)
	return h.DagOrch.SubmitDag(r.Context(), def)
}

// cleanupVideoTaskCache deletes the output MP4 (a partial file from a
// failed merge/transcode must be regenerated) but preserves the segments
// directory so the retry resumes at the segment level.
func (h *Handlers) cleanupVideoTaskCache(ctx context.Context, taskID int) {
	var filePath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", taskID).Scan(&filePath)

	if filePath != "" {
		_ = os.Remove(filePath)
	}

	_, _ = h.DB.Exec(ctx,
		`UPDATE download_tasks
		 SET progress = 0, completed_segments = 0, total_segments = 0,
		     error_msg = '', m3u8_url = '', updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`, taskID)
}

func (h *Handlers) TaskDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	var filePath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", id).Scan(&filePath)

	if h.DagOrch != nil {
		dagID := h.getTaskDagID(r.Context(), id)
		if dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			_ = h.DagOrch.CancelDag(r.Context(), dagID)
		}
	}

	result, err := h.DB.Exec(r.Context(),
		"DELETE FROM download_tasks WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}

	if filePath != "" {
		_ = os.Remove(filePath)
	}
	segmentsDir := filepath.Join("..", "data", "segments", fmt.Sprintf("task_%d", id))
	_ = os.RemoveAll(segmentsDir)

	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{
			"taskId":   id,
			"taskType": "video",
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}
