package handlers

import (
	"net/http"

	"backend/internal/db"
	"backend/internal/downloader/video"
	"backend/internal/i18n"
)

// TaskList returns a paginated list of download tasks.
func (h *Handlers) TaskList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)

	rows, err := h.DB.Query(r.Context(),
		`SELECT id, url, m3u8_url, status, progress, file_path, format, priority, error_msg, seq, created_at, updated_at
		 FROM download_tasks ORDER BY id DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.queryFailed"))
		return
	}
	defer rows.Close()

	tasks := []db.DownloadTask{}
	for rows.Next() {
		var t db.DownloadTask
		if err := rows.Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.Seq, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
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
	if req.Format == "" {
		req.Format = "mp4"
	}
	if req.Priority == 0 {
		req.Priority = 1
	}

	var seqPtr *string
	if req.Seq != "" {
		seqPtr = &req.Seq
	}

	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO download_tasks (url, m3u8_url, status, progress, file_path, format, priority, error_msg, seq)
		 VALUES ($1, '', 'pending', 0, '', $2, $3, '', $4)
		 RETURNING id`,
		req.URL, req.Format, req.Priority, seqPtr).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	// Dedup: record download history to prevent duplicates on retry
	h.DB.Exec(r.Context(),
		`INSERT INTO download_history (url, status) VALUES ($1, 'created') ON CONFLICT DO NOTHING`,
		req.URL)

	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "pending"})
}

// TaskDetail returns a single task by ID.
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
		`SELECT id, url, m3u8_url, status, progress, file_path, format, priority, error_msg, seq, created_at, updated_at
		 FROM download_tasks WHERE id = $1`, id).
		Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress, &t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.Seq, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// TaskAction handles start/pause/resume/cancel/retry operations
// on download tasks via the injected DownloadManager.
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
		go h.DownloadMgr.StartDownload(r.Context(), video.DownloadTaskInput{ID: id})
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "started"})
	case "pause":
		if err := h.DownloadMgr.PauseDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.pauseFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "paused"})
	case "resume":
		if err := h.DownloadMgr.ResumeDownload(id); err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.resumeFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "resumed"})
	case "cancel":
		h.DownloadMgr.CancelDownload(id)
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})
	case "retry":
		h.DownloadMgr.CancelDownload(id)
		go h.DownloadMgr.StartDownload(r.Context(), video.DownloadTaskInput{ID: id})
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "retrying"})
	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}
