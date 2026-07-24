package handlers

import (
	"encoding/json"
	"net/http"

	"backend/internal/api"
	"backend/internal/db"
	"backend/internal/i18n"
)

// TaskStreamSSE streams real-time task updates via Server-Sent Events.
// It mirrors the TypeScript /api/tasks/stream SSE handler, bridging
// EventBus task:* events to SSE events that the frontend Zustand stores
// consume (initial, upsert, patch, delete, sniffTask, notification,
// nodeProgress).
func (h *Handlers) TaskStreamSSE(w http.ResponseWriter, r *http.Request) {
	sse := api.NewSSEStream(w)
	if sse == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	// Send initial state: all download tasks as a JSON array
	if h.DB != nil {
		rows, err := h.DB.Query(r.Context(),
			`SELECT id, url, m3u8_url, status, progress, file_path, format, priority, error_msg, seq, created_at, updated_at
			 FROM download_tasks ORDER BY id DESC`)
		if err == nil {
			defer rows.Close()
			tasks := []db.DownloadTask{}
			for rows.Next() {
				var t db.DownloadTask
				if err := rows.Scan(&t.ID, &t.URL, &t.M3U8URL, &t.Status, &t.Progress,
					&t.FilePath, &t.Format, &t.Priority, &t.ErrorMsg, &t.Seq,
					&t.CreatedAt, &t.UpdatedAt); err != nil {
					continue
				}
				tasks = append(tasks, t)
			}
			sse.SendEvent("initial", tasks)
		}
	} else {
		sse.SendEvent("initial", []any{})
	}

	// Subscribe to task-related events from the EventBus
	if h.EventBus != nil {
		// task:created -> upsert
		unsubCreated := h.EventBus.On("task:created", func(payload any) {
			sse.SendEvent("upsert", payload)
		})

		// task:progress -> patch (progress update)
		unsubProgress := h.EventBus.On("task:progress", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("patch", json.RawMessage(raw))
		})

		// task:completed -> patch (status=completed)
		unsubCompleted := h.EventBus.On("task:completed", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("patch", json.RawMessage(raw))
		})

		// task:failed -> patch (status=failed)
		unsubFailed := h.EventBus.On("task:failed", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("patch", json.RawMessage(raw))
		})

		// task:cancelled -> delete
		unsubCancelled := h.EventBus.On("task:cancelled", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("delete", json.RawMessage(raw))
		})

		// dag:nodeProgress -> nodeProgress
		unsubNodeProg := h.EventBus.On("dag:nodeProgress", func(payload any) {
			sse.SendEvent("nodeProgress", payload)
		})

		// dag:nodeStateChanged -> patch (DAG node state changes)
		unsubNodeState := h.EventBus.On("dag:nodeStateChanged", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("patch", json.RawMessage(raw))
		})

		// gallery:downloadProgress -> patch (gallery progress)
		unsubGalleryProg := h.EventBus.On("gallery:downloadProgress", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("patch", json.RawMessage(raw))
		})

		defer func() {
			unsubCreated()
			unsubProgress()
			unsubCompleted()
			unsubFailed()
			unsubCancelled()
			unsubNodeProg()
			unsubNodeState()
			unsubGalleryProg()
		}()
	}

	sse.SendEvent("status", map[string]string{"state": "connected"})
	<-r.Context().Done()
}
