package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"database/sql"
	"backend/internal/api/internal/image"
	"backend/internal/api/internal/task_compute"
	"backend/internal/db"
	"backend/internal/i18n"
"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/taskprogress"
)

func (h *Handlers) getGalleryDagID(ctx context.Context, galleryID int) string {
	if h.DB == nil {
		return ""
	}
	var dagID string
	err := h.DB.QueryRow(ctx, "SELECT COALESCE(dag_id, '') FROM galleries WHERE id = ?", galleryID).Scan(&dagID)
	if err != nil {
		return ""
	}
	return dagID
}

func (h *Handlers) updateGalleryDagID(ctx context.Context, galleryID int, dagID string) {
	h.DB.Exec(ctx, "UPDATE galleries SET dag_id = ? WHERE id = ?", dagID, galleryID)
}

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

	enriched := make([]map[string]any, len(galleries))
	for i, g := range galleries {
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
			if g.TotalSize > 0 {
				progress = float64(g.DownloadedSize) / float64(g.TotalSize) * 100
				if progress > 99 && g.Status != "completed" {
					progress = 99
				}
			}
		}

		displayTitle := task_compute.StripPersonFromTitle(g.Title, g.Protagonist)
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
			"progress":            progress,
		}
	}
	writeJSON(w, http.StatusOK, enriched)
}

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
		var ca, ua db.SQLTime
		if err := rows.Scan(&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author, &b.PostDate, &b.ForumSection, &b.Notes, &ca, &ua); err != nil {
			continue
		}
		bookmarks = append(bookmarks, b)
	}
	writeJSON(w, http.StatusOK, bookmarks)
}

func (h *Handlers) ShelfDetail(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	if r.URL.Query().Get("type") == "cover" {
		var coverPath, coverURL string
		err := h.DB.QueryRow(r.Context(),
			"SELECT cover_local_path, cover_url FROM galleries WHERE id = ?", id).Scan(&coverPath, &coverURL)
		if err != nil {
			writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
			return
		}

		if coverPath != "" {
			fullPath := image.ResolveDataPath(coverPath)
			if fullPath != "" {
				if _, err := os.Stat(fullPath); err == nil {
					image.ServeResizedImage(w, r, fullPath, image.QueryWidth(r))
					return
				}
			}
		}

		var firstImageLocalPath string
		err = h.DB.QueryRow(r.Context(),
			"SELECT local_path FROM gallery_images WHERE gallery_id = ? AND status = 'downloaded' AND local_path != '' ORDER BY order_index LIMIT 1", id).Scan(&firstImageLocalPath)
		if err == nil && firstImageLocalPath != "" {
			fullPath := image.ResolveDataPath(firstImageLocalPath)
			if fullPath != "" {
				if _, err := os.Stat(fullPath); err == nil {
					image.ServeResizedImage(w, r, fullPath, image.QueryWidth(r))
					return
				}
			}
		}

		if coverURL != "" {
			http.Redirect(w, r, coverURL, http.StatusFound)
			return
		}

		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}

	var g db.Gallery
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
	g.ScrapedAt = parseNullTime(scrapedAtStr)
	g.CompletedAt = parseNullTime(completedAtStr)
	g.CreatedAt = parseTime(createdAtStr)
	g.UpdatedAt = parseTime(updatedAtStr)

	vidRows, vidErr := h.DB.Query(r.Context(),
		`SELECT id, gallery_id, url, local_path, file_name, file_size, duration, resolution, format, status, error_msg, completed_at, created_at, updated_at
		 FROM gallery_videos WHERE gallery_id = ? ORDER BY id`, id)
	if vidErr == nil {
		defer vidRows.Close()
		for vidRows.Next() {
			var v db.GalleryVideo
			var completedAt, createdAt, updatedAt db.SQLTime
			if scanErr := vidRows.Scan(&v.ID, &v.GalleryID, &v.URL, &v.LocalPath, &v.FileName, &v.FileSize, &v.Duration, &v.Resolution, &v.Format, &v.Status, &v.ErrorMsg, &completedAt, &createdAt, &updatedAt); scanErr == nil {
			completedTime := completedAt.Time
				v.CompletedAt = &completedTime
				v.CreatedAt = createdAt.Time
				v.UpdatedAt = updatedAt.Time
				g.Videos = append(g.Videos, v)
			}
		}
	}

	writeJSON(w, http.StatusOK, g)
}

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
		var ca, ua db.SQLTime
		if err := rows.Scan(&b.ID, &b.URL, &b.ThreadID, &b.Title, &b.CoverURL, &b.Author, &b.PostDate, &b.ForumSection, &b.Notes, &ca, &ua); err != nil {
			continue
		}
		bookmarks = append(bookmarks, b)
	}
	writeJSON(w, http.StatusOK, bookmarks)
}

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
	writeJSON(w, http.StatusOK, map[string]any{
		"url":   req.URL,
		"title": req.URL,
	})
}

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
		var completedAt, createdAt, updatedAt db.SQLTime
		if err := rows.Scan(&img.ID, &img.GalleryID, &img.URL, &img.LocalPath, &img.FileName, &img.FileSize, &img.Width, &img.Height, &img.Format, &img.PageIndex, &img.OrderIndex, &img.Status, &img.ErrorMsg, &completedAt, &createdAt, &updatedAt); err != nil {
			continue
		}
		images = append(images, img)
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": images, "videos": []any{}})
}

func (h *Handlers) Protagonists(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"protagonists": []any{}}})
		return
	}
	ctx := r.Context()

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
		`SELECT protagonist, COUNT(*) as gallery_count,
		        COALESCE((SELECT cover_url FROM galleries g2
		                  WHERE g2.protagonist = galleries.protagonist
		                    AND g2.cover_url != '' AND g2.status = 'completed'
		                  ORDER BY g2.id DESC LIMIT 1), '') AS cover_url
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
		Count        int    `json:"count"`
		CoverURL     string `json:"coverUrl"`
	}
	result := []protagonistStat{}
	for rows.Next() {
		var ps protagonistStat
		if err := rows.Scan(&ps.Name, &ps.GalleryCount, &ps.CoverURL); err != nil {
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
		var ca, ua db.SQLTime
		if err := rows.Scan(&dh.ID, &dh.SiteID, &dh.GalleryID, &dh.URL, &dh.Status, &dh.ImageCount, &dh.VideoCount, &dh.Title, &dh.Protagonist, &dh.SavePath, &ca, &ua); err != nil {
			continue
		}
		history = append(history, dh)
	}
	writeJSON(w, http.StatusOK, history)
}

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

func (h *Handlers) ShelfDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	var savePath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(save_path, '') FROM galleries WHERE id = ?", id).Scan(&savePath)

	var zipLocalPath string
	_ = h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(local_path, '') FROM gallery_download_infos WHERE gallery_id = ?", id).Scan(&zipLocalPath)

	if h.DagOrch != nil {
		dagID := h.getGalleryDagID(r.Context(), id)
		if dagID != "" && h.DagOrch.GetDagStatus(dagID) != nil {
		_ = h.DagOrch.CancelDag(r.Context(), dagID)
		}
	}

	var exists bool
	err := h.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM galleries WHERE id = ?)", id).Scan(&exists)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.gallery.notFound"))
		return
	}

	h.DB.Exec(r.Context(), "DELETE FROM gallery_videos WHERE gallery_id = ?", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_images WHERE gallery_id = ?", id)
	h.DB.Exec(r.Context(), "DELETE FROM gallery_download_infos WHERE gallery_id = ?", id)
	_, err = h.DB.Exec(r.Context(), "DELETE FROM galleries WHERE id = ?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.gallery.queryFailed"))
		return
	}

	// Drop in-memory progress tracking state for the deleted gallery
	// (files + phase maps) so deleted galleries cannot accumulate in RAM.
	if h.ProgressEngine != nil {
		h.ProgressEngine.RemoveGallery(id)
	}

	// File cleanup runs in the background: os.RemoveAll can block for a long
	// time on Windows when freshly-cancelled executors still hold file
	// handles, and blocking here stalls the HTTP response (observed as an
	// indefinitely spinning batch delete in the UI). asyncRemoveAll retries
	// on locks and logs leftovers instead of silently discarding errors.
	asyncRemoveAll(savePath, zipLocalPath)

	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{
			"taskId":   id,
			"taskType": "gallery",
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

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

	case "start":
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "retry":
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "pause":
			if h.DagOrch != nil && dagID != "" {
				if err := h.DagOrch.PauseDag(ctx, dagID); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG pause failed: %v", err))
					return
				}
				// No direct DB write / hardcoded SSE status here: PauseDag
				// transitions nodes to PAUSED and the statusSync callback
				// (main.go) writes "paused" to the DB and emits the matching
				// task:progress event. Duplicating the write here previously
				// let the hardcoded label diverge from the FSM truth.
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
				// No direct DB write here. ResumeDag moves nodes to READY/
				// QUEUED and statusSync writes the correct entity status
				// ("pending" while held back, "scraping"/"downloading" once
				// the scheduler dispatches). The previous hardcoded
				// status='scraping' write reintroduced the "fake scraping"
				// defect (260822) whenever the resumed DAG was still queued.
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "resume", "status": "resumed"})
				return
			}
			writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")

	case "download":
		h.shelfRetryFailed(ctx, w, r, id)
		return

	case "download-zip":
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"id":      id,
			"action":  "download-zip",
			"success": false,
			"error":   "zip download is only available through the gallery download pipeline",
		})

	case "cancel":
		if h.DagOrch != nil && dagID != "" {
			if st := h.DagOrch.GetDagStatus(dagID); st != nil {
				if err := h.DagOrch.CancelDag(ctx, dagID); err != nil {
					writeError(w, http.StatusInternalServerError, fmt.Sprintf("cancel DAG failed: %v", err))
					return
				}
			}
		}
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'cancelled', error_msg = '' WHERE id = ?", id)
		if h.EventBus != nil {
			h.EventBus.Emit("task:cancelled", map[string]any{
				"taskId":   id,
				"taskType": "gallery",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "cancel", "status": "cancelled"})
		return

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

func (h *Handlers) shelfRetryFailed(ctx context.Context, w http.ResponseWriter, r *http.Request, id int) error {
	h.cleanupGalleryCache(ctx, id)

	dagID := h.getGalleryDagID(ctx, id)
	if h.DagOrch != nil {
		if dagID != "" {
			status := h.DagOrch.GetDagStatus(dagID)
			if status != nil {
				// Classify node states so "start" means the right thing:
				//   - paused nodes  → ResumeDag (user paused; re-schedule them)
				//   - failed nodes  → RetryDag (retry only FAILED/TIMEOUT/NEEDS_RETRY)
				//   - active nodes  → genuinely in flight; do NOT create a
				//                      duplicate DAG (double-execution caused file
				//                      conflicts / download anomalies after resume)
				//   - all-terminal  → a COMPLETED download whose individual
				//                      file failures were tolerated by the batch
				//                      executor (gallery reads "partial").
				//                      RetryDag would no-op on COMPLETED nodes,
				//                      so submit a fresh resume pipeline for the
				//                      failed/missing rows that
				//                      cleanupGalleryCache just reset above.
				hasPaused, hasFailed, hasActive := false, false, false
				for _, ns := range status.Nodes {
					switch ns.State {
					case orchestrator.NodeStatePaused:
						hasPaused = true
					case orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout, orchestrator.NodeStateNeedsRetry:
						hasFailed = true
					case orchestrator.NodeStatePending, orchestrator.NodeStatePreparing, orchestrator.NodeStateReady,
						orchestrator.NodeStateQueued, orchestrator.NodeStateAllocated, orchestrator.NodeStateRunning,
						orchestrator.NodeStateVerifying, orchestrator.NodeStateResumeVerify:
						hasActive = true
					}
				}
				var err error
				dagIdOut := dagID
				switch {
				case hasPaused:
					err = h.DagOrch.ResumeDag(ctx, dagID, "")
				case hasFailed:
					err = h.DagOrch.RetryDag(ctx, dagID, "")
				case hasActive:
					writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "start", "dagId": dagID, "status": "already-running"})
					return nil
				default:
					// all-terminal (completed/cancelled): resume pipeline.
					dagIdOut, err = h.resubmitGalleryResume(ctx, id)
				}
				if err != nil {
					if resp, ok := err.(*retrySubmitError); ok {
						writeError(w, resp.status, resp.msg)
					} else {
						writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG resume/retry failed: %v", err))
					}
					return nil
				}
				// ResumeDag/RetryDag already re-transitioned the nodes and
				// statusSync wrote the correct entity status (pending while
				// held back, scraping/downloading once dispatched) plus the
				// matching SSE event. Only clear the stale error message —
				// writing a hardcoded status here would overwrite the
				// FSM-derived value and reintroduce status divergence.
				h.DB.Exec(ctx, "UPDATE galleries SET error_msg = '' WHERE id = ?", id)
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "start", "dagId": dagIdOut, "status": "resuming"})
				return nil
			}
		}
		// Resubmit through the state-aware selector so retry-failed and
		// GalleryFileRetry pick the same pipeline for the same gallery
		// state (resubmitGalleryResume). scrapeDataExists (image/video
		// count > 0) is the single decision key — see
		// SelectGalleryPipeline for why status labels are not used.
		newDagID, err := h.resubmitGalleryResume(ctx, id)
		if err != nil {
			if resp, ok := err.(*retrySubmitError); ok {
				writeError(w, resp.status, resp.msg)
			} else {
				writeError(w, http.StatusInternalServerError, err.Error())
			}
			return nil
		}
		// Freshly submitted DAGs start with PENDING nodes: per the
		// StatusReporter design (260821) the entity must read "pending"
		// until the scheduler actually dispatches a node — NOT "scraping",
		// which previously made every queued task look like it was actively
		// identifying. statusSync takes over as soon as nodes transition.
		h.DB.Exec(ctx, "UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = ?", id)
		if h.EventBus != nil {
			h.EventBus.Emit("task:progress", map[string]any{
				"taskId":   id,
				"taskType": "gallery",
				"status":   "pending",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "dagId": newDagID, "status": "retrying"})
		return nil
	}
	h.DB.Exec(ctx, "UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = ?", id)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "action": "retry-failed", "status": "pending"})
	return nil
}

// cleanupGalleryCache prepares a gallery for retry with checkpoint
// preservation. Unlike the old "clean slate" behavior (which deleted the
// whole folder and reset every image to pending, forcing a full
// re-download), this keeps already-downloaded files on disk and in the DB
// so a retry resumes from where it left off — only failed/missing files
// are reset to pending for re-download.
//
// Removes:
//   - A stale ZIP archive referenced by gallery_download_infos (it is
//     re-downloaded on retry; keeping a corrupt partial ZIP is worse).
//
// Resets to pending (re-download):
//   - gallery_images with status='failed' (retry these).
//   - gallery_images with status='downloaded' whose local_path no longer
//     exists on disk (file was deleted/corrupted between attempts).
//
// Preserves (accurate continuation):
//   - Successfully downloaded images whose files still exist on disk.
//   - gallery_images with status='pending' (never attempted).
func (h *Handlers) cleanupGalleryCache(ctx context.Context, galleryID int) {
	var savePath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(save_path, '') FROM galleries WHERE id = ?", galleryID).Scan(&savePath)

	// A corrupt partial ZIP archive from a prior download must be removed;
	// it would confuse subsequent downloads.
	var zipLocalPath string
	_ = h.DB.QueryRow(ctx,
		"SELECT COALESCE(local_path, '') FROM gallery_download_infos WHERE gallery_id = ?", galleryID).
		Scan(&zipLocalPath)
	if zipLocalPath != "" {
		_ = os.Remove(zipLocalPath)
		_, _ = h.DB.Exec(ctx,
			"UPDATE gallery_download_infos SET status = 'pending', local_path = '', resolved_direct_url = '', updated_at = CURRENT_TIMESTAMP WHERE gallery_id = ?",
			galleryID)
	}

	_, _ = h.DB.Exec(ctx,
		"UPDATE gallery_images SET status = 'pending', error_msg = '' WHERE gallery_id = ? AND status = 'failed'", galleryID)

	// Videos need the same failed→pending reset as images: the download
	// executor loads gallery_videos rows with status='pending' only, so a
	// failed video left in 'failed' would never be re-downloaded by the
	// resume pipeline this cleanup is preparing.
	_, _ = h.DB.Exec(ctx,
		"UPDATE gallery_videos SET status = 'pending', error_msg = '' WHERE gallery_id = ? AND status = 'failed'", galleryID)

	// Reset 'downloaded' images whose file was deleted between attempts;
	// those files must be re-fetched.
	rows, err := h.DB.Query(ctx,
		`SELECT id, local_path FROM gallery_images
		 WHERE gallery_id = ? AND status = 'downloaded' AND local_path != ''`, galleryID)
	if err == nil {
		var staleIDs []int
		for rows.Next() {
			var imgID int
			var localPath string
			if scanErr := rows.Scan(&imgID, &localPath); scanErr != nil {
				continue
			}
			if info, statErr := os.Stat(localPath); statErr != nil || info.Size() == 0 {
				staleIDs = append(staleIDs, imgID)
			}
		}
		rows.Close()
		for _, imgID := range staleIDs {
			_, _ = h.DB.Exec(ctx,
				"UPDATE gallery_images SET status = 'pending', error_msg = 'file missing on retry', local_path = '' WHERE id = ?", imgID)
		}
		if len(staleIDs) > 0 {
			infra.NewLogger("GalleryRetry").Info("Retry: reset missing-image files to pending", "galleryId", galleryID, "count", len(staleIDs))
		}
	}

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
	g.ScrapedAt = parseNullTime(scrapedAtStr)
	g.CompletedAt = parseNullTime(completedAtStr)
	g.CreatedAt = parseTime(createdAtStr)
	g.UpdatedAt = parseTime(updatedAtStr)
	return nil
}

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
		phase := h.ProgressEngine.GetPhase(id)
		writeJSON(w, http.StatusOK, map[string]any{
			"galleryId": id,
			"summary":   summary,
			"failed":    failed,
			"phase":     string(phase),
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
		// Restart recovery: the engine's file map is only populated by
		// the download executor or LoadProgress — after a restart it is
		// empty and ComputeRetryRange would 500 with "not found in
		// progress tracker". Load from the checkpoint table on demand.
		if h.DB != nil {
			if err := h.ProgressEngine.EnsureLoadedForRetry(ctx, h.DB, id); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to load progress: %v", err))
				return
			}
		}

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

		// ── Reset the checkpoint BEFORE driving the DAG ──
		// The download executor reads gallery_images rows with
		// status='pending' (wire_executors.go) — a retried file whose row
		// still says 'failed' is invisible to it, making the whole retry
		// a no-op. This is the file-level analogue of
		// cleanupGalleryCache, which shelfRetryFailed already runs:
		// reset exactly the computed indices (order_index space), keep
		// every other file's status untouched.
		resetCount, resetErr := h.resetGalleryFilesForRetry(ctx, id, indices)
		if resetErr != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to reset file states: %v", resetErr))
			return
		}
		if resetCount == 0 {
			writeJSON(w, http.StatusOK, taskprogress.RetryResult{
				GalleryID: id,
				Message:   "No pending-able files among computed indices (all already pending or not found)",
			})
			return
		}
		// Keep the in-memory tracker in sync so subsequent retry
		// computations and progress summaries see the same truth as the
		// DB. The checkpoint table itself is rewritten by the download
		// executor's SaveProgress after the batch finishes.
		h.ProgressEngine.ResetFileStatusForRetry(id, indices)

		// ── Drive the DAG ──
		// The DAG-level retry only re-dispatches FAILED/TIMEOUT/
		// NEEDS_RETRY nodes. But individual file failures are tolerated
		// inside the download executor (each failed image writes
		// status='failed' on its row and the batch continues), so the dl
		// node usually ends COMPLETED with the gallery marked "partial" —
		// exactly the situation file-level retry exists for. In that
		// case there is no failed node to retry: submit a fresh resume
		// pipeline (download → extract → verify) which will pick up the
		// rows just reset to pending above.
		dagID := h.getGalleryDagID(ctx, id)
		if h.DagOrch != nil {
			if dagID != "" {
				if st := h.DagOrch.GetDagStatus(dagID); st != nil {
					// Classify the download node state so the retry drives
					// the right thing. RetryDag is a no-op for non-FAILED
					// nodes; a completed dl node must instead get a new
					// resume DAG, or the retry silently does nothing.
					dlNodeID := fmt.Sprintf("dl-%d", id)
					dlFound := false
					dlState := orchestrator.NodeState("")
					for _, ns := range st.Nodes {
						if ns.NodeID == dlNodeID {
							dlState = ns.State
							dlFound = true
							break
						}
					}
					var retryErr error
					switch {
					case !dlFound:
						// Legacy/snapshot DAG without a dl node (e.g. the old
						// single-node pipeline): nothing to drive here, but the
						// files were just reset — submit a resume pipeline so
						// they are actually downloaded.
						_, retryErr = h.resubmitGalleryResume(ctx, id)
					case dlState == orchestrator.NodeStateFailed,
						dlState == orchestrator.NodeStateTimeout,
						dlState == orchestrator.NodeStateNeedsRetry:
						retryErr = h.DagOrch.RetryDag(ctx, dagID, dlNodeID)
					case dlState == orchestrator.NodeStatePaused:
						retryErr = h.DagOrch.ResumeDag(ctx, dagID, "")
					case dlState == orchestrator.NodeStateCompleted:
						// dl finished but individual files failed → new
						// resume pipeline for the rows reset above. Node
						// IDs may repeat across DAGs: the scheduler keys
						// submissions by (dagID, nodeID) so the fresh DAG
						// does not collide with the old instance.
						_, retryErr = h.resubmitGalleryResume(ctx, id)
					default:
						// running / queued / verifying / held back: nothing
						// to retry while the node is in flight.
						writeJSON(w, http.StatusOK, taskprogress.RetryResult{
							GalleryID: id,
							Message:   "Download node is not in a retryable state (already running or finished)",
						})
						return
					}
					if retryErr != nil {
						writeError(w, http.StatusInternalServerError, fmt.Sprintf("DAG retry failed: %v", retryErr))
						return
					}
				} else {
					// DAG not active (removed via RemoveDag or restart with
					// no snapshot) → re-submit a pipeline through the
					// state-aware selector. A gallery that already has
					// scraped image/video rows must NOT go through the
					// full pipeline: the scrape executor wipes
					// gallery_images/gallery_videos and re-inserts every
					// row as pending, resetting the checkpoint of
					// already-downloaded files.
					if _, err := h.resubmitGalleryResume(ctx, id); err != nil {
						if resp, ok := err.(*retrySubmitError); ok {
							writeError(w, resp.status, resp.msg)
						} else {
							writeError(w, http.StatusInternalServerError, err.Error())
						}
						return
					}
				}
			} else {
				// No DAG ID on record (legacy gallery created before DAG
				// IDs were persisted): same resume submission.
				if _, err := h.resubmitGalleryResume(ctx, id); err != nil {
					if resp, ok := err.(*retrySubmitError); ok {
						writeError(w, resp.status, resp.msg)
					} else {
						writeError(w, http.StatusInternalServerError, err.Error())
					}
					return
				}
			}
		}

		// Update gallery status for SSE propagation. Resume-pipeline
		// nodes start PENDING: per the StatusReporter design (260821) the
		// entity must read "pending" until the scheduler dispatches a
		// node — the previous unconditional "downloading" write here was
		// the same false-state bug class fixed in shelfRetryFailed
		// (a queued gallery looked like it was actively downloading).
		// statusSync takes over as soon as nodes transition.
		if h.DB != nil {
			h.DB.Exec(ctx, "UPDATE galleries SET status = 'pending', error_msg = '' WHERE id = ?", id)
			if h.EventBus != nil {
				h.EventBus.Emit("task:progress", map[string]any{
					"taskId":   id,
					"taskType": "gallery",
					"status":   "pending",
				})
			}
		}

		writeJSON(w, http.StatusOK, taskprogress.RetryResult{
			GalleryID:      id,
			RetriedCount:   resetCount,
			RetriedIndices: indices,
			Message:        fmt.Sprintf("Retrying %d file(s) with strategy %s", resetCount, retryReq.Strategy),
		})
		return
	}

	// Fallback without progress engine: retry the whole gallery DAG.
	dagID := h.getGalleryDagID(ctx, id)
	if h.DagOrch != nil && dagID != "" {
		if st := h.DagOrch.GetDagStatus(dagID); st != nil {
			// Same state-routing as the fine-grained path: RetryDag is a
			// no-op when no node is FAILED, so only write "downloading"
			// when we actually resumed/retried something.
			hasPaused, hasFailed := false, false
			for _, ns := range st.Nodes {
				switch ns.State {
				case orchestrator.NodeStatePaused:
					hasPaused = true
				case orchestrator.NodeStateFailed, orchestrator.NodeStateTimeout, orchestrator.NodeStateNeedsRetry:
					hasFailed = true
				}
			}
			var err error
			switch {
			case hasPaused:
				err = h.DagOrch.ResumeDag(ctx, dagID, "")
			case hasFailed:
				err = h.DagOrch.RetryDag(ctx, dagID, "")
			default:
				writeJSON(w, http.StatusOK, map[string]any{
					"galleryId": id,
					"message":   "Gallery DAG is already running or finished; nothing to retry",
				})
				return
			}
			if err != nil {
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
	}

	writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
}

// retrySubmitError wraps a gallery resubmission failure with the HTTP
// status the endpoint should respond with, so resubmitGalleryResume can
// distinguish "gallery vanished" (404) from submission failure (500).
type retrySubmitError struct {
	status int
	msg    string
}

func (e *retrySubmitError) Error() string { return e.msg }

// resubmitGalleryResume re-submits a pipeline for a gallery whose DAG is
// no longer active, routed through the state-aware selector: a gallery
// that already holds scraped image/video rows gets the download-only
// resume pipeline; only a never-scraped gallery gets the full pipeline
// (whose scrape node would otherwise wipe gallery_images/gallery_videos
// and re-insert every row as pending, resetting the checkpoint of files
// already on disk — the cascade failure pattern documented on
// SelectGalleryPipeline). Returns the new DAG ID.
func (h *Handlers) resubmitGalleryResume(ctx context.Context, galleryID int) (string, error) {
	var sourceURL, siteID string
	var imageCount, videoCount int
	err := h.DB.QueryRow(ctx,
		"SELECT source_url, site_id, COALESCE(image_count,0), COALESCE(video_count,0) FROM galleries WHERE id = ?", galleryID).
		Scan(&sourceURL, &siteID, &imageCount, &videoCount)
	if err != nil {
		return "", &retrySubmitError{status: http.StatusNotFound, msg: "Gallery not found"}
	}
	def := dag.NewDagFactory().SelectGalleryPipeline(sourceURL, siteID, galleryID, imageCount > 0 || videoCount > 0)
	newDagID, err := h.DagOrch.SubmitDag(ctx, def)
	if err != nil {
		return "", &retrySubmitError{
			status: http.StatusInternalServerError,
			msg:    fmt.Sprintf("Failed to submit gallery DAG: %v", err),
		}
	}
	h.updateGalleryDagID(ctx, galleryID, newDagID)
	return newDagID, nil
}

// resetGalleryFilesForRetry resets exactly the given file indices
// (order_index space — the same key the progress engine uses) back to
// 'pending' in gallery_images so the download executor, which only
// loads rows with status='pending', actually re-downloads them. Without
// this reset a file-level retry computes the right indices but the
// executor never sees the files — the retry is a silent no-op.
// Rows whose files were already deleted from disk are not distinguished
// here; both failed and missing-file cases need a re-download either way.
func (h *Handlers) resetGalleryFilesForRetry(ctx context.Context, galleryID int, indices []int) (int, error) {
	if len(indices) == 0 {
		return 0, nil
	}
	placeholders := strings.Repeat("?,", len(indices))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(indices)+2)
	args = append(args, galleryID)
	for _, idx := range indices {
		args = append(args, idx)
	}
	res, err := h.DB.Exec(ctx,
		`UPDATE gallery_images
		 SET status = 'pending', error_msg = '', updated_at = CURRENT_TIMESTAMP
		 WHERE gallery_id = ? AND order_index IN (`+placeholders+`)
		   AND status != 'downloaded'`,
		args...)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}
