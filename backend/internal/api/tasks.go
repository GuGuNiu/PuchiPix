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
	"strconv"
	"strings"
	"time"

	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/idgen"
	"backend/internal/orchestrator/dag"
	"backend/internal/sites"
	"backend/internal/urlutil"
)

// getTaskDagID retrieves the DAG ID associated with a video task.
// Returns empty string if no DAG has been created for this task.
func (h *Handlers) getTaskDagID(ctx context.Context, taskID int) string {
	var dagID string
	err := h.DB.QueryRow(ctx, "SELECT COALESCE(dag_id, '') FROM download_tasks WHERE id = ?", taskID).Scan(&dagID)
	if err != nil {
		return ""
	}
	return dagID
}

// updateTaskDagID stores the DAG ID in the download_tasks table.
func (h *Handlers) updateTaskDagID(ctx context.Context, taskID int, dagID string) {
	h.DB.Exec(ctx, "UPDATE download_tasks SET dag_id = ? WHERE id = ?", dagID, taskID)
}

// unicodeEscapeRe matches literal \uXXXX sequences (backslash-u-hex4)
// that appear when regex-extracted JSON values bypass json.Unmarshal.
var unicodeEscapeRe = regexp.MustCompile(`\\u([0-9a-fA-F]{4})`)

// decodeUnicodeEscapes converts literal \uXXXX sequences in a string to
// actual Unicode characters. This handles legacy DB rows where the old
// regex-based scraper stored undecoded escape sequences (e.g. "\u5973\u795e"
// instead of "女神").
func decodeUnicodeEscapes(s string) string {
	return unicodeEscapeRe.ReplaceAllStringFunc(s, func(match string) string {
		hex := match[2:] // strip leading \u
		if code, err := strconv.ParseInt(hex, 16, 32); err == nil {
			return string(rune(code))
		}
		return match
	})
}

// parsePersonForDisplay converts the DB-stored actors JSON string (e.g.
// `["女神ジュン"]` or legacy `["\u5973\u795e..."]`) into a human-readable
// comma-separated display string (e.g. "女神ジュン").
//
// This fixes the double-serialization issue where the JSON array string
// from the DB was re-serialized by writeJSON, producing escaped output
// like `["\\u5973..."]` instead of the actual actor name.
//
// Returns "" for empty/null/[] values.
func parsePersonForDisplay(raw string) string {
	if raw == "" || raw == "null" || raw == "[]" {
		return ""
	}
	// Try parsing as a JSON string array.
	var actors []string
	if err := json.Unmarshal([]byte(raw), &actors); err == nil {
		for i, a := range actors {
			actors[i] = decodeUnicodeEscapes(a)
		}
		return strings.Join(actors, ", ")
	}
	// Fallback: if it's not valid JSON, decode escapes and return as-is.
	return decodeUnicodeEscapes(raw)
}

// TaskList returns a paginated list of video download tasks.
//
// NOTE: This endpoint ONLY queries the download_tasks table, which stores
// video/M3U8 download tasks. It does NOT include gallery (写真包) tasks,
// which are stored in the galleries table and served via ShelfList.
//
// Task type distinction:
//   - download_tasks: Video tasks (M3U8 streams, video files)
//   - galleries: Gallery tasks (photo sets/写真包, primarily images with optional videos)
//
// For a unified view of ALL task types (video + gallery + sniff), use
// TaskListUnified (/api/tasks/all) instead. The frontend fetchTasks()
// should use that endpoint to avoid clearing gallery/sniff tasks from
// the store on every page mount — a bug that caused "前端全部消失".
//
// See: gallery.go ShelfList for gallery task queries
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
		// Strip person/model name prefix from title for display.
		t.Title = StripPersonFromTitle(t.Title, t.Person)
		// Populate computed fields for frontend consumption.
		t.EffectiveStatus = computeEffectiveStatus(t.Status, "video", 0, 0)
		t.ProgressStage = computeProgressStage(t.Status, "video", t.Progress)
		t.AllowedActions = computeAllowedActions(t.Status, "video")
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
}

// TaskListUnified returns ALL task types (video + gallery + sniff) in a
// single response, using the same UNION ALL query as the SSE initial
// event. This is the correct endpoint for the frontend's fetchTasks()
// fallback — using /api/tasks (video only) caused all gallery/sniff tasks
// to vanish from the store every time fetchTasks() was called (page mount,
// error recovery, batch search completion).
//
// The response format matches the SSE initial event exactly: each task is
// a map[string]any with PascalCase keys, enriched with EffectiveStatus,
// ProgressStage, and AllowedActions computed fields.
func (h *Handlers) TaskListUnified(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	rows, err := h.DB.Query(r.Context(),
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
		 UNION ALL
		 SELECT 'gallery' AS task_type, id, COALESCE(source_url, '') AS url,
		        COALESCE(status, 'pending') AS status,
		        CASE
		            WHEN COALESCE(status, 'pending') = 'completed' THEN 100
		            WHEN COALESCE(content_verified, false) AND (COALESCE(image_count, 0) + COALESCE(video_count, 0)) > 0 THEN 99
		            WHEN COALESCE(total_size, 0) > 0 THEN
		                CASE
		                    WHEN ROUND(COALESCE(downloaded_size, 0) * 1.0 / NULLIF(total_size, 0) * 100, 1) > 99 THEN 99
		                    ELSE ROUND(COALESCE(downloaded_size, 0) * 1.0 / NULLIF(total_size, 0) * 100, 1)
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
		 UNION ALL
		 SELECT 'sniff' AS task_type, id, COALESCE(url, '') AS url,
		        COALESCE(status, 'pending') AS status, 0 AS progress,
		        '' AS file_path, '' AS format, 0 AS priority,
		        COALESCE(error_msg, '') AS error_msg,
		        COALESCE(site_id, '') AS site_id,
		        seq, '' AS title, '' AS protagonist,
		        0 AS image_count, 0 AS video_count,
		        0 AS total_size, 0 AS downloaded_size,
		        false AS content_verified,
		        0 AS total_segments, 0 AS completed_segments,
		        created_at, updated_at
		 FROM sniff_tasks
		 ORDER BY id DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.queryFailed"))
		return
	}
	defer rows.Close()

	tasks := []map[string]any{}
	for rows.Next() {
		var r unifiedTaskRow
		if err := rows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
			&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
			&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
			&r.DownloadedSize, &r.ContentVerified,
			&r.TotalSegments, &r.CompletedSegments,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			continue
		}
		tasks = append(tasks, enrichTaskMap(map[string]any{
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
		}))
	}
	writeJSON(w, http.StatusOK, tasks)
}

// isM3U8URL checks whether a URL is likely an M3U8/HLS stream URL using
// multiple detection signals rather than just the .m3u8 suffix. This
// prevents false negatives where M3U8 URLs use non-standard extensions
// or are embedded in query parameters.
//
// Detection signals (any match → true):
//  1. Path ends with .m3u8 or .m3u (most common)
//  2. Path contains /m3u8/ or /hls/ or /stream/ or /playlist/ segments
//  3. Query parameters contain m3u8-related keys
//  4. Known CDN domains that primarily serve HLS content
func isM3U8URL(rawURL string) bool {
	lower := strings.ToLower(rawURL)

	// Signal 1: Standard M3U8/M3U file extensions.
	if strings.HasSuffix(lower, ".m3u8") || strings.HasSuffix(lower, ".m3u") {
		return true
	}

	// Signal 2: Path contains HLS-related segments.
	parsed, err := url.Parse(rawURL)
	if err == nil {
		pathLower := strings.ToLower(parsed.Path)
		for _, seg := range []string{"/m3u8/", "/hls/", "/stream/", "/playlist/"} {
			if strings.Contains(pathLower, seg) {
				return true
			}
		}
		// Signal 3: Query parameters hint at M3U8 content.
		queryLower := strings.ToLower(parsed.RawQuery)
		for _, key := range []string{"m3u8", "m3u", "hls", "playlist"} {
			if strings.Contains(queryLower, key) {
				return true
			}
		}
	}

	// Signal 4: Known HLS CDN domains (patterns that almost always serve M3U8).
	knownCDNPatterns := []string{
		".m3u8.", "hls.", "cdn", "11yun.space", "stream.",
	}
	for _, pattern := range knownCDNPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}

	return false
}

// TaskCreate creates a new download task from the request body.
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

	// URL normalization: clean invisible characters (zero-width, BOM,
	// newlines) and normalize the URL (lowercase hostname, http→https,
	// strip trailing slash, sort query params, remove fragment) for
	// consistent dedup matching. Ports TS cleanUrl() + normalizeUrl().
	cleanedURL := urlutil.CleanURL(req.URL)
	normalizedURL := urlutil.NormalizeURL(cleanedURL)

	// Task type pre-processor: determine the correct task pipeline
	// (gallery / sniff / video) based on the site module's configured
	// type field, NOT just on whether the provider implements the
	// GallerySiteProvider interface.
	//
	// This fixes the critical bug where video sites like Kanav (which
	// implement GallerySiteProvider for M3U8 sniffing capabilities)
	// were incorrectly routed to the gallery pipeline, causing the
	// frontend to display "图片" type and "图包" toast for video tasks.
	//
	// Routing logic:
	//   1. Match provider via GetProviderByUrl()
	//   2. Look up the site module config (type: "photo" | "video")
	//   3. Only route to gallery/sniff pipeline if module type == "photo"
	//   4. Video-type providers fall through to video task creation
	providerMatched := false
	if h.SiteReg != nil && !isM3U8URL(cleanedURL) {
		if provider, ok := h.SiteReg.GetProviderByUrl(cleanedURL); ok {
			providerMatched = true
			// Check the site module's type field to determine the
			// correct task pipeline. This is the pre-processor that
			// correctly assigns sub-processors based on site type.
			siteType := "photo" // default to photo for legacy providers
			if mod, modOk := h.SiteReg.GetModule(provider.SiteID()); modOk && mod.Type != "" {
				siteType = mod.Type
			}

			if siteType == "photo" {
				if _, ok := provider.(sites.GallerySiteProvider); ok {
					// Listing page detection: if the URL is a listing/search page
					// (not a single gallery detail page), create a sniff task to
					// crawl all gallery links from that page. This mirrors the TS
					// implementation's isListingPage() → sniff task routing that
					// was lost during the Go migration.
					if listProvider, ok := provider.(interface {
						IsListingPage(url string) bool
					}); ok && listProvider.IsListingPage(cleanedURL) {
						h.createSniffTask(w, r, cleanedURL, provider.SiteID(), req.Seq)
						return
					}
					// Gallery detail page: run full scrape → download → verify pipeline.
					h.createGalleryTask(w, r, cleanedURL, normalizedURL, provider, req.Seq)
					return
				}
			}
			// siteType == "video": fall through to video task creation
			// below. The provider implements GallerySiteProvider for
			// M3U8 sniffing, but the task should be treated as a video
			// download, not a gallery task.
		}
	}

	// Fallback detection: if the URL didn't match any known provider
	// and isn't a recognizable M3U8/HLS stream URL, reject it instead
	// of silently creating a video download task. This prevents users
	// from accidentally submitting non-media URLs (e.g., random web
	// pages) as download tasks.
	//
	// Per design spec (260725/01-03): "禁止无法识别→当普通下载任务处理"
	if !providerMatched && !isM3U8URL(cleanedURL) && h.SiteReg != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unrecognizedUrl"))
		return
	}

	if req.Format == "" {
		req.Format = "mp4"
	}
	if req.Priority == 0 {
		req.Priority = 1
	}

	// ── Module identification for video tasks ──
	// Even without a dedicated Provider, identify the site module
	// from the URL so the task carries site_id metadata. This enables
	// frontend module badges, domain-based dedup, and mirror-domain
	// fallback during M3U8 scraping.
	siteID := ""
	if h.SiteReg != nil {
		if mod, ok := h.SiteReg.GetModuleByUrl(cleanedURL); ok {
			siteID = mod.ID
		}
	}

	// ── 3-tier dedup (ported from TS task-dedup.ts) ──
	// Tier 1: Exact match on normalized URL.
	// Tier 2: Mirror-domain match (same content, different mirror domain).
	// Tier 3: Path-signature match (domain-agnostic path + query matching).
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

	// Auto-start video task: submit DAG pipeline so the task enters
	// "scraping" status immediately, matching gallery task behavior.
	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewVideoPipeline(id)
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

	// Update status to scraping since DAG is now running.
	_, _ = h.DB.Exec(r.Context(),
		`UPDATE download_tasks SET status = 'scraping', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id)

	// Emit task:created so SSE clients receive real-time upsert
	if h.EventBus != nil {
		now := time.Now()
		h.EventBus.Emit("task:created", db.DownloadTask{
			ID:        id,
			URL:       normalizedURL,
			Status:    "scraping",
			Progress:  0,
			Format:    req.Format,
			Priority:  req.Priority,
			SiteID:    siteID,
			Seq:       seqPtr,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	// Return full DownloadTask object (replaces partial {ID, DisplayID, ...} response)
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
		created.EffectiveStatus = computeEffectiveStatus(created.Status, "video", 0, 0)
		created.ProgressStage = computeProgressStage(created.Status, "video", created.Progress)
		created.AllowedActions = computeAllowedActions(created.Status, "video")
		writeJSON(w, http.StatusCreated, created)
	} else {
		// Fallback: return minimal response if query fails
		writeJSON(w, http.StatusCreated, map[string]any{"ID": id, "DisplayID": *seqPtr, "Status": "scraping", "SiteID": siteID, "dagId": dagID})
	}
}

// createGalleryTask handles gallery URL submission by creating a
// gallery record in the database and submitting a gallery DAG pipeline
// (scrape → download → extract → verify) to the orchestrator. The
// scrape node will populate title, protagonist, images, and videos
// via the registered GallerySiteProvider. The normalizedURL is stored
// as source_url for consistent dedup matching across mirror domains.
func (h *Handlers) createGalleryTask(w http.ResponseWriter, r *http.Request, pageURL, normalizedURL string, provider sites.SiteProvider, userSeq string) {
	siteID := provider.SiteID()

	// Gallery dedup: 3-tier matching before creating a new record.
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

	// Extract domain for the scraped_domain field.
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

	// Submit gallery DAG pipeline for scraping + downloading.
	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewGalleryPipeline(normalizedURL, siteID, galleryID)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
			// DAG submission failed: mark the gallery as failed so the
			// user can retry rather than leaving an orphaned "pending"
			// record with no pipeline attached.
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
		// Store the DAG ID for future lookups.
		h.updateGalleryDagID(r.Context(), galleryID, dagID)

		// Update gallery status to scraping now that the DAG has been
		// submitted and the scrape node will be scheduled. Without this,
		// the gallery stays "pending" for the entire scrape duration
		// (~10-30s), and the frontend shows "等待中" with no sub-status
		// even though the scraper is actively running. This matches the
		// video task handler behavior (tasks.go L269-271).
		h.DB.Exec(r.Context(),
			"UPDATE galleries SET status = 'scraping', updated_at = CURRENT_TIMESTAMP WHERE id = ?", galleryID)

		// Emit task:progress so SSE clients see the status transition
		// from "pending" to "scraping" immediately.
		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"status":   "scraping",
			})
		}
	}

	// Emit gallery:created event for SSE clients (PascalCase keys
	// for consistency with task:created and SSE initial events).
	// Uses "ID" (not "GalleryID") so the frontend taskKey() can
	// directly use it without field-name translation.
	// Status is "scraping" (not "pending") because the DAG has been
	// submitted and the scrape node is queued for execution.
	if h.EventBus != nil {
		h.EventBus.Emit("gallery:created", map[string]any{
			"ID":         galleryID,
			"SourceURL":  normalizedURL,
			"SiteID":     siteID,
			"Status":     "scraping",
			"DagID":      dagID,
			"DisplayID":  *seqPtr,
			"TaskType":   "gallery",
			"CreatedAt":  time.Now(),
			"UpdatedAt":  time.Now(),
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"TaskType":        "gallery",
		"ID":              galleryID,
		"DisplayID":       *seqPtr,
		"URL":             normalizedURL,
		"Status":          "scraping",
		"SiteID":          siteID,
		"CreatedAt":       time.Now(),
		"UpdatedAt":       time.Now(),
		"EffectiveStatus": computeEffectiveStatus("scraping", "gallery", 0, 0),
		"ProgressStage":   computeProgressStage("scraping", "gallery", 0),
		"AllowedActions":  computeAllowedActions("scraping", "gallery"),
	})
}

// createSniffTask handles listing page URL submission by creating a
// sniff task record and submitting a sniff DAG pipeline for crawling.
// This mirrors the TS implementation's isListingPage() → sniff task →
// scrapeListingAndEnqueue() routing that was lost during the Go migration.
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

	// Submit sniff DAG pipeline for crawling (chromedp-based M3U8 capture).
	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewSniffPipeline(pageURL, sniffID)
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
		// Store the DAG ID for future lookups.
		h.DB.Exec(r.Context(), "UPDATE sniff_tasks SET dag_id = ? WHERE id = ?", dagID, sniffID)
	}

	// Emit sniff task creation event for SSE clients.
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
		"EffectiveStatus": computeEffectiveStatus("pending", "sniff", 0, 0),
		"ProgressStage":   computeProgressStage("pending", "sniff", 0),
		"AllowedActions":  computeAllowedActions("pending", "sniff"),
	})
}

// checkVideoTaskDuplicate implements the 3-tier dedup for the
// download_tasks table: exact (normalized URL) → mirror (mirror-domain
// variants) → path-signature (domain-agnostic). Returns a 409 response
// map if a duplicate is found, or nil if no duplicate exists.
//
// Ported from TS: src/lib/utils/task-dedup.ts → checkVideoTaskDuplicate()
func (h *Handlers) checkVideoTaskDuplicate(r *http.Request, normalizedURL string) map[string]any {
	ctx := r.Context()

	// Tier 1: Exact match on normalized URL.
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

	// Tier 2: Mirror-domain match.
	if h.SiteReg != nil {
		if mod, ok := h.SiteReg.GetModuleByUrl(normalizedURL); ok && len(mod.Domains) > 1 {
			mirrorInfo := urlutil.GenerateMirrorURLs(normalizedURL, mod.Domains)
			for _, mirrorURL := range mirrorInfo.Mirrors {
				if mirrorURL == normalizedURL {
					continue // already checked in tier 1
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

	// Tier 3: Path-signature match (domain-agnostic).
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

// checkGalleryDuplicate implements the 3-tier dedup for the galleries
// table: exact (normalized URL) → mirror → path-signature. Returns a
// 409 response map if a duplicate is found, or nil if no duplicate exists.
//
// Ported from TS: src/lib/utils/task-dedup.ts → checkGalleryDuplicate()
func (h *Handlers) checkGalleryDuplicate(r *http.Request, normalizedURL, rawURL string) map[string]any {
	ctx := r.Context()

	// Tier 1: Exact match on normalized URL.
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

	// Tier 2: Mirror-domain match.
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
	// Strip person/model name prefix from title for display.
	t.Title = StripPersonFromTitle(t.Title, t.Person)
	// Populate computed fields for frontend consumption.
	t.EffectiveStatus = computeEffectiveStatus(t.Status, "video", 0, 0)
	t.ProgressStage = computeProgressStage(t.Status, "video", t.Progress)
	t.AllowedActions = computeAllowedActions(t.Status, "video")
	writeJSON(w, http.StatusOK, t)
}

// TaskAction handles start/pause/resume/cancel/retry operations
// on download tasks. Start and retry are now routed through the DAG
// orchestrator for proper slot pool concurrency control, replacing
// the legacy direct DownloadManager invocation that bypassed all
// scheduling and resource limits.
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
		// Route through DAG for slot pool concurrency control.
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.startFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "queued"})

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
		// Legacy fallback for tasks without DAG (e.g., pre-DAG tasks).
		h.DownloadMgr.CancelDownload(id)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})

	case "retry":
		if h.DagOrch == nil && h.DownloadMgr == nil {
			writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.tasks.schedulerRequired"))
			return
		}

		// ── Clean up cached files from the previous attempt ──
		// Retry must start from a clean slate: delete the old MP4 output
		// and the segments directory so stale/corrupt files don't cause
		// the re-download to skip segments or fail at merge/transcode.
		h.cleanupVideoTaskCache(r.Context(), id)

		// Use RetryDag to reuse the existing DAG rather than CancelDag +
		// SubmitDag, which creates a new DAG and has a race window between
		// cancel and re-submit. RetryDag resets retry counts and
		// re-transitions Failed/Timeout/NeedsRetry nodes to Ready within
		// the same DAG instance, eliminating the race and preventing
		// duplicate DAGs (§4 Service Layer: "do not create duplicate DAGs").
		dagID := h.getTaskDagID(r.Context(), id)
		if h.DagOrch != nil && dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			if err := h.DagOrch.RetryDag(r.Context(), dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})
			return
		}
		// No active DAG found: fall back to creating a fresh DAG via
		// submitVideoDag (first-time start or DAG was already cleaned up).
		if h.DownloadMgr != nil {
			h.DownloadMgr.CancelDownload(id)
		}
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
			return
		}
		// Store the new DAG ID for future lookups.
		h.updateTaskDagID(r.Context(), id, dagID)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

// submitVideoDag builds a video download DAG via the centralized
// DagFactory and submits it to the orchestrator.
func (h *Handlers) submitVideoDag(r *http.Request, taskID int) (string, error) {
	if h.DagOrch == nil {
		return "", fmt.Errorf("DAG orchestrator not available")
	}

	def := dag.NewDagFactory().NewVideoPipeline(taskID)
	return h.DagOrch.SubmitDag(r.Context(), def)
}

// cleanupVideoTaskCache deletes all cached files from a previous download
// attempt so a retry starts from a clean slate. Removes:
//   - The segments directory: data/segments/task_{id}/
//   - The output MP4 file pointed to by file_path
//
// Also resets progress-related DB fields (progress, completed_segments,
// total_segments, error_msg, m3u8_url) so the frontend doesn't show
// stale data from the failed attempt.
func (h *Handlers) cleanupVideoTaskCache(ctx context.Context, taskID int) {
	// 1. Read file_path from DB before deleting (for MP4 cleanup).
	var filePath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", taskID).Scan(&filePath)

	// 2. Delete the output MP4 file.
	if filePath != "" {
		_ = os.Remove(filePath)
	}

	// 3. Delete the segments directory: data/segments/task_{id}/
	segmentsDir := filepath.Join("..", "data", "segments", fmt.Sprintf("task_%d", taskID))
	_ = os.RemoveAll(segmentsDir)

	// 4. Reset progress-related DB fields so stale data doesn't leak
	// into the retry attempt's SSE events.
	_, _ = h.DB.Exec(ctx,
		`UPDATE download_tasks
		 SET progress = 0, completed_segments = 0, total_segments = 0,
		     error_msg = '', m3u8_url = '', updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`, taskID)
}

// FixGalleries is a temporary admin endpoint that resets failed/scraping
// gallery statuses back to 'completed'. Used for recovery after bulk
// retry attempts where the DAG resume pipeline failed due to missing files.
func (h *Handlers) FixGalleries(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	ctx := r.Context()

	rows, err := h.DB.Query(ctx,
		"SELECT id FROM galleries WHERE status IN ('failed', 'scraping')")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("query failed: %v", err))
		return
	}
	var affectedIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		affectedIDs = append(affectedIDs, id)
	}
	rows.Close()

	result, err := h.DB.Exec(ctx,
		"UPDATE galleries SET status = 'completed', error_msg = '', updated_at = CURRENT_TIMESTAMP WHERE status IN ('failed', 'scraping')")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("update failed: %v", err))
		return
	}
	rowsAff, _ := result.RowsAffected()

	if h.EventBus != nil {
		for _, gid := range affectedIDs {
			h.EventBus.Emit("task:completed", map[string]any{
				"taskId":   gid,
				"taskType": "gallery",
				"status":   "completed",
			})
		}
	}

	var completed, failed, scraping int
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'completed'").Scan(&completed)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'failed'").Scan(&failed)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'scraping'").Scan(&scraping)

	writeJSON(w, http.StatusOK, map[string]any{
		"reset":     rowsAff,
		"completed": completed,
		"failed":    failed,
		"scraping":  scraping,
	})
}

// TaskDelete removes a download task from the database and cleans up
// local files (video file + segments directory).
func (h *Handlers) TaskDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	// Step 1: Read task info before deletion (for file cleanup).
	var filePath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", id).Scan(&filePath)

	// Step 2: Cancel any active DAG for this video task to stop ongoing downloads.
	if h.DagOrch != nil {
		dagID := h.getTaskDagID(r.Context(), id)
		if dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			_ = h.DagOrch.CancelDag(r.Context(), dagID)
		}
	}

	// Step 3: Delete from database.
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

	// Step 4: Clean up local files (best-effort, non-blocking).
	// Delete video file if it exists.
	if filePath != "" {
		_ = os.Remove(filePath)
	}
	// Delete segments directory: data/segments/task_{id}/
	segmentsDir := filepath.Join("..", "data", "segments", fmt.Sprintf("task_%d", id))
	_ = os.RemoveAll(segmentsDir)

	// Emit task:cancelled so SSE notifies clients
	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{
			"taskId":   id,
			"taskType": "video",
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}
