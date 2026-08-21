package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"backend/internal/db"
	"backend/internal/api/internal/image"
	"backend/internal/i18n"
	"backend/internal/idgen"
	"backend/internal/infra"
	"backend/internal/orchestrator/dag"
	"backend/internal/sites"
)

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

// Scrape routes a gallery scrape through the DAG orchestrator for slot pool
// concurrency control instead of invoking the provider directly.
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
	_, ok = provider.(sites.GallerySiteProvider)
	if !ok {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.scrape.notSupported"))
		return
	}

	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.scrape.notAvailable"))
		return
	}

	dagID, err := h.submitScrapeDag(r, req.URL, provider.SiteID())
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.scrape.failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dagId":  dagID,
		"status": "queued",
		"url":    req.URL,
	})
}

func (h *Handlers) submitScrapeDag(r *http.Request, url, siteID string) (string, error) {
	def := dag.NewDagFactory().NewScrapeTask(url, siteID)

	return h.DagOrch.SubmitDag(r.Context(), def)
}

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
	var completedAt, ca, ua db.SQLTime
	for rows.Next() {
		var t db.SniffTask
		if err := rows.Scan(&t.ID, &t.Seq, &t.URL, &t.SiteID, &t.Status, &t.TotalFound, &t.TotalCreated, &t.TotalSkipped, &t.ErrorMsg, &completedAt, &ca, &ua); err != nil {
			continue
		}
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
}

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
	seq := idgen.GenerateID()
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO sniff_tasks (seq, url, site_id, status) VALUES (?, ?, ?, 'pending') RETURNING id`,
		seq, req.URL, req.SiteID).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sniff.createFailed"))
		return
	}

	dagID := ""
	if h.DagOrch != nil {
		def := dag.NewDagFactory().NewSniffPipeline(req.URL, id)
		var submitErr error
		dagID, submitErr = h.DagOrch.SubmitDag(r.Context(), def)
		if submitErr != nil {
		h.DB.Exec(r.Context(),
			"UPDATE sniff_tasks SET status = 'failed', error_msg = ? WHERE id = ?",
			"DAG submission failed: "+submitErr.Error(), id)
		if h.EventBus != nil {
			h.EventBus.Emit("task:failed", map[string]any{
				"taskId":   id,
				"taskType": "sniff",
				"error":    "DAG submission failed: " + submitErr.Error(),
			})
		}
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sniff.createFailed"))
			return
		}
		h.DB.Exec(r.Context(), "UPDATE sniff_tasks SET dag_id = ? WHERE id = ?", dagID, id)
	}

	if h.EventBus != nil {
		h.EventBus.Emit("task:created", map[string]any{
			"ID":        id,
			"DisplayID": seq,
			"URL":       req.URL,
			"Status":    "pending",
			"TaskType":  "sniff",
			"SiteID":    req.SiteID,
			"DagID":     dagID,
		})
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":     id,
		"seq":    seq,
		"status": "pending",
		"dagId":  dagID,
	})
}

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
		 FROM galleries WHERE title LIKE ? OR protagonist LIKE ? OR tags LIKE ?
		 ORDER BY id DESC LIMIT 50`, "%"+keywords+"%", "%"+keywords+"%", "%"+keywords+"%")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.search.failed"))
		return
	}
	defer rows.Close()

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

	args := make([]any, 0, len(req.Keywords)*3)
	conditions := make([]string, len(req.Keywords))
	for i, kw := range req.Keywords {
		pat := "%" + kw + "%"
		args = append(args, pat, pat, pat)
		conditions[i] = "(title LIKE ? OR protagonist LIKE ? OR tags LIKE ?)"
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
		 FROM persons WHERE name LIKE ? OR pinyin LIKE ? OR aliases LIKE ?
		 ORDER BY gallery_count DESC LIMIT 20`, "%"+name+"%", "%"+name+"%", "%"+name+"%")
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

func (h *Handlers) GameCharacters(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, name, pinyin, aliases, game_name, game_name_en
		 FROM game_characters
		 ORDER BY game_name, name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query game_characters failed")
		return
	}
	defer rows.Close()

	type charEntry struct {
		ID         int      `json:"id"`
		Name       string   `json:"name"`
		Pinyin     string   `json:"pinyin"`
		Aliases    []string `json:"aliases"`
		GameName   string   `json:"gameName"`
		GameNameEn string   `json:"gameNameEn"`
	}

	type gameGroup struct {
		GameName   string      `json:"gameName"`
		GameNameEn string      `json:"gameNameEn"`
		Characters []charEntry `json:"characters"`
	}

	gameMap := make(map[string]*gameGroup)
	var gameOrder []string

	for rows.Next() {
		var c charEntry
		var aliasesJSON string
		if err := rows.Scan(&c.ID, &c.Name, &c.Pinyin, &aliasesJSON, &c.GameName, &c.GameNameEn); err != nil {
			continue
		}
		if aliasesJSON != "" && aliasesJSON != "[]" {
			aliasesStr := strings.Trim(aliasesJSON, "[]")
			for _, a := range strings.Split(aliasesStr, ",") {
				a = strings.Trim(strings.TrimSpace(a), "\"")
				if a != "" {
					c.Aliases = append(c.Aliases, a)
				}
			}
		}

		key := c.GameName
		if _, ok := gameMap[key]; !ok {
			gameMap[key] = &gameGroup{
				GameName:   c.GameName,
				GameNameEn: c.GameNameEn,
			}
			gameOrder = append(gameOrder, key)
		}
		gameMap[key].Characters = append(gameMap[key].Characters, c)
	}

	var result []gameGroup
	for _, key := range gameOrder {
		result = append(result, *gameMap[key])
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *Handlers) ServeFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		writeError(w, http.StatusBadRequest, "missing path parameter")
		return
	}

	abs := image.ResolveDataPath(p)
	if abs == "" {
		writeError(w, http.StatusForbidden, "invalid path")
		return
	}

	if _, err := os.Stat(abs); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	width := image.QueryWidth(r)
	image.ServeResizedImage(w, r, abs, width)
}

func (h *Handlers) SniffDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.sniff.missingId"))
		return
	}
	if _, err := h.DB.Exec(r.Context(), "DELETE FROM sniff_tasks WHERE id = ?", idStr); err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.sniff.deleteFailed"))
		return
	}
	if h.EventBus != nil {
		h.EventBus.Emit("task:cancelled", map[string]any{
			"taskId":   idStr,
			"taskType": "sniff",
		})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) SjsShelfCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var req struct {
		URLs []string `json:"urls"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	type sjsImportResult struct {
		URL    string `json:"url"`
		Status string `json:"status"`
	}
	results := make([]sjsImportResult, 0, len(req.URLs))
	created, skipped := 0, 0
	for _, u := range req.URLs {
		if u == "" {
			continue
		}
		res, err := h.DB.Exec(r.Context(),
			"INSERT INTO sjs_bookmarks (url, title) VALUES (?, '') ON CONFLICT (url) DO NOTHING", u)
		if err != nil {
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			created++
			results = append(results, sjsImportResult{URL: u, Status: "created"})
		} else {
			skipped++
			results = append(results, sjsImportResult{URL: u, Status: "skipped"})
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"results": results,
		"summary": map[string]int{
			"total":   len(results),
			"created": created,
			"skipped": skipped,
			"failed":  0,
		},
	})
}

func (h *Handlers) SjsShelfDelete(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "all" {
		if _, err := h.DB.Exec(r.Context(), "DELETE FROM sjs_bookmarks"); err != nil {
			writeError(w, http.StatusInternalServerError, "delete all failed")
			return
		}
	} else if idStr != "" {
		if _, err := h.DB.Exec(r.Context(), "DELETE FROM sjs_bookmarks WHERE id = ?", idStr); err != nil {
			writeError(w, http.StatusInternalServerError, "delete failed")
			return
		}
		if h.EventBus != nil {
			h.EventBus.Emit("task:cancelled", map[string]any{
				"taskId":   idStr,
				"taskType": "sjs",
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
