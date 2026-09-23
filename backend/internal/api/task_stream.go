package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"backend/internal/api/internal/sse"
	"backend/internal/api/internal/task_compute"
	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/infra"
)

// taskStreamLogger surfaces silent failures while building the initial
// snapshot. Scan errors were previously swallowed by continue, leaving the
// SSE initial snapshot empty with no log trace (same amplifier as the
// 260803 "SSE initial always empty for days" incident).
var taskStreamLogger = infra.NewLogger("TaskStream")

// Initial-snapshot pagination: page large task lists instead of returning
// everything at once, which would congest the SSE queue.
const (
	taskStreamInitialPageSize = 500  // tasks per page
	taskStreamMaxInitialTasks = 2000 // max tasks in the initial snapshot (triggers paging beyond this)
)

// progressThrottle rate-limits progress events per task ID to prevent
// SSE queue overflow from high-frequency progress updates.
type progressThrottle struct {
	mu     sync.RWMutex
	lastAt map[string]time.Time
	minGap time.Duration
}

func newProgressThrottle(minGap time.Duration) *progressThrottle {
	return &progressThrottle{
		lastAt: make(map[string]time.Time),
		minGap: minGap,
	}
}

func (pt *progressThrottle) Allow(taskID string) bool {
	pt.mu.RLock()
	last, ok := pt.lastAt[taskID]
	pt.mu.RUnlock()
	if ok && time.Since(last) < pt.minGap {
		return false
	}
	pt.mu.Lock()
	pt.lastAt[taskID] = time.Now()
	pt.mu.Unlock()
	return true
}

func (pt *progressThrottle) Cleanup() {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	now := time.Now()
	for id, t := range pt.lastAt {
		if now.Sub(t) > 5*time.Minute {
			delete(pt.lastAt, id)
		}
	}
}

type unifiedTaskRow struct {
	TaskType          string
	ID                int
	URL               string
	Status            string
	Progress          float64
	FilePath          string
	Format            string
	Priority          int
	ErrorMsg          string
	SiteID            string
	Seq               *string
	Title             string
	Protagonist       string
	ImageCount        int
	VideoCount        int
	TotalSize         int64
	DownloadedSize    int64
	ContentVerified   bool
	TotalSegments     int
	CompletedSegments int
	Tags              string
	CreatedAt         db.SQLTime
	UpdatedAt         db.SQLTime
}

// toMap converts a unifiedTaskRow into the enriched map format consumed by
// the frontend (via SSE initial snapshot and /api/tasks/all). Applies person
// parsing and task_compute enrichment (EffectiveStatus / ProgressStage /
// AllowedActions) so both paths return identically shaped payloads.
func (r unifiedTaskRow) toMap() map[string]any {
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
		// Actors as a parsed array mirrors Person (joined string) so the
		// detail popover and copy-summary can render actors without the
		// VideoInfo attachment (list/SSE payloads never include it).
		"Actors":           task_compute.ParseTagsColumn(r.Protagonist),
		"ImageCount":       r.ImageCount,
		"VideoCount":       r.VideoCount,
		"GalleryTotalSize": r.TotalSize,
		"Segment":          r.CompletedSegments,
		"TotalSegments":    r.TotalSegments,
		"Tags":             task_compute.ParseTagsColumn(r.Tags),
		"CreatedAt":        r.CreatedAt,
		"UpdatedAt":        r.UpdatedAt,
	})
}

var (
	taskStreamReplayEventTypes = []string{
		"task:created",
		"task:progress",
		"task:completed",
		"task:failed",
		"task:cancelled",
		"dag:nodeProgress",
		"dag:nodeStateChanged",
		"gallery:created",
		"gallery:stateChanged",
		"slot:stateChanged",
		"task:metadata",
	}
)

func (h *Handlers) TaskStreamSSE(w http.ResponseWriter, r *http.Request) {
	stream := sse.NewSSEStream(w)
	if stream == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	// Throttle progress events: at most one per task per 500ms, to prevent
	// SSE queue overflow from high-frequency progress updates.
	progressThrottle := newProgressThrottle(500 * time.Millisecond)
	cleanupTicker := time.NewTicker(5 * time.Minute)
	defer cleanupTicker.Stop()
	go func() {
		for range cleanupTicker.C {
			progressThrottle.Cleanup()
		}
	}()

	if h.DB != nil {
		// Lightweight pagination: only fetch the first page for initial snapshot.
		// Full data can be loaded via /api/tasks/page?page=N when user scrolls.
		// This avoids UNION ALL + ORDER BY on three large tables for the SSE path.
		ctx := r.Context()
		tasks := make([]map[string]any, 0, taskStreamInitialPageSize)

		// Query each table separately with LIMIT, then merge and sort.
		// Same optimization as TaskListUnified.

		// 1) Video tasks
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
			        dt.created_at, dt.updated_at
			 FROM download_tasks dt
			 LEFT JOIN video_infos vi ON dt.id = vi.task_id
			 ORDER BY dt.id DESC LIMIT ?`, taskStreamInitialPageSize)
		if err == nil {
			for videoRows.Next() {
				var r unifiedTaskRow
				if err := videoRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
					&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
					&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
					&r.DownloadedSize, &r.ContentVerified,
					&r.TotalSegments, &r.CompletedSegments,
					&r.CreatedAt, &r.UpdatedAt); err != nil {
					// Log rather than swallow: a scan failure once left the
					// initial snapshot silently missing rows.
					taskStreamLogger.Error("SSE initial snapshot: video row scan failed", err)
					continue
				}
				tasks = append(tasks, r.toMap())
			}
			videoRows.Close()
		} else {
			taskStreamLogger.Error("SSE initial snapshot: video tasks query failed", err)
		}

		// 2) Gallery tasks
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
			        created_at, updated_at
			 FROM galleries
			 ORDER BY id DESC LIMIT ?`, taskStreamInitialPageSize)
		if err == nil {
			for galleryRows.Next() {
				var r unifiedTaskRow
				if err := galleryRows.Scan(&r.TaskType, &r.ID, &r.URL, &r.Status, &r.Progress,
					&r.FilePath, &r.Format, &r.Priority, &r.ErrorMsg, &r.SiteID, &r.Seq,
					&r.Title, &r.Protagonist, &r.ImageCount, &r.VideoCount, &r.TotalSize,
					&r.DownloadedSize, &r.ContentVerified,
					&r.TotalSegments, &r.CompletedSegments,
					&r.CreatedAt, &r.UpdatedAt); err != nil {
					// Log rather than swallow: a scan failure once left the
					// initial snapshot silently missing rows.
					taskStreamLogger.Error("SSE initial snapshot: gallery row scan failed", err)
					continue
				}
				tasks = append(tasks, r.toMap())
			}
			galleryRows.Close()
		} else {
			taskStreamLogger.Error("SSE initial snapshot: gallery tasks query failed", err)
		}

	// NOTE: Sniff tasks excluded — independent pool via /api/sniff.

	// Merge sort by ID descending
		sort.Slice(tasks, func(i, j int) bool {
			idI, _ := tasks[i]["ID"].(int)
			idJ, _ := tasks[j]["ID"].(int)
			return idI > idJ
		})

		// Truncate to initial page size
		if len(tasks) > taskStreamInitialPageSize {
			tasks = tasks[:taskStreamInitialPageSize]
		}

		// Refine gallery progress asynchronously via file counting to
		// avoid blocking SSE connection establishment on slow disk I/O.
		galleriesToRefine := []map[string]any{}
		for _, t := range tasks {
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
			galleriesToRefine = append(galleriesToRefine, map[string]any{
				"savePath":      savePath,
				"totalExpected": totalExpected,
				"status":        status,
				"taskId":        t["ID"],
			})
		}

		// Calculate total count for pagination metadata
	totalCount := 0
	var galleryCount, videoCount int
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries").Scan(&galleryCount)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks").Scan(&videoCount)
	totalCount = galleryCount + videoCount

		// Send initial event with pagination metadata
		stream.SendEvent("initial", map[string]any{
			"tasks":      tasks,
			"totalCount": totalCount,
			"page":       1,
			"pageSize":   taskStreamInitialPageSize,
			"hasMore":    totalCount > len(tasks),
		})

		if len(galleriesToRefine) > 0 {
			go func(refinements []map[string]any, s *sse.SSEStream) {
				for _, r := range refinements {
					savePath, _ := r["savePath"].(string)
					totalExpected, _ := r["totalExpected"].(int)
					status, _ := r["status"].(string)
					taskID := r["taskId"]

					actualFiles := countFilesInDir(savePath)
					if actualFiles <= 0 {
						continue
					}
					progress := float64(actualFiles) / float64(totalExpected) * 100
					if progress > 99 && status != "completed" {
						progress = 99
					}
					if progress < 1 {
						progress = 1
					}
					s.TrySendEvent("task:progress", map[string]any{
						"taskId":   taskID,
						"taskType": "gallery",
						"progress": progress,
						"status":   status,
					})
				}
			}(galleriesToRefine, stream)
		}
	} else {
		stream.SendEvent("initial", map[string]any{
			"tasks":      []any{},
			"totalCount": 0,
			"page":       1,
			"pageSize":   taskStreamInitialPageSize,
			"hasMore":    false,
		})
	}

	// Business events use TrySendEvent (non-blocking) so a slow SSE client
	// cannot block the EventBus caller.
	if h.EventBus != nil {
		// ... existing event subscriptions ...
		unsubCreated := h.EventBus.On("task:created", func(payload any) {
			stream.TrySendEvent("task:created", payload)
		})

		unsubProgress := h.EventBus.On("task:progress", func(payload any) {
			// Throttle: at most one progress event per task per 500ms,
			// preventing SSE queue overflow from high-frequency updates.
			if m, ok := payload.(map[string]any); ok {
				taskID := task_compute.TaskIDKey(m)
				if !progressThrottle.Allow(taskID) {
					return // throttled: skip this progress event
				}
			}
			stream.TrySendEvent("task:progress", payload)
		})

		unsubCompleted := h.EventBus.On("task:completed", func(payload any) {
			stream.TrySendEvent("task:completed", payload)
		})

		unsubFailed := h.EventBus.On("task:failed", func(payload any) {
			stream.TrySendEvent("task:failed", payload)
		})

		unsubCancelled := h.EventBus.On("task:cancelled", func(payload any) {
			stream.TrySendEvent("task:cancelled", payload)
		})

		unsubNodeProg := h.EventBus.On("dag:nodeProgress", func(payload any) {
			stream.TrySendEvent("dag:nodeProgress", payload)
		})

		unsubNodeState := h.EventBus.On("dag:nodeStateChanged", func(payload any) {
			raw, _ := json.Marshal(payload)
			stream.TrySendEvent("dag:nodeStateChanged", json.RawMessage(raw))
		})

		unsubGalleryCreated := h.EventBus.On("gallery:created", func(payload any) {
			stream.TrySendEvent("gallery:created", payload)
		})

		unsubGalleryState := h.EventBus.On("gallery:stateChanged", func(payload any) {
			raw, _ := json.Marshal(payload)
			stream.TrySendEvent("gallery:stateChanged", json.RawMessage(raw))
		})

		unsubSlotState := h.EventBus.On("slot:stateChanged", func(payload any) {
			stream.TrySendEvent("slot:stateChanged", payload)
		})

		// StripPersonFromTitle is applied at the SSE forwarding layer so
		// all task:metadata events get titles cleaned uniformly.
		unsubMetadata := h.EventBus.On("task:metadata", func(payload any) {
			if m, ok := payload.(map[string]any); ok {
				title, _ := m["GalleryTitle"].(string)
				person, _ := m["Person"].(string)
				if title != "" && person != "" {
					m["GalleryTitle"] = task_compute.StripPersonFromTitle(title, person)
				}
			}
			stream.TrySendEvent("task:metadata", payload)
		})

		defer func() {
			unsubCreated()
			unsubProgress()
			unsubCompleted()
			unsubFailed()
			unsubCancelled()
			unsubNodeProg()
			unsubNodeState()
			unsubGalleryCreated()
			unsubGalleryState()
			unsubSlotState()
			unsubMetadata()
		}()

		// Replay last events after subscriptions are live to close the gap
		// between the initial snapshot and subscription activation.
		for _, eventType := range taskStreamReplayEventTypes {
			payload := h.EventBus.GetLastEvent(eventType)
			if payload == nil {
				continue
			}
			if eventType == "task:metadata" {
				if m, ok := payload.(map[string]any); ok {
					title, _ := m["GalleryTitle"].(string)
					person, _ := m["Person"].(string)
					if title != "" && person != "" {
						m["GalleryTitle"] = task_compute.StripPersonFromTitle(title, person)
					}
				}
			}
			stream.TrySendEvent(eventType, payload)
		}
	}

	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				stream.TrySendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
			}
		}
	}()
	defer func() {
		<-heartbeatDone
		stream.Close()
	}()
	<-r.Context().Done()
}

// countFilesInDir counts regular files in a directory tree, excluding
// the segments/ subdirectory to avoid inflating the count.
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
