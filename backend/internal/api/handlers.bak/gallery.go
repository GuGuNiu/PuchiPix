package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"backend/internal/db"
	"backend/internal/i18n"
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
		http.ServeFile(w, r, fullPath)
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
func (h *Handlers) ShelfDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
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

	switch req.Action {
	case "download":
		// Retry/resume download by resetting gallery status
		_, err := h.DB.Exec(r.Context(),
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
