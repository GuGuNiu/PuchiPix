package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	"backend/internal/taskstate"
	"backend/internal/urlutil"
	"backend/internal/xutil"
)

func (h *Handlers) getTaskDagID(ctx context.Context, taskID int) (string, error) {
	if h.DB == nil {
		return "", fmt.Errorf("database unavailable")
	}
	var dagID string
	if err := h.DB.QueryRow(ctx, "SELECT COALESCE(dag_id, '') FROM download_tasks WHERE id = ?", taskID).Scan(&dagID); err != nil {
		return "", err
	}
	return dagID, nil
}

func (h *Handlers) updateTaskDagID(ctx context.Context, taskID int, dagID string) error {
	if h.DB == nil {
		return fmt.Errorf("database unavailable")
	}
	_, err := h.DB.Exec(ctx, "UPDATE download_tasks SET dag_id = ? WHERE id = ?", dagID, taskID)
	return err
}

var unicodeEscapeRe = regexp.MustCompile(`\\u([0-9a-fA-F]{4})`)

// decodeUnicodeEscapes handles legacy DB rows where the regex-based
// scraper stored undecoded \uXXXX escape sequences.
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
// comma-separated display string. The array must be decoded here because
// assigning the raw column text would be re-serialized by writeJSON as one
// opaque string.
func parsePersonForDisplay(raw string) string {
	if raw == "" || raw == "null" || raw == "[]" {
		return ""
	}
	var actors []string
	if err := json.Unmarshal([]byte(raw), &actors); err == nil {
		for i, actor := range actors {
			actors[i] = decodeUnicodeEscapes(actor)
		}
		return strings.Join(xutil.CleanActorList(actors), ", ")
	}
	return strings.Join(xutil.CleanActorList([]string{decodeUnicodeEscapes(raw)}), ", ")
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
		       COALESCE(vi.file_size, 0) AS file_size,
		       COALESCE(vi.tags, '') AS tags
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	defer rows.Close()

	tasks := []db.DownloadTask{}
	var ca, ua db.SQLTime
	for rows.Next() {
		var t db.DownloadTask
		var tagsStr string
		if err := rows.Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.SiteID, &t.Seq, &ca, &ua, &t.Title, &t.Person, &t.TotalSegments, &t.Segment, &t.FileSize, &tagsStr); err != nil {
			continue
		}
		t.Tags = task_compute.ParseTagsColumn(tagsStr)
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
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}

	ctx := r.Context()
	tasks := make([]map[string]any, 0, unifiedFetchLimit)

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
		        COALESCE(dt.file_size, 0) AS file_size,
		        COALESCE(vi.tags, '') AS tags,
		        dt.created_at, dt.updated_at
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ?`, unifiedFetchLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	for videoRows.Next() {
		var r unifiedTaskRow
		if err := videoRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
			&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
			&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
			&r.DownloadedSize, &r.ContentVerified,
			&r.TotalSegments, &r.CompletedSegments, &r.FileSize,
			&r.Tags, &r.CreatedAt, &r.UpdatedAt); err != nil {
			videoRows.Close()
			writeError(w, http.StatusInternalServerError, "task query failed")
			return
		}
		tasks = append(tasks, h.enrichUnifiedTask(r))
	}
	if err := videoRows.Err(); err != nil {
		videoRows.Close()
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	videoRows.Close()

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
		        COALESCE(total_size, 0) AS file_size,
		        COALESCE(tags, '') AS tags,
		        created_at, updated_at
		 FROM galleries
		 ORDER BY id DESC LIMIT ?`, unifiedFetchLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	for galleryRows.Next() {
		var r unifiedTaskRow
		if err := galleryRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
			&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
			&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
			&r.DownloadedSize, &r.ContentVerified,
			&r.TotalSegments, &r.CompletedSegments, &r.FileSize, &r.Tags,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			galleryRows.Close()
			writeError(w, http.StatusInternalServerError, "task query failed")
			return
		}
		tasks = append(tasks, h.enrichUnifiedTask(r))
	}
	if err := galleryRows.Err(); err != nil {
		galleryRows.Close()
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	galleryRows.Close()

	// Sniff tasks are intentionally excluded: they hold their own slot
	// (type "sniff", max 1) and are served by the separate /api/sniff
	// endpoints.
	sort.Slice(tasks, func(i, j int) bool {
		idI, _ := tasks[i]["ID"].(int)
		idJ, _ := tasks[j]["ID"].(int)
		return idI > idJ
	})

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
		"Actors":           task_compute.ParseTagsColumn(r.Protagonist),
		"ImageCount":       r.ImageCount,
		"VideoCount":       r.VideoCount,
		"GalleryTotalSize": r.TotalSize,
		"Segment":          r.CompletedSegments,
		"TotalSegments":    r.TotalSegments,
		"FileSize":         r.FileSize,
		"Tags":             task_compute.ParseTagsColumn(r.Tags),
		"CreatedAt":        r.CreatedAt,
		"UpdatedAt":        r.UpdatedAt,
	})
}

// TaskPage returns a paginated slice of unified tasks for the frontend
// infinite scroll, used when the initial SSE snapshot only covers the first
// page.
//
// Query params:
//   - page     : 1-based page number (default 1)
//   - pageSize : rows per page (default 100, max 500)
//
// The two task tables have independent ID sequences, so each is read from
// row 0 up to the end of the requested page and the results are re-sorted
// by id DESC, making a page cost O(offset + limit) per table.
func (h *Handlers) TaskPage(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}

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

	var galleryCount, videoCount int
	if err := h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries").Scan(&galleryCount); err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	if err := h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks").Scan(&videoCount); err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	totalCount := galleryCount + videoCount

	// Capped so a deep page number cannot pull an unbounded window into memory.
	fetchLimit := page * pageSize
	if fetchLimit > 2000 {
		fetchLimit = 2000
	}

	tasks := make([]map[string]any, 0, fetchLimit)

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
		        COALESCE(dt.file_size, 0) AS file_size,
		        COALESCE(vi.tags, '') AS tags,
		        dt.created_at, dt.updated_at
		 FROM download_tasks dt
		 LEFT JOIN video_infos vi ON dt.id = vi.task_id
		 ORDER BY dt.id DESC LIMIT ?`, fetchLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	for videoRows.Next() {
		var r unifiedTaskRow
		if err := videoRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
			&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
			&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
			&r.DownloadedSize, &r.ContentVerified,
			&r.TotalSegments, &r.CompletedSegments, &r.FileSize,
			&r.Tags, &r.CreatedAt, &r.UpdatedAt); err != nil {
			videoRows.Close()
			writeError(w, http.StatusInternalServerError, "task query failed")
			return
		}
		tasks = append(tasks, h.enrichUnifiedTask(r))
	}
	if err := videoRows.Err(); err != nil {
		videoRows.Close()
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	videoRows.Close()

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
		        COALESCE(total_size, 0) AS file_size,
		        COALESCE(tags, '') AS tags,
		        created_at, updated_at
		 FROM galleries
		 ORDER BY id DESC LIMIT ?`, fetchLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	for galleryRows.Next() {
		var r unifiedTaskRow
		if err := galleryRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
			&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
			&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
			&r.DownloadedSize, &r.ContentVerified,
			&r.TotalSegments, &r.CompletedSegments, &r.FileSize, &r.Tags,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			galleryRows.Close()
			writeError(w, http.StatusInternalServerError, "task query failed")
			return
		}
		tasks = append(tasks, h.enrichUnifiedTask(r))
	}
	if err := galleryRows.Err(); err != nil {
		galleryRows.Close()
		writeError(w, http.StatusInternalServerError, "task query failed")
		return
	}
	galleryRows.Close()

	// NOTE: Sniff tasks are excluded here for the same reason as in TaskListUnified.
	sort.Slice(tasks, func(i, j int) bool {
		idI, _ := tasks[i]["ID"].(int)
		idJ, _ := tasks[j]["ID"].(int)
		return idI > idJ
	})

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

	hasMore := (page * pageSize) < totalCount

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

	// A single routing call resolves URL cleaning, normalization, M3U8
	// detection, provider matching, page-type identification, and the
	// Referer domain to inject.
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
			def := dag.NewDagFactory().NewVideoPipeline(*seqPtr, id, siteID)
			var submitErr error
			dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
			if submitErr != nil {
				// pending→failed from the fresh row; a store error here can
				// only be an I/O failure, so the 500 below is unchanged.
				_ = h.stateStore.Transition(r.Context(), id, taskstate.Update{
					Status: taskstate.StatusFailed,
					Set:    map[string]any{"error_msg": "DAG submission failed: " + submitErr.Error()},
				})
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
				return
			}
		if err := h.updateTaskDagID(r.Context(), id, dagID); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
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
		if err := h.updateGalleryDagID(r.Context(), galleryID, dagID); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}

		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"status":   "pending",
			})
		}
	}

	if h.EventBus != nil {
		eventStatus := "pending"
		_ = h.DB.QueryRow(r.Context(),
			"SELECT COALESCE(status, 'pending') FROM galleries WHERE id = ?", galleryID).Scan(&eventStatus)
		h.EventBus.Emit("gallery:created", map[string]any{
			"ID":        galleryID,
			"SourceURL": normalizedURL,
			"SiteID":    siteID,
			"Status":    eventStatus,
			"DagID":     dagID,
			"DisplayID": *seqPtr,
			"TaskType":  "gallery",
			"CreatedAt": time.Now(),
			"UpdatedAt": time.Now(),
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
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}
	h.sniffCreateMu.Lock()
	defer h.sniffCreateMu.Unlock()
	var active bool
	if err := h.DB.QueryRow(r.Context(),
		"SELECT EXISTS(SELECT 1 FROM sniff_tasks WHERE status IN ('pending', 'scraping', 'running', 'sniffing'))").Scan(&active); err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}
	if active {
		writeError(w, http.StatusConflict, "A sniff task is already running")
		return
	}
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
		def := dag.NewDagFactory().NewSniffPipeline(pageURL, *seqPtr, siteID)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
			_, updateErr := h.DB.Exec(r.Context(),
				"UPDATE sniff_tasks SET status = 'failed', error_msg = ? WHERE id = ?",
				"DAG submission failed: "+submitErr.Error(), sniffID)
			if updateErr != nil {
				_, _ = h.DB.Exec(r.Context(), "DELETE FROM sniff_tasks WHERE id = ?", sniffID)
			}
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
		result, updateErr := h.DB.Exec(r.Context(), "UPDATE sniff_tasks SET dag_id = ? WHERE id = ?", dagID, sniffID)
		if updateErr != nil {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = h.DagOrch.CancelDagAndWait(cleanupCtx, dagID)
			_ = h.DagOrch.RemoveDag(cleanupCtx, dagID)
			cancel()
			_, _ = h.DB.Exec(r.Context(), "DELETE FROM sniff_tasks WHERE id = ?", sniffID)
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil || rows == 0 {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = h.DagOrch.CancelDagAndWait(cleanupCtx, dagID)
			_ = h.DagOrch.RemoveDag(cleanupCtx, dagID)
			cancel()
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
			return
		}
	}

	if h.EventBus != nil {
		h.EventBus.Emit("task:created", map[string]any{
			"ID":        sniffID,
			"DisplayID": *seqPtr,
			"URL":       pageURL,
			"Status":    "pending",
			"TaskType":  "sniff",
			"SiteID":    siteID,
			"DagID":     dagID,
			"CreatedAt": time.Now(),
			"UpdatedAt": time.Now(),
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

// checkVideoTaskDuplicate returns the existing video task when the URL matches
// a stored row exactly, a mirror domain of the same site, or the same path
// signature; nil when no duplicate exists.
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

// checkGalleryDuplicate returns the existing gallery when the URL matches a
// stored row exactly, a mirror domain of the same site, or the same path
// signature; nil when no duplicate exists.
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
	var detailTags string
	var ca, ua db.SQLTime
	err := h.DB.QueryRow(r.Context(),
		`SELECT dt.id, dt.url, dt.m3u8_url, dt.status, dt.progress,
		       dt.file_path, dt.format, dt.priority, dt.error_msg,
		       dt.site_id, dt.seq, dt.created_at, dt.updated_at,
		       COALESCE(NULLIF(vi.title, ''), '') AS title,
		       COALESCE(NULLIF(vi.actors, 'null'), '') AS protagonist,
	       COALESCE(dt.total_segments, 0) AS total_segments,
	       COALESCE(dt.completed_segments, 0) AS completed_segments,
	       COALESCE(vi.file_size, 0) AS file_size,
	       COALESCE(vi.tags, '') AS tags
	FROM download_tasks dt
	LEFT JOIN video_infos vi ON dt.id = vi.task_id
	WHERE dt.id = ?`, id).
		Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.SiteID, &t.Seq, &ca, &ua, &t.Title, &t.Person, &t.TotalSegments, &t.Segment, &t.FileSize, &detailTags)
	if err != nil {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}
	t.CreatedAt = ca.Time
	t.UpdatedAt = ua.Time
	t.Tags = task_compute.ParseTagsColumn(detailTags)
	t.Person = parsePersonForDisplay(t.Person)
	t.Title = task_compute.StripPersonFromTitle(t.Title, t.Person)
	t.EffectiveStatus = task_compute.ComputeEffectiveStatus(t.Status, "video", 0, 0)
	t.ProgressStage = task_compute.ComputeProgressStage(t.Status, "video", t.Progress)
	t.AllowedActions = task_compute.ComputeAllowedActions(t.Status, "video")

	// Detail consumers need the joined video_infos metadata in one round trip.
	// Tags/Actors/Categories hold JSON-array text, so they must go through
	// ParseTagsColumn; assigning the raw column text serializes the whole
	// array literal into a single string value.
	t.VideoInfo = &db.VideoInfo{TaskID: id, SourceURL: t.URL}
	var viDuration float64
	var viResolution, viActors, viTagsRaw, viCategories string
	var viFileSize int64
	viErr := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(title, ''), COALESCE(duration, 0), COALESCE(resolution, ''),
		        COALESCE(file_size, 0), COALESCE(NULLIF(actors, 'null'), ''), COALESCE(tags, ''),
		        COALESCE(NULLIF(categories, 'null'), '')
		 FROM video_infos WHERE task_id = ?`, id).
		Scan(&t.VideoInfo.Title, &viDuration, &viResolution, &viFileSize, &viActors, &viTagsRaw, &viCategories)
	if viErr == nil {
		t.VideoInfo.Duration = viDuration
		t.VideoInfo.Resolution = viResolution
		t.VideoInfo.FileSize = viFileSize
		t.VideoInfo.Actors = task_compute.ParseTagsColumn(viActors)
		t.VideoInfo.Tags = task_compute.ParseTagsColumn(viTagsRaw)
		t.VideoInfo.Categories = task_compute.ParseTagsColumn(viCategories)
	} else {
		t.VideoInfo = nil
	}
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
	readDagID := func() (string, bool) {
		dagID, err := h.getTaskDagID(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.queryFailed"))
			return "", false
		}
		return dagID, true
	}

	switch req.Action {
	case "start":
		// Reuse a live DAG (resume paused nodes, retry failed ones) instead
		// of submitting a second one: two DAGs for the same task download
		// the same files concurrently.
		dagID, dagOK := readDagID()
		if !dagOK {
			return
		}
		if h.DagOrch != nil && dagID != "" {
			if st := h.DagOrch.GetDagStatus(dagID); st != nil {
				hasPaused, hasFailed, hasCancelled, hasActive := false, false, false, false
				for _, ns := range st.Nodes {
					switch ns.State {
					case orchestrator.NodeStatePaused:
						hasPaused = true
					case orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout, orchestrator.NodeStateNeedsRetry:
						hasFailed = true
					case orchestrator.NodeStateCancelled:
						hasCancelled = true
					default:
						if !orchestrator.IsDeletableState(ns.State) {
							hasActive = true
						}
					}
				}
				// A fully-cancelled DAG is a dead end (CANCELLED has no
				// outgoing FSM edges), but the entity table allows
				// cancelled → pending: restart the task on a fresh DAG
				// instead of answering "already-running" forever.
				if !hasActive && hasCancelled && !hasPaused && !hasFailed {
					newDagID, err := h.submitVideoDag(r, id)
					if err != nil {
						writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.startFailed"))
						return
					}
					h.transitionDagNodesToPreparing(r.Context(), newDagID)
					writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": newDagID, "status": "preparing"})
					return
				}
				var actErr error
				switch {
				case hasActive || (!hasPaused && !hasFailed):
					// Nothing to resume or retry; report the live state
					// instead of creating a duplicate DAG.
					writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "already-running"})
					return
				case hasPaused:
					actErr = h.DagOrch.ResumeDag(r.Context(), dagID, "")
				default:
					actErr = h.DagOrch.RetryDag(r.Context(), dagID, "")
				}
				if actErr != nil {
					writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.startFailed"))
					return
				}
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
		h.transitionDagNodesToPreparing(r.Context(), dagID)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "preparing"})

	case "pause":
		dagID, dagOK := readDagID()
		if !dagOK {
			return
		}
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			waitCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			err := h.DagOrch.PauseDagAndWait(waitCtx, dagID)
			cancel()
			if err != nil {
				writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
				return
			}
			// The store validates legality (a row that raced to a terminal
			// status is not clobbered to paused) and emits the
			// task:progress(paused) event itself.
			if err := h.stateStore.Transition(r.Context(), id, taskstate.Update{Status: taskstate.StatusPaused}); err != nil {
				var conflict *taskstate.ConflictError
				if errors.As(err, &conflict) {
					writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
					return
				}
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "paused"})
			return
		}
		if err := h.DownloadMgr.PauseDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "paused"})

	case "resume":
		dagID, dagOK := readDagID()
		if !dagOK {
			return
		}
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.ResumeDag(r.Context(), dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.resumeFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "resumed"})
			return
		}
		if err := h.DownloadMgr.ResumeDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.resumeFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "resumed"})

	case "cancel":
		dagID, dagOK := readDagID()
		if !dagOK {
			return
		}
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			waitCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			err := h.DagOrch.CancelDagAndWait(waitCtx, dagID)
			cancel()
			if err != nil {
				writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.cancelFailed"))
				return
			}
			// Same legality guard as pause: cancelling a row that raced to
			// completed returns 409 instead of clobbering it.
			if err := h.stateStore.Transition(r.Context(), id, taskstate.Update{
				Status: taskstate.StatusCancelled,
				Set:    map[string]any{"error_msg": ""},
			}); err != nil {
				var conflict *taskstate.ConflictError
				if errors.As(err, &conflict) {
					writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.cancelFailed"))
					return
				}
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.cancelFailed"))
				return
			}
			if h.EventBus != nil {
				h.EventBus.Emit("task:cancelled", map[string]any{"taskId": id, "taskType": "video"})
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

		dagID, dagOK := readDagID()
		if !dagOK {
			return
		}
		if h.DagOrch != nil && dagID != "" {
			if st := h.DagOrch.GetDagStatus(dagID); st != nil {
				hasPaused, hasFailed, hasCancelled := false, false, false
				for _, ns := range st.Nodes {
					switch ns.State {
					case orchestrator.NodeStatePaused:
						hasPaused = true
					case orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout, orchestrator.NodeStateNeedsRetry:
						hasFailed = true
					case orchestrator.NodeStateCancelled:
						hasCancelled = true
					}
				}
				// A fully-cancelled DAG is a dead end (CANCELLED has no
				// outgoing FSM edges): retry it by submitting a fresh DAG,
				// mirroring the no-live-DAG fallback below.
				if !hasPaused && !hasFailed && hasCancelled {
					if err := h.cleanupVideoTaskCache(r.Context(), id); err != nil {
						writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
						return
					}
					newDagID, err := h.submitVideoDag(r, id)
					if err != nil {
						writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
						return
					}
					h.transitionDagNodesToPreparing(r.Context(), newDagID)
					writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": newDagID, "status": "retrying"})
					return
				}
				if !hasPaused && !hasFailed {
					writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.retryFailed"))
					return
				}
				if err := h.cleanupVideoTaskCache(r.Context(), id); err != nil {
					writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
					return
				}
				var actionErr error
				if hasPaused {
					actionErr = h.DagOrch.ResumeDag(r.Context(), dagID, "")
				} else {
					actionErr = h.DagOrch.RetryDag(r.Context(), dagID, "")
				}
				if actionErr != nil {
					writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})
				return
			}
		}
		if err := h.cleanupVideoTaskCache(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
			return
		}
		if h.DownloadMgr != nil {
			stopCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			err := h.DownloadMgr.StopDownloadForRestart(stopCtx, id)
			cancel()
			if err != nil {
				writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.retryFailed"))
				return
			}
		}
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

// transitionDagNodesToPreparing moves every non-terminal node of a DAG to
// PREPARING after start/resume/retry, so the UI reflects the pending state
// immediately instead of waiting for the scheduler to report it.
func (h *Handlers) transitionDagNodesToPreparing(ctx context.Context, dagID string) {
	if h.DagOrch == nil || dagID == "" {
		return
	}
	st := h.DagOrch.GetDagStatus(dagID)
	if st == nil {
		return
	}
	for _, ns := range st.Nodes {
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

	var seq, siteID string
	if err := h.DB.QueryRow(r.Context(),
		"SELECT seq, site_id FROM download_tasks WHERE id = ?", taskID).Scan(&seq, &siteID); err != nil {
		return "", fmt.Errorf("query task seq: %w", err)
	}
	if seq == "" {
		seq = idgen.GenerateID()
		h.DB.Exec(r.Context(), "UPDATE download_tasks SET seq = ? WHERE id = ?", seq, taskID)
	}

	def := dag.NewDagFactory().NewVideoPipeline(seq, taskID, siteID)
	dagID, err := h.DagOrch.SubmitDag(r.Context(), def)
	if err != nil {
		return "", err
	}
	if err := h.updateTaskDagID(r.Context(), taskID, dagID); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.DagOrch.CancelDagAndWait(cleanupCtx, dagID)
		_ = h.DagOrch.RemoveDag(cleanupCtx, dagID)
		return "", err
	}
	return dagID, nil
}

// cleanupVideoTaskCache deletes the output MP4 (a partial file from a
// failed merge/transcode must be regenerated) but preserves the segments
// directory so the retry resumes at the segment level.
func (h *Handlers) cleanupVideoTaskCache(ctx context.Context, taskID int) error {
	var filePath string
	if err := h.DB.QueryRow(ctx,
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", taskID).Scan(&filePath); err != nil {
		return err
	}

	if filePath != "" {
		safePath, err := h.validateDataPath("videos", filePath, false)
		if err != nil {
			return err
		}
		info, statErr := os.Stat(safePath)
		if statErr == nil && info.IsDir() {
			return fmt.Errorf("video output path is a directory: %s", safePath)
		}
		if statErr != nil && !os.IsNotExist(statErr) {
			return statErr
		}
		if statErr == nil {
			if err := os.Remove(safePath); err != nil {
				return err
			}
		}
	}

	result, err := h.DB.Exec(ctx,
		`UPDATE download_tasks
		 SET progress = 0, completed_segments = 0, total_segments = 0,
		     error_msg = '', m3u8_url = '', updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`, taskID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (h *Handlers) videoSegmentsDir(taskID int) string {
	if h.DownloadMgr != nil {
		return h.DownloadMgr.TaskSegmentsDir(taskID)
	}
	return filepath.Join(h.dataRoot(), "segments", fmt.Sprintf("task_%d", taskID))
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

	ctx := r.Context()
	var filePath, dagID string
	if err := h.DB.QueryRow(ctx,
		"SELECT COALESCE(file_path, ''), COALESCE(dag_id, '') FROM download_tasks WHERE id = ?", id).Scan(&filePath, &dagID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		} else {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		}
		return
	}

	waitCtx, waitCancel := context.WithTimeout(ctx, 10*time.Second)
	defer waitCancel()
	if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
		if err := h.DagOrch.CancelDagAndWait(waitCtx, dagID); err != nil {
			writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		}
	}

	deleted := false
	if h.DownloadMgr != nil {
		if err := h.DownloadMgr.CancelDownloadAndWait(waitCtx, id); err != nil {
			writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		}
		defer func() {
			if !deleted && h.DownloadMgr != nil {
				h.DownloadMgr.AllowDownload(id)
			}
		}()
	}

	lockKey := filePath
	if lockKey == "" {
		lockKey = h.videoSegmentsDir(id)
	}
	unlock := h.lockDeletionPath(lockKey)
	defer unlock()

	var currentFilePath string
	if err := h.DB.QueryRow(ctx,
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", id).Scan(&currentFilePath); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		} else {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		}
		return
	}

	segmentsDir := h.videoSegmentsDir(id)
	if !filepath.IsAbs(segmentsDir) {
		segmentsDir = filepath.Join(h.dataRoot(), segmentsDir)
	}
	safeSegmentsDir, err := h.validateDataPath("segments", segmentsDir, false)
	if err != nil {
		writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}
	paths := []string{safeSegmentsDir}
	if currentFilePath != "" {
		safeFilePath, err := h.validateDataPath("videos", currentFilePath, false)
		if err != nil {
			writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		}
		if info, statErr := os.Stat(safeFilePath); statErr == nil && info.IsDir() {
			writeError(w, http.StatusConflict, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		} else if statErr != nil && !os.IsNotExist(statErr) {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		}
		var references int
		if err := h.DB.QueryRow(ctx,
			"SELECT COUNT(*) FROM download_tasks WHERE id <> ? AND file_path = ?", id, currentFilePath).Scan(&references); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
			return
		}
		if references == 0 {
			paths = append(paths, safeFilePath)
		}
	}
	if err := removeAllSync(ctx, paths...); err != nil {
		cleanupLogger.Error("Task cache cleanup failed", "taskId", id, "error", err.Error())
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}

	result, err := h.DB.Exec(ctx, "DELETE FROM download_tasks WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}
	rows, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}
	if rows == 0 {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}
	deleted = true

	if h.VideoTracker != nil {
		h.VideoTracker.RemoveTask(id)
	}
	if h.DagOrch != nil && dagID != "" {
		if err := h.DagOrch.RemoveDag(ctx, dagID); err != nil && !errors.Is(err, orchestrator.ErrDagNotFound) {
			cleanupLogger.Warn("Task DAG cleanup failed", "taskId", id, "dagId", dagID, "error", err.Error())
		}
	}
	if h.EventBus != nil {
		h.EventBus.Emit("task:deleted", map[string]any{
			"taskId":   id,
			"taskType": "video",
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}
