package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"backend/internal/i18n"
)

// unifiedTaskRow is the flat row shape returned by the UNION ALL query
// that combines download_tasks, galleries, and sniff_tasks.
type unifiedTaskRow struct {
	TaskType        string
	ID              int
	URL             string
	Status          string
	Progress        float64
	FilePath        string
	Format          string
	Priority        int
	ErrorMsg        string
	SiteID          string
	Seq             *string
	Title           string
	Protagonist     string
	ImageCount      int
	VideoCount      int
	TotalSize       int64
	DownloadedSize  int64
	ContentVerified bool
	TotalSegments   int
	CompletedSegments int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// TaskStreamSSE streams real-time task updates via Server-Sent Events.
// It bridges EventBus events to the frontend with semantic event names
// (no more overloaded "patch") and sends an initial full snapshot of
// all three task types (video + gallery + sniff) in a single query.
func (h *Handlers) TaskStreamSSE(w http.ResponseWriter, r *http.Request) {
	sse := NewSSEStream(w)
	if sse == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	// Send initial state: unified query across all three task tables.
	// Previously only download_tasks was included, forcing the frontend
	// to fetch /api/shelf separately for gallery data (P0-3/P0-4 fix).
	if h.DB != nil {
			rows, err := h.DB.Query(r.Context(),
				`SELECT 'video' AS task_type, dt.id, dt.url, dt.status, dt.progress,
				        COALESCE(dt.file_path, '') AS file_path,
				        COALESCE(dt.format, '') AS format,
				        COALESCE(dt.priority, 0) AS priority,
				        COALESCE(dt.error_msg, '') AS error_msg,
				        COALESCE(dt.site_id, '') AS site_id,
				        dt.seq,
				        COALESCE(vi.title, '') AS title,
				        COALESCE(vi.actors, '') AS protagonist,
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
			                LEAST(ROUND(COALESCE(downloaded_size, 0)::numeric / NULLIF(total_size, 0)::numeric * 100, 1), 99)
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
		if err == nil {
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
			tasks = append(tasks, map[string]any{
				"TaskType":         r.TaskType,
				"ID":               r.ID,
				"URL":              r.URL,
				"Status":           r.Status,
				"Progress":         r.Progress,
				"FilePath":         r.FilePath,
				"Format":           r.Format,
				"Priority":         r.Priority,
				"ErrorMsg":        r.ErrorMsg,
				"SiteID":          r.SiteID,
				"DisplayID":        r.Seq,
				"GalleryTitle":     r.Title,
				"Person":           r.Protagonist,
				"ImageCount":       r.ImageCount,
				"VideoCount":       r.VideoCount,
				"GalleryTotalSize": r.TotalSize,
				"Segment":          r.CompletedSegments,
				"TotalSegments":    r.TotalSegments,
				"CreatedAt":        r.CreatedAt,
				"UpdatedAt":        r.UpdatedAt,
			})
			}
			// Post-process gallery progress: count actual files on disk.
			// The SQL-based progress uses downloaded_size/total_size ratio,
			// but for partially-downloaded galleries the file count is more
			// accurate — especially when some files failed and disk state
			// doesn't match DB expectations.
			for i, t := range tasks {
				if t["TaskType"] != "gallery" {
					continue
				}
				status, _ := t["Status"].(string)
				if status == "completed" || status == "pending" || status == "paused" {
					continue
				}
				savePath, _ := t["FilePath"].(string)
				if savePath == "" {
					continue
				}
				imageCount, _ := t["ImageCount"].(int)
				videoCount, _ := t["VideoCount"].(int)
				totalExpected := imageCount + videoCount
				if totalExpected == 0 {
					continue
				}
				actualFiles := countFilesInDir(savePath)
				if actualFiles > 0 {
					progress := float64(actualFiles) / float64(totalExpected) * 100
					if progress > 99 && status != "completed" {
						progress = 99
					}
					if progress < 1 {
						progress = 1
					}
					tasks[i]["Progress"] = progress
				}
			}
			sse.SendEvent("initial", tasks)
		}
	} else {
		sse.SendEvent("initial", []any{})
	}

	// Subscribe to task-related events from the EventBus.
	// P1-4 fix: use semantic event names instead of the overloaded "patch".
	if h.EventBus != nil {
		// task:created → task:created (was: upsert)
		unsubCreated := h.EventBus.On("task:created", func(payload any) {
			sse.SendEvent("task:created", payload)
		})

		// task:progress → task:progress (was: patch)
		unsubProgress := h.EventBus.On("task:progress", func(payload any) {
			sse.SendEvent("task:progress", payload)
		})

		// task:completed → task:completed (was: patch)
		unsubCompleted := h.EventBus.On("task:completed", func(payload any) {
			sse.SendEvent("task:completed", payload)
		})

		// task:failed → task:failed (was: patch)
		unsubFailed := h.EventBus.On("task:failed", func(payload any) {
			sse.SendEvent("task:failed", payload)
		})

		// task:cancelled → task:cancelled (was: delete)
		unsubCancelled := h.EventBus.On("task:cancelled", func(payload any) {
			sse.SendEvent("task:cancelled", payload)
		})

		// dag:nodeProgress → dag:nodeProgress (was: nodeProgress)
		unsubNodeProg := h.EventBus.On("dag:nodeProgress", func(payload any) {
			sse.SendEvent("dag:nodeProgress", payload)
		})

		// dag:nodeStateChanged → dag:nodeStateChanged (was: patch)
		unsubNodeState := h.EventBus.On("dag:nodeStateChanged", func(payload any) {
			raw, _ := json.Marshal(payload)
			sse.SendEvent("dag:nodeStateChanged", json.RawMessage(raw))
		})

		// gallery:downloadProgress → gallery:downloadProgress (was: patch)
		unsubGalleryProg := h.EventBus.On("gallery:downloadProgress", func(payload any) {
			sse.SendEvent("gallery:downloadProgress", payload)
		})

		// gallery:created — forwarded so the frontend can add new gallery
		// tasks to the list without requiring a page refresh.
		unsubGalleryCreated := h.EventBus.On("gallery:created", func(payload any) {
			sse.SendEvent("gallery:created", payload)
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
			unsubGalleryCreated()
		}()
	}

	sse.SendEvent("status", map[string]string{"state": "connected"})

	// Heartbeat: send a ping every 15s so the frontend can detect
	// dead connections and trigger proactive reconnection.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			sse.SendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
		}
	}
}

// countFilesInDir walks a directory recursively and counts all regular
// files, including those in subdirectories such as video_{id}/. The
// segments/ subdirectory (containing intermediate TS segment files) is
// excluded from counting to avoid inflating the file count above the
// expected total. Returns 0 if the directory does not exist or cannot
// be read. Used for accurate gallery progress calculation based on
// actual disk state rather than DB estimates.
func countFilesInDir(dirPath string) int {
	if dirPath == "" {
		return 0
	}
	count := 0
	filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && d.Name() == "segments" {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			count++
		}
		return nil
	})
	return count
}
