package api

import (
	"net/http"
	"os"

	"backend/internal/api/internal/image"
	"backend/internal/i18n"
)

// videoShelfItem is one entry of the /shelf/videos page: a completed (or
// in-flight) video-pipeline download. Field names mirror GalleryData where
// the frontend card UI is shared (Title/Status/TotalSize…).
type videoShelfItem struct {
	ID         int     `json:"ID"`
	DisplayID  string  `json:"DisplayID"`
	Title      string  `json:"Title"`
	Status     string  `json:"Status"`
	Progress   float64 `json:"Progress"`
	Duration   float64 `json:"Duration"`
	Resolution string  `json:"Resolution"`
	TotalSize  int64   `json:"TotalSize"`
	SourceURL  string  `json:"SourceURL"`
	CreatedAt  string  `json:"CreatedAt"`
	UpdatedAt  string  `json:"UpdatedAt"`
	HasFile    bool    `json:"HasFile"`
}

// VideoShelfList (GET /api/videos) lists video-pipeline downloads
// (download_tasks ⋈ video_infos) for the /shelf/videos page.
//
// The page previously sourced /api/shelf (galleries table), which video
// pipeline tasks never populate — the folder showed zero cards even when
// data/videos contained finished MP4s.
func (h *Handlers) VideoShelfList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}

	rows, err := h.DB.Query(r.Context(),
		`SELECT dt.id, COALESCE(dt.seq, ''), dt.status, COALESCE(dt.progress, 0),
		        COALESCE(dt.file_path, ''), COALESCE(dt.created_at, ''), COALESCE(dt.updated_at, ''),
		        COALESCE(vi.title, ''), COALESCE(vi.duration, 0), COALESCE(vi.resolution, ''),
		        COALESCE(vi.file_size, 0), COALESCE(vi.source_url, '')
		 FROM download_tasks dt
		 JOIN video_infos vi ON vi.task_id = dt.id
		 ORDER BY dt.created_at DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	items := []videoShelfItem{}
	for rows.Next() {
		var it videoShelfItem
		var filePath string
		if err := rows.Scan(&it.ID, &it.DisplayID, &it.Status, &it.Progress,
			&filePath, &it.CreatedAt, &it.UpdatedAt,
			&it.Title, &it.Duration, &it.Resolution, &it.TotalSize, &it.SourceURL); err != nil {
			continue
		}
		if filePath != "" {
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() && info.Size() > 0 {
				it.HasFile = true
				// Prefer the on-disk size over the (possibly stale) probe size.
				if info.Size() > it.TotalSize || it.TotalSize == 0 {
					it.TotalSize = info.Size()
				}
			}
		}
		// Rows with neither a playable file nor an active pipeline (e.g.
		// failed without output) are still listed so the user can retry.
		items = append(items, it)
	}

	writeJSON(w, http.StatusOK, items)
}

// VideoFile (GET /api/videos/{id}/file) streams the transcoded MP4 with
// Range support (http.ServeFile handles it natively), enabling seeking and
// the 8x hover preview on the shelf page.
func (h *Handlers) VideoFile(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	var filePath string
	if err := h.DB.QueryRow(r.Context(),
		"SELECT COALESCE(file_path, '') FROM download_tasks WHERE id = ?", id).Scan(&filePath); err != nil || filePath == "" {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}

	abs := image.ResolveDataPath(filePath)
	if abs == "" {
		writeError(w, http.StatusForbidden, "invalid path")
		return
	}
	if _, err := os.Stat(abs); err != nil {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}

	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeFile(w, r, abs)
}
