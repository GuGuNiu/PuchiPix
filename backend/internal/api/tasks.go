package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"backend/internal/db"
	"backend/internal/downloader/video"
	"backend/internal/i18n"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/sites"
	"backend/internal/urlutil"
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

	// URL normalization: clean invisible characters (zero-width, BOM,
	// newlines) and normalize the URL (lowercase hostname, http→https,
	// strip trailing slash, sort query params, remove fragment) for
	// consistent dedup matching. Ports TS cleanUrl() + normalizeUrl().
	cleanedURL := urlutil.CleanURL(req.URL)
	normalizedURL := urlutil.NormalizeURL(cleanedURL)

	// Gallery URL routing: if the URL matches a gallery provider
	// (e.g. aimeizizi/lovecutes.net), create a gallery record and
	// submit a gallery DAG pipeline (scrape → download → extract →
	// verify) instead of a video download task. This mirrors the TS
	// implementation's getGalleryProvider() routing that was lost
	// during the Go migration.
	if h.SiteReg != nil && !strings.HasSuffix(cleanedURL, ".m3u8") {
		if provider, ok := h.SiteReg.GetProviderByUrl(cleanedURL); ok {
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
	}

	if req.Format == "" {
		req.Format = "mp4"
	}
	if req.Priority == 0 {
		req.Priority = 1
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
		generated := newSeq()
		seqPtr = &generated
	}

	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO download_tasks (url, m3u8_url, status, progress, file_path, format, priority, error_msg, seq)
		 VALUES ($1, '', 'pending', 0, '', $2, $3, '', $4)
		 RETURNING id`,
		normalizedURL, req.Format, req.Priority, seqPtr).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	// Emit task:created so SSE clients receive real-time upsert
	if h.EventBus != nil {
		now := time.Now()
		h.EventBus.Emit("task:created", db.DownloadTask{
			ID:        id,
			URL:       normalizedURL,
			Status:    "pending",
			Progress:  0,
			Format:    req.Format,
			Priority:  req.Priority,
			Seq:       seqPtr,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{"ID": id, "DisplayID": *seqPtr, "Status": "pending"})
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
		generated := newSeq()
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
		 VALUES ($1, $2, $3, $4, 'pending', 'pending')
		 RETURNING id`,
		seqPtr, normalizedURL, siteID, scrapedDomain).Scan(&galleryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
	}

	// Submit gallery DAG pipeline for scraping + downloading.
	dagID := ""
	if h.DagOrch != nil {
		var def orchestrator.DagDefinition
		if h.DagFactory != nil {
			def = h.DagFactory.NewGalleryPipeline(normalizedURL, siteID, galleryID)
		} else {
			def = dag.NewDagFactory().NewGalleryPipeline(normalizedURL, siteID, galleryID)
		}
		dagID, _ = h.DagOrch.SubmitDag(r.Context(), def)
	}

	// Emit gallery:created event for SSE clients (PascalCase keys
	// for consistency with task:created and SSE initial events).
	if h.EventBus != nil {
		h.EventBus.Emit("gallery:created", map[string]any{
			"GalleryID":  galleryID,
			"SourceURL":  normalizedURL,
			"SiteID":     siteID,
			"Status":     "pending",
			"DagID":      dagID,
			"DisplayID":  *seqPtr,
			"TaskType":   "gallery",
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"Type":      "gallery",
		"GalleryID": galleryID,
		"DisplayID": *seqPtr,
		"Status":    "pending",
		"DagID":     dagID,
	})
}

// createSniffTask handles listing page URL submission by creating a
// sniff task record in the database. This mirrors the TS implementation's
// isListingPage() → sniff task → scrapeListingAndEnqueue() routing that
// was lost during the Go migration.
//
// Currently creates the sniff task record and returns it to the client.
// The actual listing-page crawl is handled by a separate sniff DAG pipeline
// (to be wired in a future iteration).
func (h *Handlers) createSniffTask(w http.ResponseWriter, r *http.Request, pageURL, siteID, userSeq string) {
	var seqPtr *string
	if userSeq != "" {
		seqPtr = &userSeq
	} else {
		generated := newSeq()
		seqPtr = &generated
	}

	var sniffID int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO sniff_tasks (seq, url, site_id, status)
		 VALUES ($1, $2, $3, 'pending')
		 RETURNING id`,
		seqPtr, pageURL, siteID).Scan(&sniffID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.createFailed"))
		return
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
			"CreatedAt":  time.Now(),
			"UpdatedAt":  time.Now(),
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"Type":      "sniff",
		"SniffID":   sniffID,
		"DisplayID": *seqPtr,
		"Status":    "pending",
		"URL":       pageURL,
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
		`SELECT id, status, seq FROM download_tasks WHERE url = $1 LIMIT 1`,
		normalizedURL).Scan(&existingID, &existingStatus, &existingSeq)
	if err == nil {
		seqStr := ""
		if existingSeq != nil {
			seqStr = *existingSeq
		}
		return map[string]any{
			"Type":           "video",
			"MatchType":      "exact",
			"TaskID":         existingID,
			"ExistingStatus": existingStatus,
			"ExistingUrl":    normalizedURL,
			"DisplayID":      seqStr,
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
					`SELECT id, status, seq FROM download_tasks WHERE url = $1 LIMIT 1`,
					mirrorURL).Scan(&existingID, &existingStatus, &existingSeq)
				if err == nil {
					seqStr := ""
					if existingSeq != nil {
						seqStr = *existingSeq
					}
					return map[string]any{
						"Type":           "video",
						"MatchType":      "mirror",
						"TaskID":         existingID,
						"ExistingStatus": existingStatus,
						"ExistingUrl":    mirrorURL,
						"DisplayID":      seqStr,
					}
				}
			}
		}
	}

	// Tier 3: Path-signature match (domain-agnostic).
	signature := urlutil.GetURLSignature(normalizedURL)
	if len(signature) > 1 {
		rows, err := h.DB.Query(ctx,
			`SELECT id, status, seq, url FROM download_tasks WHERE url LIKE '%' || $1 LIMIT 5`,
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
						"Type":           "video",
						"MatchType":      "path",
						"TaskID":         id,
						"ExistingStatus": status,
						"ExistingUrl":    dbURL,
						"DisplayID":      seqStr,
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
		`SELECT id, status, seq, COALESCE(title, '') FROM galleries WHERE source_url = $1 LIMIT 1`,
		normalizedURL).Scan(&galleryID, &galleryStatus, &gallerySeq, &galleryTitle)
	if err == nil {
		seqStr := ""
		if gallerySeq != nil {
			seqStr = *gallerySeq
		}
		return map[string]any{
			"Type":           "gallery",
			"MatchType":      "exact",
			"GalleryID":      galleryID,
			"ExistingStatus": galleryStatus,
			"ExistingUrl":    normalizedURL,
			"ExistingTitle":  galleryTitle,
			"DisplayID":      seqStr,
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
					`SELECT id, status, seq, COALESCE(title, '') FROM galleries WHERE source_url = $1 LIMIT 1`,
					mirrorURL).Scan(&galleryID, &galleryStatus, &gallerySeq, &galleryTitle)
				if err == nil {
					seqStr := ""
					if gallerySeq != nil {
						seqStr = *gallerySeq
					}
					return map[string]any{
						"Type":           "gallery",
						"MatchType":      "mirror",
						"GalleryID":      galleryID,
						"ExistingStatus": galleryStatus,
						"ExistingUrl":    mirrorURL,
						"ExistingTitle":  galleryTitle,
						"DisplayID":      seqStr,
					}
				}
			}
		}
	}

	// Tier 3: Path-signature match.
	signature := urlutil.GetURLSignature(normalizedURL)
	if len(signature) > 1 {
		rows, err := h.DB.Query(ctx,
			`SELECT id, status, seq, COALESCE(title, ''), source_url FROM galleries WHERE source_url LIKE '%' || $1 LIMIT 5`,
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
						"Type":           "gallery",
						"MatchType":      "path",
						"GalleryID":      id,
						"ExistingStatus": status,
						"ExistingUrl":    dbURL,
						"ExistingTitle":  title,
						"DisplayID":      seqStr,
					}
				}
			}
		}
	}

	return nil
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
		// Cancel current download and re-submit through DAG.
		h.DownloadMgr.CancelDownload(id)
		dagID, err := h.submitVideoDag(r, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.retryFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "dagId": dagID, "status": "retrying"})

	default:
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.tasks.unknownAction")+" "+req.Action)
	}
}

// submitVideoDag builds a video download DAG via the centralized
// DagFactory and submits it to the orchestrator. Falls back to the
// legacy direct DownloadManager path when the DAG system is unavailable.
func (h *Handlers) submitVideoDag(r *http.Request, taskID int) (string, error) {
	if h.DagOrch == nil {
		go h.DownloadMgr.StartDownload(r.Context(), video.DownloadTaskInput{ID: taskID})
		return "", fmt.Errorf("DAG orchestrator not available, using legacy path")
	}

	var def orchestrator.DagDefinition
	if h.DagFactory != nil {
		def = h.DagFactory.NewVideoPipeline(taskID)
	} else {
		// Ad-hoc fallback when factory not injected.
		def = dag.NewDagFactory().NewVideoPipeline(taskID)
	}

	return h.DagOrch.SubmitDag(r.Context(), def)
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
	result, err := h.DB.Exec(ctx,
		"UPDATE galleries SET status = 'completed', error_msg = '', updated_at = CURRENT_TIMESTAMP WHERE status IN ('failed', 'scraping')")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("update failed: %v", err))
		return
	}

	var completed, failed, scraping int
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'completed'").Scan(&completed)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'failed'").Scan(&failed)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries WHERE status = 'scraping'").Scan(&scraping)

	writeJSON(w, http.StatusOK, map[string]any{
		"reset":     result.RowsAffected(),
		"completed": completed,
		"failed":    failed,
		"scraping":  scraping,
	})
}

// TaskDelete removes a download task from the database.
func (h *Handlers) TaskDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	result, err := h.DB.Exec(r.Context(),
		"DELETE FROM download_tasks WHERE id = $1", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.tasks.deleteFailed"))
		return
	}
	if rows := result.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.tasks.notFound"))
		return
	}

	// Emit task:cancelled so SSE notifies clients
	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{"taskId": id})
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}
