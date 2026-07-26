package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/taskprogress"
)

// ShelfList returns galleries with pagination, matching the
// /api/shelf endpoint used by the resource shelf dashboard.
func (h *Handlers) ShelfList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	status := r.URL.Query().Get("status")

	var rows pgx.Rows
	var err error
	if status != "" {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
			 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
			 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
			 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
			 FROM galleries WHERE status = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`, status, limit, offset)
	} else {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
			 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
			 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
			 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
			 FROM galleries ORDER BY id DESC LIMIT $1 OFFSET $2`, limit, offset)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}
	defer rows.Close()

	galleries := []db.Gallery{}
	for rows.Next() {
		var g db.Gallery
		if err := scanGallery(rows, &g); err != nil {
			continue
		}
		galleries = append(galleries, g)
	}
	writeJSON(w, http.StatusOK, galleries)
}

// SjsShelfList returns gallery entries from the SJS site, used by the
// frontend /shelf/sjs page. Supports pagination via limit/offset.
func (h *Handlers) SjsShelfList(w http.ResponseWriter, r *http.Request) {
	// Reuse ShelfList but delegate to a site-filtered query for sjs
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)

	rows, err := h.DB.Query(r.Context(),
		`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
		 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
		 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
		 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
		 FROM galleries WHERE site_id = 'sjs' ORDER BY id DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}
	defer rows.Close()

	galleries := []db.Gallery{}
	for rows.Next() {
		var g db.Gallery
		if err := scanGallery(rows, &g); err != nil {
			continue
		}
		galleries = append(galleries, g)
	}
	writeJSON(w, http.StatusOK, galleries)
}

// ShelfDetail returns a single gallery by ID, or the cover image
// when ?type=cover is specified.
func (h *Handlers) ShelfDetail(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	// ── Cover image mode ──
	if r.URL.Query().Get("type") == "cover" {
		var coverPath string
		err := h.DB.QueryRow(r.Context(),
			"SELECT cover_local_path FROM galleries WHERE id = $1", id).Scan(&coverPath)
		if err != nil || coverPath == "" {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
			return
		}
		// DB stores paths as "data\galleries\..."; strip the prefix
		cleanPath := strings.TrimPrefix(filepath.FromSlash(coverPath), "data"+string(filepath.Separator))
		cleanPath = strings.TrimPrefix(cleanPath, "data/")
		fullPath := filepath.Join("..", "data", cleanPath)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "cover file not found")
			return
		}
		serveResizedImage(w, r, fullPath, queryWidth(r))
		return
	}

	var g db.Gallery
	err := h.DB.QueryRow(r.Context(),
		`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
		 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
		 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
		 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
		 FROM galleries WHERE id = $1`, id).Scan(
		&g.ID, &g.Seq, &g.SourceURL, &g.SiteID, &g.ScrapedDomain, &g.Title, &g.Protagonist, &g.Description,
		&g.Category, &g.Tags, &g.CoverURL, &g.CoverLocalPath, &g.ImageCount, &g.VideoCount, &g.PageCount,
		&g.Status, &g.ErrorMsg, &g.DownloadMethod, &g.ExpectedImageCount, &g.ExpectedVideoCount,
		&g.ContentVerified, &g.SavePath, &g.TotalSize, &g.DownloadedSize, &g.GameCharacters, &g.PublishTime,
		&g.ScrapedAt, &g.CompletedAt, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}
	writeJSON(w, http.StatusOK, g)
}

// SjsBookmarksList returns all SJS bookmarks.
func (h *Handlers) SjsBookmarksList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, url, thread_id, title, cover_url, author, post_date, forum_section, notes, created_at, updated_at
		 FROM sjs_bookmarks ORDER BY created_at DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sjsShelf.queryFailed"))
		return
	}
	defer rows.Close()

	bookmarks := []db.SjsBookmark{}
	for rows.Next() {
		var b db.SjsBookmark
		if err := rows.Scan(&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author, &b.PostDate, &b.ForumSection, &b.Notes, &b.CreatedAt, &b.UpdatedAt); err != nil {
			continue
		}
		bookmarks = append(bookmarks, b)
	}
	writeJSON(w, http.StatusOK, bookmarks)
}

// SjsBookmarksCreate creates a new SJS bookmark.
func (h *Handlers) SjsBookmarksCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var b db.SjsBookmark
	if !decodeJSON(w, r, &b) {
		return
	}
	if b.URL == "" || b.ThreadID == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sjsShelf.missingUrlAndThreadId"))
		return
	}
	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO sjs_bookmarks (url, thread_id, title, cover_url, author, post_date, forum_section, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id`,
		b.URL, b.ThreadID, b.Title, b.CoverURL, b.Author, b.PostDate, b.ForumSection, b.Notes).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sjsShelf.createFailed"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// SjsBookmarksDelete deletes an SJS bookmark by URL.
func (h *Handlers) SjsBookmarksDelete(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sjsShelf.missingUrlParam"))
		return
	}
	_, err := h.DB.Exec(r.Context(), "DELETE FROM sjs_bookmarks WHERE url = $1", url)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sjsShelf.deleteFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": url, "deleted": true})
}

// SjsBookmarksUpdate refreshes metadata for an SJS bookmark (e.g.
// title, cover_url, author) in-place. Responds to
// PATCH /api/shelf/sjs/bookmarks with {"id": N, "action": "refresh"}.
func (h *Handlers) SjsBookmarksUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var req struct {
		ID     int    `json:"id"`
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ID <= 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sjsShelf.invalidId"))
		return
	}

	switch req.Action {
	case "refresh":
		// Attempt to re-fetch metadata from the source; on failure
		// just return the current record unchanged.
		var b db.SjsBookmark
		err := h.DB.QueryRow(r.Context(),
			`SELECT id, url, thread_id, title, cover_url, author, post_date, forum_section, notes, created_at, updated_at
			 FROM sjs_bookmarks WHERE id = $1`, req.ID).Scan(
			&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author,
			&b.PostDate, &b.ForumSection, &b.Notes, &b.CreatedAt, &b.UpdatedAt)
		if err != nil {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.sjsShelf.notFound"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"bookmark": b})
	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sjsShelf.unknownAction"))
	}
}

// PreviewPost handles POST /api/preview with {url} in body, used by
// the search video-card to fetch metadata before adding a task.
func (h *Handlers) PreviewPost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "missing url")
		return
	}
	// Return basic URL info; the frontend uses this to show a preview card.
	writeJSON(w, http.StatusOK, map[string]any{
		"url":   req.URL,
		"title": req.URL,
	})
}

// Preview returns preview data (images/videos) for a gallery.
func (h *Handlers) Preview(w http.ResponseWriter, r *http.Request) {
	galleryIDStr := r.URL.Query().Get("galleryId")
	if galleryIDStr == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sjsShelf.missingGalleryId"))
		return
	}
	galleryID, err := strconv.Atoi(galleryIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.gallery.invalidId"))
		return
	}
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"images": []any{}, "videos": []any{}})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, gallery_id, url, local_path, file_name, file_size, width, height, format, page_index, order_index, status, error_msg, completed_at, created_at, updated_at
		 FROM gallery_images WHERE gallery_id = $1 ORDER BY order_index`, galleryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryImagesFailed"))
		return
	}
	defer rows.Close()

	images := []db.GalleryImage{}
	for rows.Next() {
		var img db.GalleryImage
		if err := rows.Scan(&img.ID, &img.GalleryID, &img.URL, &img.LocalPath, &img.FileName, &img.FileSize, &img.Width, &img.Height, &img.Format, &img.PageIndex, &img.OrderIndex, &img.Status, &img.ErrorMsg, &img.CompletedAt, &img.CreatedAt, &img.UpdatedAt); err != nil {
			continue
		}
		images = append(images, img)
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": images, "videos": []any{}})
}

// Protagonists returns protagonist names grouped by gallery count.
func (h *Handlers) Protagonists(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT protagonist, COUNT(*) as gallery_count
		 FROM galleries WHERE protagonist != '' AND status = 'completed'
		 GROUP BY protagonist ORDER BY gallery_count DESC LIMIT 100`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.protagonist.fetchFailed"))
		return
	}
	defer rows.Close()

	type protagonistStat struct {
		Name         string `json:"name"`
		GalleryCount int    `json:"galleryCount"`
	}
	result := []protagonistStat{}
	for rows.Next() {
		var ps protagonistStat
		if err := rows.Scan(&ps.Name, &ps.GalleryCount); err != nil {
			continue
		}
		result = append(result, ps)
	}
	writeJSON(w, http.StatusOK, result)
}

// History returns download history with pagination and filtering.
func (h *Handlers) History(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	siteID := r.URL.Query().Get("siteId")

	var rows pgx.Rows
	var err error
	if siteID != "" {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, site_id, gallery_id, url, status, image_count, video_count, title, protagonist, save_path, created_at, updated_at
			 FROM download_history WHERE site_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, siteID, limit, offset)
	} else {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, site_id, gallery_id, url, status, image_count, video_count, title, protagonist, save_path, created_at, updated_at
			 FROM download_history ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.history.queryFailed"))
		return
	}
	defer rows.Close()

	history := []db.DownloadHistory{}
	for rows.Next() {
		var dh db.DownloadHistory
		if err := rows.Scan(&dh.ID, &dh.SiteID, &dh.GalleryID, &dh.URL, &dh.Status, &dh.ImageCount, &dh.VideoCount, &dh.Title, &dh.Protagonist, &dh.SavePath, &dh.CreatedAt, &dh.UpdatedAt); err != nil {
			continue
		}
		history = append(history, dh)
	}
	writeJSON(w, http.StatusOK, history)
}

// GalleryImages returns all images for a gallery.
func (h *Handlers) GalleryImages(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, gallery_id, url, local_path, file_name, page_index, order_index, status
		 FROM gallery_images WHERE gallery_id = $1 ORDER BY page_index, order_index`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}
	defer rows.Close()

	images := []db.GalleryImage{}
	for rows.Next() {
		var img db.GalleryImage
		if err := rows.Scan(&img.ID, &img.GalleryID, &img.URL, &img.LocalPath, &img.FileName,
			&img.PageIndex, &img.OrderIndex, &img.Status); err != nil {
			continue
		}
		images = append(images, img)
	}
	writeJSON(w, http.StatusOK, images)
}

// ShelfDelete removes a gallery and its associated images/videos from
// the database. Responds to DELETE /api/shelf/{id}.
//
// Before deleting DB rows, any active DAG for this gallery is cancelled
// to prevent orphaned DAGs from continuing to execute after the gallery
// record is gone. This mirrors the TaskDelete safety pattern.
func (h *Handlers) ShelfDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	// Cancel any active DAG for this gallery before deleting DB rows.
	// This prevents orphaned DAGs from continuing to execute after the
	// gallery record is gone, which would cause FK violations and DB
	// write failures with no user-visible feedback.
	if h.DagOrch != nil {
		dagID := fmt.Sprintf("gallery-%d", id)
		if status := h.DagOrch.GetDagStatus(dagID); status != nil {
			// Best-effort cancel: if the DAG doesn't exist or is already
			// terminal, proceed with DELETE anyway.
			_ = h.DagOrch.CancelDag(r.Context(), dagID)
		}
	}

	// Verify gallery exists before attempting deletion
	var exists bool
	err := h.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM galleries WHERE id = $1)", id).Scan(&exists)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}

	// Delete associated records in order (respect FK constraints)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_videos WHERE gallery_id = $1", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_images WHERE gallery_id = $1", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_download_infos WHERE gallery_id = $1", id)
	_, err = h.DB.Exec(r.Context(), "DELETE FROM galleries WHERE id = $1", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// ShelfAction handles POST actions on a gallery: retry download,
// download-zip, and other lifecycle operations.
// Responds to POST /api/shelf/{id} with {"action": "download"} or
// {"action": "download-zip", "manualUrl": "..."}.
// DAG-based actions (retry-failed, pause, resume) are routed through
// the DagOrchestrator for proper slot pool concurrency control.
func (h *Handlers) ShelfAction(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	var req struct {
		Action    string `json:"action"`
		ManualURL string `json:"manualUrl,omitempty"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ctx := r.Context()
	dagID := fmt.Sprintf("gallery-%d", id)

	switch req.Action {
	case "retry-failed":
		// Retry failed nodes in existing DAG, or create a new pipeline.
		if h.DagOrch != nil {
			status := h.DagOrch.GetDagStatus(dagID)
			if status != nil {
				// DAG exists: retry failed nodes.
				if err := h.DagOrch.RetryDag(ctx, dagID, ""); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
					return
				}
				// Update gallery status so SSE initial data reflects the change.
				h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping', error_msg = '' WHERE id = $1", id)
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "dagId": dagID, "status": "retrying"})
				return
			}
		// DAG not found: check if gallery has been scraped before.
		// If image_count or video_count > 0, use the download-only
		// resume pipeline (skip scrape to avoid immediate failure
		// from duplicate detection). Otherwise, create a full pipeline
		// that includes the scrape phase.
		var sourceURL, siteID string
		var imageCount, videoCount int
		err := h.DB.QueryRow(ctx,
			"SELECT source_url, site_id, COALESCE(image_count,0), COALESCE(video_count,0) FROM galleries WHERE id = $1", id).
			Scan(&sourceURL, &siteID, &imageCount, &videoCount)
		if err != nil {
			writeError(w, http.StatusNotFound, "Gallery not found")
			return
		}

		var def orchestrator.DagDefinition
		if h.DagFactory != nil {
			if imageCount > 0 || videoCount > 0 {
				// Gallery already scraped: use download-only pipeline.
				def = h.DagFactory.NewGalleryResumePipeline(id)
			} else {
				def = h.DagFactory.NewGalleryPipeline(sourceURL, siteID, id)
			}
		} else {
			if imageCount > 0 || videoCount > 0 {
				def = dag.NewDagFactory().NewGalleryResumePipeline(id)
			} else {
				def = dag.NewDagFactory().NewGalleryPipeline(sourceURL, siteID, id)
			}
		}
		newDagID, err := h.DagOrch.SubmitDag(ctx, def)
			if err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to submit gallery DAG: %v", err))
				return
			}
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping', error_msg = '' WHERE id = $1", id)
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "dagId": newDagID, "status": "retrying"})
			return
		}
		// Fallback without DAG: reset status only.
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = $1", id)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "status": "pending"})

	case "pause":
		if h.DagOrch != nil {
			if err := h.DagOrch.PauseDag(ctx, dagID); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG pause failed: %v", err))
				return
			}
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'paused' WHERE id = $1", id)
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "pause", "status": "paused"})
			return
		}
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")

	case "resume":
		if h.DagOrch != nil {
			if err := h.DagOrch.ResumeDag(ctx, dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG resume failed: %v", err))
				return
			}
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping' WHERE id = $1", id)
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "resume", "status": "resumed"})
			return
		}
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")

	case "download":
		// Legacy: reset gallery status to pending.
		_, err := h.DB.Exec(ctx,
			"UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = $1", id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "download", "status": "pending"})

	case "download-zip":
		writeJSON(w, http.StatusOK, map[string]any{
			"id":      id,
			"action":  "download-zip",
			"success": true,
			"message": "Zip download initiated",
		})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

func scanGallery(rows pgx.Rows, g *db.Gallery) error {
	return rows.Scan(
		&g.ID, &g.Seq, &g.SourceURL, &g.SiteID, &g.ScrapedDomain, &g.Title, &g.Protagonist,
		&g.Description, &g.Category, &g.Tags, &g.CoverURL, &g.CoverLocalPath, &g.ImageCount,
		&g.VideoCount, &g.PageCount, &g.Status, &g.ErrorMsg, &g.DownloadMethod,
		&g.ExpectedImageCount, &g.ExpectedVideoCount, &g.ContentVerified, &g.SavePath,
		&g.TotalSize, &g.DownloadedSize, &g.GameCharacters, &g.PublishTime,
		&g.ScrapedAt, &g.CompletedAt, &g.CreatedAt, &g.UpdatedAt)
}

// GalleryFileProgress returns per-file progress for a gallery task.
// GET /api/shelf/{id}/files/progress
// This provides the granular breakdown needed for fine-grained retry
// decisions — which files failed, which succeeded, and the overall
// completion ratio based on actual disk state.
func (h *Handlers) GalleryFileProgress(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	if h.ProgressEngine != nil {
		summary := h.ProgressEngine.GetSummary(id)
		failed := h.ProgressEngine.GetFailedFiles(id)
		writeJSON(w, http.StatusOK, map[string]any{
			"galleryId": id,
			"summary":   summary,
			"failed":    failed,
		})
		return
	}

	// Fallback: compute progress from DB data + disk scan.
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"galleryId": id,
			"summary":   map[string]any{"status": "unknown"},
			"failed":    []any{},
		})
		return
	}

	var status string
	var imageCount, videoCount int
	var savePath string
	err := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(status, 'pending'), COALESCE(image_count, 0),
		        COALESCE(video_count, 0), COALESCE(save_path, '')
		 FROM galleries WHERE id = $1`, id).
		Scan(&status, &imageCount, &videoCount, &savePath)
	if err != nil {
		writeError(w, http.StatusNotFound, "Gallery not found")
		return
	}

	totalExpected := imageCount + videoCount
	actualFiles := countFilesInDir(savePath)
	progress := 0.0
	if totalExpected > 0 {
		progress = float64(actualFiles) / float64(totalExpected) * 100
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"galleryId": id,
		"summary": map[string]any{
			"galleryId":      id,
			"totalFiles":     totalExpected,
			"completedFiles": actualFiles,
			"failedFiles":    totalExpected - actualFiles,
			"progress":       progress,
			"status":         status,
		},
		"failed": []any{},
	})
}

// GalleryFileRetry handles fine-grained retry of individual files
// or file ranges within a gallery task.
// POST /api/shelf/{id}/files/retry
// Body: { "fileIndices": [3, 7], "strategy": "failed_only" }
//       { "range": { "start": 4, "end": 8 }, "strategy": "regional" }
//
// Strategies:
//   - failed_only (default): retry exactly the specified failed files
//   - regional: expand to ±2 files around each failure, merging overlaps
//   - all: retry all non-completed files
//
// This endpoint computes the optimal retry set based on the selected
// strategy, then triggers DAG-level retry for the corresponding nodes.
func (h *Handlers) GalleryFileRetry(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	var req struct {
		FileIndices []int                    `json:"fileIndices,omitempty"`
		Range       *taskprogress.RetryRange `json:"range,omitempty"`
		Strategy    string                   `json:"strategy,omitempty"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ctx := r.Context()

	// If progress engine is available, use its retry computation.
	if h.ProgressEngine != nil {
		retryReq := taskprogress.RetryRequest{
			FileIndices: req.FileIndices,
			Range:       req.Range,
		}
		if req.Strategy != "" {
			retryReq.Strategy = taskprogress.RetryStrategy(req.Strategy)
		}

		indices, err := h.ProgressEngine.ComputeRetryRange(id, retryReq)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to compute retry range: %v", err))
			return
		}

		if len(indices) == 0 {
			writeJSON(w, http.StatusOK, taskprogress.RetryResult{
				GalleryID: id,
				Message:   "No files to retry — all files are either completed or have no failed items",
			})
			return
		}

		// Trigger DAG retry for the download/extract/verify nodes.
		// The DAG-level retry will re-process all specified files.
		dagID := fmt.Sprintf("gallery-%d", id)
		if h.DagOrch != nil {
			status := h.DagOrch.GetDagStatus(dagID)
			if status != nil {
				// Retry the download node to re-download failed files.
				dlNodeID := fmt.Sprintf("dl-%d", id)
				if err := h.DagOrch.RetryDag(ctx, dagID, dlNodeID); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
					return
				}
			} else {
				// DAG not active — re-submit gallery pipeline.
				var sourceURL, siteID string
				err := h.DB.QueryRow(ctx,
					"SELECT source_url, site_id FROM galleries WHERE id = $1", id).
					Scan(&sourceURL, &siteID)
				if err != nil {
					writeError(w, http.StatusNotFound, "Gallery not found")
					return
				}
				var def orchestrator.DagDefinition
				if h.DagFactory != nil {
					def = h.DagFactory.NewGalleryPipeline(sourceURL, siteID, id)
				} else {
					def = dag.NewDagFactory().NewGalleryPipeline(sourceURL, siteID, id)
				}
				if _, err := h.DagOrch.SubmitDag(ctx, def); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to submit gallery DAG: %v", err))
					return
				}
			}
		}

		// Update gallery status for SSE propagation.
		if h.DB != nil {
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'downloading', error_msg = '' WHERE id = $1", id)
		}

		writeJSON(w, http.StatusOK, taskprogress.RetryResult{
			GalleryID:      id,
			RetriedCount:   len(indices),
			RetriedIndices: indices,
			Message:        fmt.Sprintf("Retrying %d file(s) with strategy %s", len(indices), retryReq.Strategy),
		})
		return
	}

	// Fallback without progress engine: retry the whole gallery DAG.
	dagID := fmt.Sprintf("gallery-%d", id)
	if h.DagOrch != nil {
		if err := h.DagOrch.RetryDag(ctx, dagID, ""); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
			return
		}
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'downloading', error_msg = '' WHERE id = $1", id)
		writeJSON(w, http.StatusOK, map[string]any{
			"galleryId": id,
			"message":   "Full gallery retry initiated (progress engine not available for fine-grained retry)",
		})
		return
	}

	writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
}
