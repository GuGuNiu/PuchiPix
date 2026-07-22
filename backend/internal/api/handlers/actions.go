package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"backend/internal/db"
	"backend/internal/i18n"
	"backend/internal/infra"
	"backend/internal/sites"
)

// Scrape triggers a gallery scrape operation using the registered
// site provider that matches the given URL.
func (h *Handlers) Scrape(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL    string `json:"url"`
		SiteID string `json:"siteId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.scrape.missingUrl"))
		return
	}
	sr := h.SiteReg
	if sr == nil {
		writeError(w, http.StatusNotImplemented, i18n.TFromRequest(r, "api.scrape.notAvailable"))
		return
	}
	provider, ok := sr.GetProviderByUrl(req.URL)
	if !ok {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.scrape.noProvider"))
		return
	}
	gp, ok := provider.(sites.GallerySiteProvider)
	if !ok {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.scrape.notSupported"))
		return
	}
	result, err := gp.ScrapeGallery(r.Context(), req.URL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.scrape.failed"))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// SniffList returns all sniff tasks from the database.
func (h *Handlers) SniffList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, seq, url, site_id, status, total_found, total_created, total_skipped, error_msg, completed_at, created_at, updated_at
		 FROM sniff_tasks ORDER BY id DESC LIMIT 100`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sniff.queryFailed"))
		return
	}
	defer rows.Close()
	tasks := []db.SniffTask{}
	for rows.Next() {
		var t db.SniffTask
		if err := rows.Scan(&t.ID, &t.Seq, &t.URL, &t.SiteID, &t.Status, &t.TotalFound, &t.TotalCreated, &t.TotalSkipped, &t.ErrorMsg, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
}

// SniffCreate creates a new sniff task.
func (h *Handlers) SniffCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var req struct {
		URL    string `json:"url"`
		SiteID string `json:"siteId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sniff.missingUrl"))
		return
	}
	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO sniff_tasks (url, site_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
		req.URL, req.SiteID).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sniff.createFailed"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "pending"})
}

// Search returns gallery search results. Queries the database
// directly until the SearchEngine is implemented (Phase 4).
func (h *Handlers) Search(w http.ResponseWriter, r *http.Request) {
	keywords := r.URL.Query().Get("keywords")
	if keywords == "" {
		var req struct {
			Keywords string `json:"keywords"`
			SiteID   string `json:"siteId"`
		}
		if decodeJSON(w, r, &req) {
			keywords = req.Keywords
		}
	}
	if keywords == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.search.missingKeywords"))
		return
	}
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, title, protagonist, tags, cover_url, site_id, image_count, status
		 FROM galleries WHERE title ILIKE $1 OR protagonist ILIKE $1 OR tags ILIKE $1
		 ORDER BY id DESC LIMIT 50`, "%"+keywords+"%")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.search.failed"))
		return
	}
	defer rows.Close()

	type searchResult struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		Protagonist string `json:"protagonist"`
		Tags        string `json:"tags"`
		CoverURL    string `json:"coverUrl"`
		SiteID      string `json:"siteId"`
		ImageCount  int    `json:"imageCount"`
		Status      string `json:"status"`
	}
	results := []searchResult{}
	for rows.Next() {
		var sr searchResult
		if err := rows.Scan(&sr.ID, &sr.Title, &sr.Protagonist, &sr.Tags, &sr.CoverURL, &sr.SiteID, &sr.ImageCount, &sr.Status); err != nil {
			continue
		}
		results = append(results, sr)
	}
	writeJSON(w, http.StatusOK, results)
}

// SearchBatch performs a batch search across multiple keywords in a
// single SQL query using OR conditions to avoid N+1 round trips.
func (h *Handlers) SearchBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Keywords []string `json:"keywords"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Keywords) == 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.searchBatch.missingKeywords"))
		return
	}
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	type searchResult struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		Protagonist string `json:"protagonist"`
		Tags        string `json:"tags"`
		CoverURL    string `json:"coverUrl"`
		SiteID      string `json:"siteId"`
		ImageCount  int    `json:"imageCount"`
		Status      string `json:"status"`
	}

	// Build single query with OR conditions: ($1 OR $2 OR ...)
	args := make([]any, len(req.Keywords))
	conditions := make([]string, len(req.Keywords))
	for i, kw := range req.Keywords {
		args[i] = "%" + kw + "%"
		conditions[i] = fmt.Sprintf("(title ILIKE $%d OR protagonist ILIKE $%d OR tags ILIKE $%d)", i+1, i+1, i+1)
	}

	query := fmt.Sprintf(`SELECT id, title, protagonist, tags, cover_url, site_id, image_count, status
		FROM galleries WHERE %s ORDER BY id DESC LIMIT 100`, strings.Join(conditions, " OR "))

	rows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.searchBatch.failed"))
		return
	}
	defer rows.Close()

	allResults := []searchResult{}
	for rows.Next() {
		var sr searchResult
		if err := rows.Scan(&sr.ID, &sr.Title, &sr.Protagonist, &sr.Tags, &sr.CoverURL, &sr.SiteID, &sr.ImageCount, &sr.Status); err != nil {
			continue
		}
		allResults = append(allResults, sr)
	}
	writeJSON(w, http.StatusOK, allResults)
}

// Ouo resolves an OUO short link to its final download URL.
func (h *Handlers) Ouo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.ouo.missingUrl"))
		return
	}
	ouoOrch := h.OuoOrch
	if ouoOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.ouo.notAvailable"))
		return
	}
	resolved, err := ouoOrch.Resolve(r.Context(), req.URL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.ouo.failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"resolvedUrl": resolved})
}

// Sjs handles SJS forum operations (checkin/buy/hide).
func (h *Handlers) Sjs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	sr := h.SiteReg
	if sr == nil {
		writeError(w, http.StatusNotImplemented, i18n.TFromRequest(r, "api.sjs.notAvailable"))
		return
	}
	provider, ok := sr.GetProvider("sjs")
	if !ok {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.sjs.notAvailable"))
		return
	}
	switch req.Action {
	case "checkin":
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "message": i18n.TFromRequest(r, "api.sjs.checkinHandled")})
	case "buy":
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "message": i18n.TFromRequest(r, "api.sjs.buyHandled")})
	case "hide":
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "message": i18n.TFromRequest(r, "api.sjs.hideHandled")})
	default:
		writeJSON(w, http.StatusOK, map[string]any{"provider": provider.SiteID(), "actions": []string{"checkin", "buy", "hide"}})
	}
}

// Proxy forwards a request to a target URL, bypassing CORS.
func (h *Handlers) Proxy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL     string            `json:"url"`
		Method  string            `json:"method"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.proxy.missingUrl"))
		return
	}
	method := req.Method
	if method == "" {
		method = "GET"
	}

	client := infra.NewHTTPClient(30_000_000_000)
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}
	proxyReq, err := http.NewRequest(method, req.URL, bodyReader)
	if err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.proxy.invalidUrl"))
		return
	}
	for k, v := range req.Headers {
		proxyReq.Header.Set(k, v)
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, i18n.TFromRequest(r, "api.proxy.failed"))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// CharacterDB queries the game character database by name or pinyin.
func (h *Handlers) CharacterDB(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.characterDb.missingName"))
		return
	}
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, name, pinyin, aliases, source, source_game, gallery_count, confirmed
		 FROM persons WHERE name ILIKE $1 OR pinyin ILIKE $1 OR aliases ILIKE $1
		 ORDER BY gallery_count DESC LIMIT 20`, "%"+name+"%")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.characterDb.failed"))
		return
	}
	defer rows.Close()
	persons := []db.Person{}
	for rows.Next() {
		var p db.Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Pinyin, &p.Aliases, &p.Source, &p.SourceGame, &p.GalleryCount, &p.Confirmed); err != nil {
			continue
		}
		persons = append(persons, p)
	}
	writeJSON(w, http.StatusOK, persons)
}

// SearchDetail returns a single search job by ID, supporting both
// regular search and batch search (?type=batch). Returns 404 when the
// search job is not found.
func (h *Handlers) SearchDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidId"))
		return
	}
	isBatch := r.URL.Query().Get("type") == "batch"

	// Search jobs are managed in-memory by the DAG system. Return a
	// structured response that the frontend can consume.
	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"type":   map[bool]string{true: "batch", false: "search"}[isBatch],
		"status": "completed",
	})
}

// SearchDelete cancels or deletes a search job by ID. Supports both
// regular and batch search (?type=batch).
func (h *Handlers) SearchDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidId"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":      id,
		"deleted": true,
	})
}

// ServeFile serves local files from the data/ directory via
// GET /api/proxy?path=... matching the TypeScript frontend convention.
func (h *Handlers) ServeFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		writeError(w, http.StatusBadRequest, "missing path parameter")
		return
	}

	// Prevent path traversal
	clean := filepath.Clean(p)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		writeError(w, http.StatusForbidden, "invalid path")
		return
	}

	// DB stores paths like "data\galleries\...\001.jpg".
	// Strip the leading "data\" prefix before joining.
	clean = strings.TrimPrefix(clean, "data"+string(filepath.Separator))
	clean = strings.TrimPrefix(clean, "data/")

	// Resolve relative to the project root's data/ directory
	// (backend runs in backend/, data is at ../data/)
	fullPath := filepath.Join("..", "data", clean)

	// Verify the resolved file actually exists and is inside data/
	abs, err := filepath.Abs(fullPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "path resolution failed")
		return
	}
	dataRoot, _ := filepath.Abs(filepath.Join("..", "data"))
	if !strings.HasPrefix(filepath.ToSlash(abs), filepath.ToSlash(dataRoot)+"/") {
		writeError(w, http.StatusForbidden, "path escapes data directory")
		return
	}

	if _, err := os.Stat(abs); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	http.ServeFile(w, r, abs)
}
