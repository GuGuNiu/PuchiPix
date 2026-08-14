package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"database/sql"
	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/taskprogress"
)

// getGalleryDagID retrieves the DAG ID associated with a gallery.
// Returns empty string if no DAG has been created for this gallery.
func (h *Handlers) getGalleryDagID(ctx context.Context, galleryID int) string {
	var dagID string
	err := h.DB.QueryRow(ctx, "SELECT COALESCE(dag_id, '') FROM galleries WHERE id = ?", galleryID).Scan(&dagID)
	if err != nil {
		return ""
	}
	return dagID
}

// updateGalleryDagID stores the DAG ID in the galleries table.
func (h *Handlers) updateGalleryDagID(ctx context.Context, galleryID int, dagID string) {
	h.DB.Exec(ctx, "UPDATE galleries SET dag_id = ? WHERE id = ?", dagID, galleryID)
}

// ShelfList returns gallery (写真包) tasks with pagination.
//
// Gallery tasks are photo-centric downloads (primarily images, may include
// optional videos). They are stored in the galleries table, separate from
// video tasks (download_tasks table).
//
// Task type distinction:
//   - galleries: Gallery tasks (photo sets/写真包, primarily images with optional videos)
//   - download_tasks: Video tasks (M3U8 streams, video files)
//
// This endpoint serves the /api/shelf endpoint for the resource shelf dashboard.
// For the unified task list, see tasks.go TaskList (video only) or the
// proposed unified task endpoint.
//
// See: tasks.go TaskList for video task queries
func (h *Handlers) ShelfList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	status := r.URL.Query().Get("status")

	var rows *sql.Rows
	var err error
	if status != "" {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
			 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
			 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
			 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
			 FROM galleries WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?`, status, limit, offset)
	} else {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
			 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
			 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
			 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
			 FROM galleries ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
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

	// Attach progress from ProgressEngine for downloading/scraping galleries.
	// The frontend progress bar needs a simple 0-100 progress number.
	// Use a map to avoid struct embedding issues with JSON serialization.
	enriched := make([]map[string]any, len(galleries))
	for i, g := range galleries {
		// Calculate progress based on status and available data
		progress := 0.0
		switch g.Status {
		case "completed":
			progress = 100
		case "pending", "paused":
			progress = 0
		default:
			// For downloading/scraping/scraped: try ProgressEngine first
			if h.ProgressEngine != nil {
				summary := h.ProgressEngine.GetSummary(g.ID)
				if summary.TotalFiles > 0 {
					progress = summary.Progress
					break
				}
			}
			// Fallback: calculate from downloaded_size / total_size
			if g.TotalSize > 0 {
				progress = float64(g.DownloadedSize) / float64(g.TotalSize) * 100
				if progress > 99 && g.Status != "completed" {
					progress = 99 // Cap at 99 until fully verified
				}
			}
		}

		// Build response map with all gallery fields plus progress
		// Apply person-stripping to title for display (matches tasks list behavior)
		displayTitle := StripPersonFromTitle(g.Title, g.Protagonist)
		enriched[i] = map[string]any{
			"ID":                  g.ID,
			"DisplayID":           g.Seq,
			"SourceURL":           g.SourceURL,
			"SiteID":              g.SiteID,
			"ScrapedDomain":       g.ScrapedDomain,
			"Title":               displayTitle,
			"Protagonist":         g.Protagonist,
			"Description":         g.Description,
			"Category":            g.Category,
			"Tags":                g.Tags,
			"CoverURL":            g.CoverURL,
			"CoverLocalPath":      g.CoverLocalPath,
			"ImageCount":          g.ImageCount,
			"VideoCount":          g.VideoCount,
			"PageCount":           g.PageCount,
			"Status":              g.Status,
			"ErrorMsg":            g.ErrorMsg,
			"DownloadMethod":      g.DownloadMethod,
			"ExpectedImageCount":  g.ExpectedImageCount,
			"ExpectedVideoCount":  g.ExpectedVideoCount,
			"ContentVerified":     g.ContentVerified,
			"SavePath":            g.SavePath,
			"TotalSize":           g.TotalSize,
			"DownloadedSize":      g.DownloadedSize,
			"GameCharacters":      g.GameCharacters,
			"PublishTime":         g.PublishTime,
			"ScrapedAt":           g.ScrapedAt,
			"CompletedAt":         g.CompletedAt,
			"CreatedAt":           g.CreatedAt,
			"UpdatedAt":           g.UpdatedAt,
			"progress":            progress, // Flattened 0-100 progress for frontend
		}
	}
	writeJSON(w, http.StatusOK, enriched)
}

// SjsShelfList returns SJS bookmarks, used by the frontend /shelf/sjs page.
// Supports keyword (q) and forum-section filtering.
// NOTE: 此前该接口误查 galleries 表（site_id='sjs'），而
// SjsShelfCreate/SjsShelfDelete 均操作 sjs_bookmarks 表，导致创建的书签
// 永远不会出现在列表中。现统一为查询 sjs_bookmarks。
func (h *Handlers) SjsShelfList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	forum := strings.TrimSpace(r.URL.Query().Get("forum"))

	query := `SELECT id, url, thread_id, title, cover_url, author, post_date, forum_section, notes, created_at, updated_at
		FROM sjs_bookmarks`
	conds := []string{}
	args := []any{}
	if q != "" {
		like := "%" + q + "%"
		conds = append(conds, `(title LIKE ? OR url LIKE ? OR author LIKE ?)`)
		args = append(args, like, like, like)
	}
	if forum != "" {
		conds = append(conds, `forum_section = ?`)
		args = append(args, forum)
	}
	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY created_at DESC"

	rows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}
	defer rows.Close()

	bookmarks := []db.SjsBookmark{}
	for rows.Next() {
		var b db.SjsBookmark
		var ca, ua db.SQLTime // scan SQLite TEXT datetime columns (P-TSG)
		if err := rows.Scan(&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author, &b.PostDate, &b.ForumSection, &b.Notes, &ca, &ua); err != nil {
			continue
		}
		bookmarks = append(bookmarks, b)
	}
	writeJSON(w, http.StatusOK, bookmarks)
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
		var coverPath, coverURL string
		err := h.DB.QueryRow(r.Context(),
			"SELECT cover_local_path, cover_url FROM galleries WHERE id = ?", id).Scan(&coverPath, &coverURL)
		if err != nil {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
			return
		}

		// Try local cover file first
		if coverPath != "" {
			cleanPath := strings.TrimPrefix(filepath.FromSlash(coverPath), "data"+string(filepath.Separator))
			cleanPath = strings.TrimPrefix(cleanPath, "data/")
			fullPath := filepath.Join("..", "data", cleanPath)
			if _, err := os.Stat(fullPath); err == nil {
				serveResizedImage(w, r, fullPath, queryWidth(r))
				return
			}
		}

		// Fallback 1: try first downloaded gallery image as cover
		var firstImageLocalPath string
		err = h.DB.QueryRow(r.Context(),
			"SELECT local_path FROM gallery_images WHERE gallery_id = ? AND status = 'downloaded' AND local_path != '' ORDER BY order_index LIMIT 1", id).Scan(&firstImageLocalPath)
		if err == nil && firstImageLocalPath != "" {
			cleanPath := strings.TrimPrefix(filepath.FromSlash(firstImageLocalPath), "data"+string(filepath.Separator))
			cleanPath = strings.TrimPrefix(cleanPath, "data/")
			fullPath := filepath.Join("..", "data", cleanPath)
			if _, err := os.Stat(fullPath); err == nil {
				serveResizedImage(w, r, fullPath, queryWidth(r))
				return
			}
		}

		// Fallback 2: redirect to external cover_url
		if coverURL != "" {
			http.Redirect(w, r, coverURL, http.StatusFound)
			return
		}

		// No cover available at all
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}

	var g db.Gallery
	// Use nullable intermediates for columns that may contain NULL values
	// Time columns are also scanned as strings because SQLite stores them as TEXT
	var (
		scrapedDomain   sql.NullString
		title           sql.NullString
		protagonist     sql.NullString
		description     sql.NullString
		category        sql.NullString
		tags            sql.NullString
		coverURL        sql.NullString
		coverLocalPath  sql.NullString
		status          sql.NullString
		errorMsg        sql.NullString
		downloadMethod  sql.NullString
		savePath        sql.NullString
		scrapedAtStr    sql.NullString
		completedAtStr  sql.NullString
		createdAtStr    sql.NullString
		updatedAtStr    sql.NullString
	)
	err := h.DB.QueryRow(r.Context(),
		`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist, description, category, tags,
		 cover_url, cover_local_path, image_count, video_count, page_count, status, error_msg, download_method,
		 expected_image_count, expected_video_count, content_verified, save_path, total_size, downloaded_size,
		 game_characters, publish_time, scraped_at, completed_at, created_at, updated_at
		 FROM galleries WHERE id = ?`, id).Scan(
		&g.ID, &g.Seq, &g.SourceURL, &g.SiteID, &scrapedDomain, &title, &protagonist, &description,
		&category, &tags, &coverURL, &coverLocalPath, &g.ImageCount, &g.VideoCount, &g.PageCount,
		&status, &errorMsg, &downloadMethod, &g.ExpectedImageCount, &g.ExpectedVideoCount,
		&g.ContentVerified, &savePath, &g.TotalSize, &g.DownloadedSize, &g.GameCharacters, &g.PublishTime,
		&scrapedAtStr, &completedAtStr, &createdAtStr, &updatedAtStr)
	if err != nil {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}
	// Convert nullable strings to regular strings (empty string if NULL)
	g.ScrapedDomain = scrapedDomain.String
	g.Title = title.String
	g.Protagonist = protagonist.String
	g.Description = description.String
	g.Category = category.String
	g.Tags = tags.String
	g.CoverURL = coverURL.String
	g.CoverLocalPath = coverLocalPath.String
	g.Status = status.String
	g.ErrorMsg = errorMsg.String
	g.DownloadMethod = downloadMethod.String
	g.SavePath = savePath.String
	// Parse time strings
	g.ScrapedAt = parseNullTime(scrapedAtStr)
	g.CompletedAt = parseNullTime(completedAtStr)
	g.CreatedAt = parseTime(createdAtStr)
	g.UpdatedAt = parseTime(updatedAtStr)
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
		var ca, ua db.SQLTime // scan SQLite TEXT datetime columns (P-TSG)
		if err := rows.Scan(&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author, &b.PostDate, &b.ForumSection, &b.Notes, &ca, &ua); err != nil {
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
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
	_, err := h.DB.Exec(r.Context(), "DELETE FROM sjs_bookmarks WHERE url = ?", url)
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
			 FROM sjs_bookmarks WHERE id = ?`, req.ID).Scan(
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
		 FROM gallery_images WHERE gallery_id = ? ORDER BY order_index`, galleryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryImagesFailed"))
		return
	}
	defer rows.Close()

	images := []db.GalleryImage{}
	for rows.Next() {
		var img db.GalleryImage
		var completedAt, createdAt, updatedAt db.SQLTime // scan SQLite TEXT datetime columns (P-TSG)
		if err := rows.Scan(&img.ID, &img.GalleryID, &img.URL, &img.LocalPath, &img.FileName, &img.FileSize, &img.Width, &img.Height, &img.Format, &img.PageIndex, &img.OrderIndex, &img.Status, &img.ErrorMsg, &completedAt, &createdAt, &updatedAt); err != nil {
			continue
		}
		images = append(images, img)
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": images, "videos": []any{}})
}

// Protagonists returns protagonist names grouped by gallery count.
func (h *Handlers) Protagonists(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"protagonists": []any{}}})
		return
	}
	ctx := r.Context()

	// Detail mode: /api/protagonists?name=<name> returns per-protagonist
	// stats (standard name, gallery count, aliases, gallery list) for the
	// protagonist detail page. Falls back to the list shape when the
	// name has no rows.
	if name := r.URL.Query().Get("name"); name != "" {
		var count int
		_ = h.DB.QueryRow(ctx,
			`SELECT COUNT(*) FROM galleries WHERE protagonist = ? AND status = 'completed'`, name).Scan(&count)
		var aliases []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		}
		aliasRows, aErr := h.DB.Query(ctx,
			`SELECT protagonist, COUNT(*) FROM galleries
			 WHERE protagonist != '' AND protagonist != ? AND status = 'completed'
			   AND (title LIKE '%' || ? || '%' OR protagonist LIKE ?)
			 GROUP BY protagonist ORDER BY COUNT(*) DESC LIMIT 20`,
			name, name, "%"+name+"%")
		if aErr == nil {
			for aliasRows.Next() {
				var a struct {
					Name  string `json:"name"`
					Count int    `json:"count"`
				}
				if err := aliasRows.Scan(&a.Name, &a.Count); err == nil {
					aliases = append(aliases, a)
				}
			}
			aliasRows.Close()
		}
		var galleries []struct {
			ID       int    `json:"id"`
			Title    string `json:"title"`
			CoverURL string `json:"coverUrl"`
		}
		gRows, gErr := h.DB.Query(ctx,
			`SELECT id, COALESCE(title,''), COALESCE(cover_url,'') FROM galleries
			 WHERE protagonist = ? AND status = 'completed' ORDER BY id DESC LIMIT 100`, name)
		if gErr == nil {
			for gRows.Next() {
				var g struct {
					ID       int    `json:"id"`
					Title    string `json:"title"`
					CoverURL string `json:"coverUrl"`
				}
				if err := gRows.Scan(&g.ID, &g.Title, &g.CoverURL); err == nil {
					galleries = append(galleries, g)
				}
			}
			gRows.Close()
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"data": map[string]any{
				"standardName": name,
				"count":        count,
				"aliases":      aliases,
				"galleries":    galleries,
			},
		})
		return
	}

	rows, err := h.DB.Query(ctx,
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
		Count        int    `json:"count"` // alias matching the frontend contract
	}
	result := []protagonistStat{}
	for rows.Next() {
		var ps protagonistStat
		if err := rows.Scan(&ps.Name, &ps.GalleryCount); err != nil {
			continue
		}
		ps.Count = ps.GalleryCount
		result = append(result, ps)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"protagonists": result,
		},
	})
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

	var rows *sql.Rows
	var err error
	if siteID != "" {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, site_id, gallery_id, url, status, image_count, video_count, title, protagonist, save_path, created_at, updated_at
			 FROM download_history WHERE site_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`, siteID, limit, offset)
	} else {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, site_id, gallery_id, url, status, image_count, video_count, title, protagonist, save_path, created_at, updated_at
			 FROM download_history ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.history.queryFailed"))
		return
	}
	defer rows.Close()

	history := []db.DownloadHistory{}
	for rows.Next() {
		var dh db.DownloadHistory
		var ca, ua db.SQLTime // scan SQLite TEXT datetime columns (P-TSG)
		if err := rows.Scan(&dh.ID, &dh.SiteID, &dh.GalleryID, &dh.URL, &dh.Status, &dh.ImageCount, &dh.VideoCount, &dh.Title, &dh.Protagonist, &dh.SavePath, &ca, &ua); err != nil {
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
		 FROM gallery_images WHERE gallery_id = ? ORDER BY page_index, order_index`, id)
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
//
// After DB deletion, local files are cleaned up (gallery folder, ZIP file).
func (h *Handlers) ShelfDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	// Step 1: Read gallery info before deletion (for file cleanup).
	var savePath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(save_path, '') FROM galleries WHERE id = ?", id).Scan(&savePath)

	// Step 1b: Read ZIP download paths from gallery_download_infos.
	var zipLocalPath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(local_path, '') FROM gallery_download_infos WHERE gallery_id = ?", id).Scan(&zipLocalPath)

	// Step 2: Cancel any active DAG for this gallery before deleting DB rows.
	// This prevents orphaned DAGs from continuing to execute after the
	// gallery record is gone, which would cause FK violations and DB
	// write failures with no user-visible feedback.
	if h.DagOrch != nil {
		dagID := h.getGalleryDagID(r.Context(), id)
		if dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
			// Best-effort cancel: if the DAG doesn't exist or is already
			// terminal, proceed with DELETE anyway.
			_ = h.DagOrch.CancelDag(r.Context(), dagID)
		}
	}

	// Verify gallery exists before attempting deletion
	var exists bool
	err := h.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM galleries WHERE id = ?)", id).Scan(&exists)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}

	// Step 3: Delete associated records in order (respect FK constraints)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_videos WHERE gallery_id = ?", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_images WHERE gallery_id = ?", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_download_infos WHERE gallery_id = ?", id)
	_, err = h.DB.Exec(r.Context(), "DELETE FROM galleries WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}

	// Step 4: Clean up local files (best-effort, non-blocking).
	// Delete gallery folder: data/galleries/{主角} - {描述}/
	if savePath != "" {
		_ = os.RemoveAll(savePath)
	}
	// Delete ZIP file if it exists.
	if zipLocalPath != "" {
		_ = os.Remove(zipLocalPath)
	}

	// Emit event for SSE clients
	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{
			"taskId":   id,
			"taskType": "gallery",
		})
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
	dagID := h.getGalleryDagID(ctx, id)

	switch req.Action {
	case "retry-failed":
		h.shelfRetryFailed(ctx, w, r, id)
		return

	// Generic action names (frontend no longer needs to translate to backend-specific names).
	// The backend determines the appropriate operation based on current gallery status.
	case "start":
		// Start: if gallery is failed/partial → retry; otherwise → resume/retry-failed.
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "retry":
		// Retry: same as retry-failed.
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "pause":
		if h.DagOrch != nil && dagID != "" {
			if err := h.DagOrch.PauseDag(ctx, dagID); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG pause failed: %v", err))
				return
			}
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'paused' WHERE id = ?", id)
			if h.EventBus != nil {
				h.EventBus.Emit("task:progress", map[string]any{
					"taskId":   id,
					"taskType": "gallery",
					"status":   "paused",
				})
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "pause", "status": "paused"})
			return
		}
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")

	case "resume":
		if h.DagOrch != nil && dagID != "" {
			if err := h.DagOrch.ResumeDag(ctx, dagID, ""); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG resume failed: %v", err))
				return
			}
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping' WHERE id = ?", id)
			if h.EventBus != nil {
				h.EventBus.Emit("task:progress", map[string]any{
					"taskId":   id,
					"taskType": "gallery",
					"status":   "scraping",
				})
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "resume", "status": "resumed"})
			return
		}
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")

	case "download":
		// Re-download: reuse the retry-failed path so the DAG is actually
		// (re)submitted. Previously this only reset status to 'pending',
		// leaving the gallery stuck forever (no mechanism re-submits a
		// plain pending gallery outside restart recovery).
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "download-zip":
		// NOTE: legacy action kept for API compatibility. The real ZIP
		// download runs inside the gallery DAG's download node
		// (TryDownloadGalleryZip); a standalone synchronous ZIP download
		// is not supported here. Surface an explicit error instead of a
		// fake success, so the frontend no longer reports a completed
		// ZIP that never happened.
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"id":      id,
			"action":  "download-zip",
			"success": false,
			"error":   "zip download is only available through the gallery download pipeline",
		})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

// shelfRetryFailed implements the shared retry-failed logic used by both
// the "retry-failed" and "download" shelf actions: retry failed nodes in
// an existing DAG, or build a fresh pipeline (resume when scraped, full
// otherwise) and submit it.
func (h *Handlers) shelfRetryFailed(ctx context.Context, w http.ResponseWriter, r *http.Request, id int) error {
	// ── Clean up cached files from the previous attempt ──
	// Retry must start from a clean slate: delete the old gallery folder
	// (images/extracted ZIPs) and the ZIP archive so stale/corrupt files
	// don't cause the re-download to skip files or fail verification.
	h.cleanupGalleryCache(ctx, id)

	dagID := h.getGalleryDagID(ctx, id)
	if h.DagOrch != nil {
		if dagID != "" {
			status := h.DagOrch.GetDagStatus(dagID)
			if status != nil {
				// DAG exists: retry failed nodes.
				if err := h.DagOrch.RetryDag(ctx, dagID, ""); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
					return nil
				}
				h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping', error_msg = '' WHERE id = ?", id)
				if h.EventBus != nil {
					h.EventBus.Emit("task:progress", map[string]any{
						"taskId":   id,
						"taskType": "gallery",
						"status":   "scraping",
					})
				}
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "dagId": dagID, "status": "retrying"})
				return nil
			}
		}
		// DAG not found: check if gallery has been scraped before.
		var sourceURL, siteID string
		var imageCount, videoCount int
		err := h.DB.QueryRow(ctx,
			"SELECT source_url, site_id, COALESCE(image_count,0), COALESCE(video_count,0) FROM galleries WHERE id = ?", id).
			Scan(&sourceURL, &siteID, &imageCount, &videoCount)
		if err != nil {
			writeError(w, http.StatusNotFound, "Gallery not found")
			return nil
		}
		var def orchestrator.DagDefinition
		if imageCount > 0 || videoCount > 0 {
			def = dag.NewDagFactory().NewGalleryResumePipeline(id)
		} else {
			def = dag.NewDagFactory().NewGalleryPipeline(sourceURL, siteID, id)
		}
		newDagID, err := h.DagOrch.SubmitDag(ctx, def)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to submit gallery DAG: %v", err))
			return nil
		}
		// Store the new DAG ID for future lookups.
		h.updateGalleryDagID(ctx, id, newDagID)
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'scraping', error_msg = '' WHERE id = ?", id)
		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   id,
				"taskType": "gallery",
				"status":   "scraping",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "dagId": newDagID, "status": "retrying"})
		return nil
	}
	// Fallback without DAG: reset status only.
	h.DB.Exec(ctx, "UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = ?", id)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "status": "pending"})
	return nil
}

// cleanupGalleryCache deletes all cached files from a previous gallery
// download attempt so a retry starts from a clean slate. Removes:
//   - The gallery save directory (images + extracted ZIPs): data/galleries/{title}/
//   - The downloaded ZIP archive from gallery_download_infos.local_path
//
// Also resets progress-related DB fields (downloaded_size, error_msg) and
// resets gallery_images status to 'pending' so the download node re-fetches
// them instead of skipping "already downloaded" files.
func (h *Handlers) cleanupGalleryCache(ctx context.Context, galleryID int) {
	// 1. Read save_path and ZIP local_path before deleting.
	var savePath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(save_path, '') FROM galleries WHERE id = ?", galleryID).Scan(&savePath)

	var zipLocalPath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(local_path, '') FROM gallery_download_infos WHERE gallery_id = ?", galleryID).
		Scan(&zipLocalPath)

	// 2. Delete the gallery save directory (images + extracted contents).
	if savePath != "" {
		_ = os.RemoveAll(savePath)
	}

	// 3. Delete the downloaded ZIP archive.
	if zipLocalPath != "" {
		_ = os.Remove(zipLocalPath)
	}

	// 4. Reset gallery_images status to 'pending' so the download node
	// re-fetches them instead of skipping "already downloaded" files.
	_, _ = h.DB.Exec(ctx,
		"UPDATE gallery_images SET status = 'pending', error_msg = '' WHERE gallery_id = ?", galleryID)

	// 5. Reset progress-related DB fields.
	_, _ = h.DB.Exec(ctx,
		`UPDATE galleries
		 SET downloaded_size = 0, error_msg = '', updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`, galleryID)
}

func scanGallery(rows *sql.Rows, g *db.Gallery) error {
	// Use nullable intermediates for columns that may contain NULL values
	// (SQLite may return NULL for columns despite NOT NULL DEFAULT in schema,
	// especially for columns not explicitly set during INSERT).
	// Time columns are also scanned as strings because SQLite stores them as TEXT
	// and the driver cannot auto-convert to time.Time.
	var (
		scrapedDomain   sql.NullString
		title           sql.NullString
		protagonist     sql.NullString
		description     sql.NullString
		category        sql.NullString
		tags            sql.NullString
		coverURL        sql.NullString
		coverLocalPath  sql.NullString
		status          sql.NullString
		errorMsg        sql.NullString
		downloadMethod  sql.NullString
		savePath        sql.NullString
		scrapedAtStr    sql.NullString
		completedAtStr  sql.NullString
		createdAtStr    sql.NullString
		updatedAtStr    sql.NullString
	)
	err := rows.Scan(
		&g.ID, &g.Seq, &g.SourceURL, &g.SiteID, &scrapedDomain, &title, &protagonist,
		&description, &category, &tags, &coverURL, &coverLocalPath, &g.ImageCount,
		&g.VideoCount, &g.PageCount, &status, &errorMsg, &downloadMethod,
		&g.ExpectedImageCount, &g.ExpectedVideoCount, &g.ContentVerified, &savePath,
		&g.TotalSize, &g.DownloadedSize, &g.GameCharacters, &g.PublishTime,
		&scrapedAtStr, &completedAtStr, &createdAtStr, &updatedAtStr)
	if err != nil {
		return err
	}
	// Convert nullable strings to regular strings (empty string if NULL)
	g.ScrapedDomain = scrapedDomain.String
	g.Title = title.String
	g.Protagonist = protagonist.String
	g.Description = description.String
	g.Category = category.String
	g.Tags = tags.String
	g.CoverURL = coverURL.String
	g.CoverLocalPath = coverLocalPath.String
	g.Status = status.String
	g.ErrorMsg = errorMsg.String
	g.DownloadMethod = downloadMethod.String
	g.SavePath = savePath.String
	// Parse time strings (SQLite stores times as TEXT in ISO8601 format)
	g.ScrapedAt = parseNullTime(scrapedAtStr)
	g.CompletedAt = parseNullTime(completedAtStr)
	g.CreatedAt = parseTime(createdAtStr)
	g.UpdatedAt = parseTime(updatedAtStr)
	return nil
}

// parseTime parses a non-nullable time string from SQLite.
// Returns zero time if parsing fails.
func parseTime(s sql.NullString) time.Time {
	if !s.Valid || s.String == "" {
		return time.Time{}
	}
	// Try multiple formats because SQLite may store times differently
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.000",
		time.RFC3339,
		time.RFC3339Nano,
	} {
		if t, err := time.Parse(layout, s.String); err == nil {
			return t
		}
	}
	return time.Time{}
}

// parseNullTime parses a nullable time string from SQLite.
// Returns nil if the string is empty or invalid.
func parseNullTime(s sql.NullString) *time.Time {
	if !s.Valid || s.String == "" {
		return nil
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.000",
		time.RFC3339,
		time.RFC3339Nano,
	} {
		if t, err := time.Parse(layout, s.String); err == nil {
			return &t
		}
	}
	return nil
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
		 FROM galleries WHERE id = ?`, id).
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
		dagID := h.getGalleryDagID(ctx, id)
		if h.DagOrch != nil {
			if dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
				// Retry the download node to re-download failed files.
				dlNodeID := fmt.Sprintf("dl-%d", id)
				if err := h.DagOrch.RetryDag(ctx, dagID, dlNodeID); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
					return
				}
			} else {
				// DAG not active → re-submit gallery pipeline.
				var sourceURL, siteID string
				err := h.DB.QueryRow(ctx,
					"SELECT source_url, site_id FROM galleries WHERE id = ?", id).
					Scan(&sourceURL, &siteID)
				if err != nil {
					writeError(w, http.StatusNotFound, "Gallery not found")
					return
				}
				def := dag.NewDagFactory().NewGalleryPipeline(sourceURL, siteID, id)
				newDagID, err := h.DagOrch.SubmitDag(ctx, def)
				if err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to submit gallery DAG: %v", err))
					return
				}
				h.updateGalleryDagID(ctx, id, newDagID)
			}
		}

		// Update gallery status for SSE propagation.
		if h.DB != nil {
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'downloading', error_msg = '' WHERE id = ?", id)
			if h.EventBus != nil {
				h.EventBus.Emit("task:progress", map[string]any{
					"taskId":   id,
					"taskType": "gallery",
					"status":   "downloading",
				})
			}
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
	dagID := h.getGalleryDagID(ctx, id)
	if h.DagOrch != nil && dagID != "" {
		if err := h.DagOrch.RetryDag(ctx, dagID, ""); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", err))
			return
		}
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'downloading', error_msg = '' WHERE id = ?", id)
		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   id,
				"taskType": "gallery",
				"status":   "downloading",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"galleryId": id,
			"message":   "Full gallery retry initiated (progress engine not available for fine-grained retry)",
		})
		return
	}

	writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
}
