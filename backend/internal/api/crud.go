﻿package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"database/sql"

	"backend/internal/db"
	"backend/internal/i18n"
)

// AccountsList returns all site accounts (passwords redacted).
func (h *Handlers) AccountsList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, site_id, username, domain, status, cookie_prefix, last_login_at, last_used_at, fail_count, remark, created_at, updated_at
		 FROM site_accounts ORDER BY id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.accounts.queryFailed"))
		return
	}
	defer rows.Close()

	type accountView struct {
		db.SiteAccount
		Password string `json:"-"`
	}
	result := []accountView{}
	for rows.Next() {
		var a db.SiteAccount
		// Scan timestamps into strings (TEXT cannot scan into time.Time
		// with modernc.org/sqlite — P-TSG time-column pitfall).
		var lastLogin, lastUsed, ca, ua db.SQLTime
		if err := rows.Scan(&a.ID, &a.SiteID, &a.Username, &a.Domain, &a.Status, &a.CookiePrefix, &lastLogin, &lastUsed, &a.FailCount, &a.Remark, &ca, &ua); err != nil {
			continue
		}
		result = append(result, accountView{SiteAccount: a})
	}
	writeJSON(w, http.StatusOK, result)
}

// AccountsCreate creates a new site account.
func (h *Handlers) AccountsCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var a db.SiteAccount
	if !decodeJSON(w, r, &a) {
		return
	}
	if a.SiteID == "" || a.Username == "" || a.Password == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.accounts.missingFields"))
		return
	}
	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO site_accounts (site_id, username, password, domain, status, auth_cookies, cookie_prefix, fail_count, remark)
		 VALUES (?, ?, ?, ?, ?, '', '', 0, '')
		 RETURNING id`,
		a.SiteID, a.Username, a.Password, a.Domain, a.Status).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.accounts.createFailed"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// AccountsUpdate updates a site account by ID.
func (h *Handlers) AccountsUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	var a db.SiteAccount
	if !decodeJSON(w, r, &a) {
		return
	}
	_, err := h.DB.Exec(r.Context(),
		`UPDATE site_accounts SET username=?, password=?, domain=?, status=?, remark=? WHERE id=?`,
		a.Username, a.Password, a.Domain, a.Status, a.Remark, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.accounts.updateFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "updated": true})
}

// AccountsDelete deletes a site account by ID.
func (h *Handlers) AccountsDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	_, err := h.DB.Exec(r.Context(), "DELETE FROM site_accounts WHERE id=?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.accounts.deleteFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// PersonsList returns all persons with optional search.
func (h *Handlers) PersonsList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	search := r.URL.Query().Get("search")
	var rows *sql.Rows
	var err error
	if search != "" {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, name, pinyin, aliases, source, source_game, gallery_count, confirmed, created_at, updated_at
				 FROM persons WHERE name LIKE ? OR pinyin LIKE ? OR aliases LIKE ? ORDER BY name LIMIT 100`,
			"%"+search+"%", "%"+search+"%", "%"+search+"%")
	} else {
		rows, err = h.DB.Query(r.Context(),
			`SELECT id, name, pinyin, aliases, source, source_game, gallery_count, confirmed, created_at, updated_at
			 FROM persons ORDER BY name LIMIT 100`)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.persons.queryFailed"))
		return
	}
	defer rows.Close()

	persons := []db.Person{}
	for rows.Next() {
		var p db.Person
		// Scan timestamps into strings (TEXT cannot scan into time.Time
		// with modernc.org/sqlite — P-TSG time-column pitfall).
		var ca, ua db.SQLTime
		if err := rows.Scan(&p.ID, &p.Name, &p.Pinyin, &p.Aliases, &p.Source, &p.SourceGame, &p.GalleryCount, &p.Confirmed, &ca, &ua); err != nil {
			continue
		}
		persons = append(persons, p)
	}
	writeJSON(w, http.StatusOK, persons)
}

// PersonsCreate creates a new person.
func (h *Handlers) PersonsCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var p db.Person
	if !decodeJSON(w, r, &p) {
		return
	}
	if p.Name == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.persons.missingName"))
		return
	}
	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO persons (name, pinyin, aliases, source, source_game, gallery_count, confirmed)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 RETURNING id`,
		p.Name, p.Pinyin, p.Aliases, p.Source, p.SourceGame, p.GalleryCount, p.Confirmed).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.persons.createFailed"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// PersonsUpdate updates a person by ID.
func (h *Handlers) PersonsUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	var p db.Person
	if !decodeJSON(w, r, &p) {
		return
	}
	_, err := h.DB.Exec(r.Context(),
		`UPDATE persons SET name=?, pinyin=?, aliases=?, source_game=?, gallery_count=?, confirmed=? WHERE id=?`,
		p.Name, p.Pinyin, p.Aliases, p.SourceGame, p.GalleryCount, p.Confirmed, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.persons.updateFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "updated": true})
}

// PersonsDelete deletes a person by ID.
func (h *Handlers) PersonsDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	_, err := h.DB.Exec(r.Context(), "DELETE FROM persons WHERE id=?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.persons.deleteFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// BlocklistList returns all blocklist rules.
func (h *Handlers) BlocklistList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(),
		`SELECT id, site_id, field_type, keyword, match_mode, enabled, remark, created_at, updated_at
		 FROM blocklist_rules ORDER BY id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.blocklist.queryFailed"))
		return
	}
	defer rows.Close()

	rules := []db.BlocklistRule{}
	for rows.Next() {
		// Scan timestamps into strings (TEXT cannot scan into time.Time
		// with modernc.org/sqlite — P-TSG time-column pitfall). The
		// frontend does not consume createdAt/updatedAt.
		var br db.BlocklistRule
		var ca, ua db.SQLTime
		if err := rows.Scan(&br.ID, &br.SiteID, &br.FieldType, &br.Keyword, &br.MatchMode, &br.Enabled, &br.Remark, &ca, &ua); err != nil {
			continue
		}
		rules = append(rules, br)
	}
	writeJSON(w, http.StatusOK, rules)
}

// BlocklistCreate creates a new blocklist rule.
func (h *Handlers) BlocklistCreate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var br db.BlocklistRule
	if !decodeJSON(w, r, &br) {
		return
	}
	if br.FieldType == "" || br.Keyword == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.blocklist.missingFields"))
		return
	}
	var id int
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO blocklist_rules (site_id, field_type, keyword, match_mode, enabled, remark)
		 VALUES (?, ?, ?, ?, ?, ?)
		 RETURNING id`,
		br.SiteID, br.FieldType, br.Keyword, br.MatchMode, br.Enabled, br.Remark).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.blocklist.createFailed"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// BlocklistUpdate updates a blocklist rule by ID.
func (h *Handlers) BlocklistUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	var br db.BlocklistRule
	if !decodeJSON(w, r, &br) {
		return
	}
	_, err := h.DB.Exec(r.Context(),
		`UPDATE blocklist_rules SET site_id=?, field_type=?, keyword=?, match_mode=?, enabled=?, remark=? WHERE id=?`,
		br.SiteID, br.FieldType, br.Keyword, br.MatchMode, br.Enabled, br.Remark, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.blocklist.updateFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "updated": true})
}

// BlocklistDelete deletes blocklist rules. Supports both a single ID
// via path parameter (/api/blocklist/{id}) and query parameter forms
// used by the frontend:
//   - DELETE /api/blocklist?id=123        (single delete)
//   - DELETE /api/blocklist?ids=1,2,3      (batch delete)
//
// Input validation (400) takes priority over database availability
// (503) so that clients get the most specific error first.
func (h *Handlers) BlocklistDelete(w http.ResponseWriter, r *http.Request) {
	// Check query params first (frontend uses ?id= or ?ids=)
	if idStr := r.URL.Query().Get("id"); idStr != "" {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidId"))
			return
		}
		if h.DB == nil {
			writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
			return
		}
		_, execErr := h.DB.Exec(r.Context(), "DELETE FROM blocklist_rules WHERE id=?", id)
		if execErr != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.blocklist.deleteFailed"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
		return
	}

	if idsStr := r.URL.Query().Get("ids"); idsStr != "" {
		if h.DB == nil {
			writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
			return
		}
		parts := strings.Split(idsStr, ",")
		deleted := 0
		for _, part := range parts {
			id, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				continue
			}
			_, execErr := h.DB.Exec(r.Context(), "DELETE FROM blocklist_rules WHERE id=?", id)
			if execErr == nil {
				deleted++
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
		return
	}

	// Fallback to path parameter: /api/blocklist/{id}
	// Validate ID format BEFORE checking DB so invalid IDs get 400, not 503.
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	_, err := h.DB.Exec(r.Context(), "DELETE FROM blocklist_rules WHERE id=?", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.blocklist.deleteFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// ConfigList returns all application config key-value pairs.
func (h *Handlers) ConfigList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	rows, err := h.DB.Query(r.Context(), "SELECT id, key, value, created_at, updated_at FROM app_configs ORDER BY key")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.queryFailed"))
		return
	}
	defer rows.Close()
	// Flat key->value map matching the frontend contract
	// (e.g. {chromedriver_path: "..."}); the frontend config page reads
	// data?.<key> directly. Previously a bare array was returned, which
	// the frontend could never consume (F6).
	configs := map[string]any{}
	for rows.Next() {
		// Scan timestamps into db.SQLTime (TEXT cannot scan into time.Time
		// with modernc.org/sqlite — P-TSG time-column pitfall).
		var id int
		var key, value string
		var ca, ua db.SQLTime
		if err := rows.Scan(&id, &key, &value, &ca, &ua); err != nil {
			continue
		}
		configs[key] = value
	}
	writeJSON(w, http.StatusOK, configs)
}

// ConfigUpdate upserts one or more config entries. Accepts the legacy
// single shape {key, value} and the frontend's flat object shape
// { <key>: value, ... } (values may be strings, numbers or booleans,
// serialized to text for storage).
func (h *Handlers) ConfigUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJSON"))
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(bodyBytes, &raw); err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJSON"))
		return
	}
	type cfgEntry struct{ key, value string }
	var entries []cfgEntry
	for k, v := range raw {
		// Legacy single shape: {"key": "...", "value": "..."}.
		if k == "key" {
			var single struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(bodyBytes, &single); err == nil && single.Key != "" {
				entries = append(entries, cfgEntry{key: single.Key, value: single.Value})
			}
			continue
		}
		// Flat object shape: value may be string/number/bool.
		var s string
		if err := json.Unmarshal(v, &s); err == nil {
			entries = append(entries, cfgEntry{key: k, value: s})
			continue
		}
		// Number or boolean: serialize compactly (e.g. "5", "true").
		entries = append(entries, cfgEntry{key: k, value: string(v)})
	}
	if len(entries) == 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.keyRequired"))
		return
	}
	for _, e := range entries {
		if e.key == "" {
			continue
		}
		_, err := h.DB.Exec(r.Context(),
			`INSERT INTO app_configs (key, value) VALUES (?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
			e.key, e.value, e.value)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.updateFailed"))
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": true, "count": len(entries)})
}

// PreferencesList returns all user preferences as a flat key->value
// object (the frontend contract: { ui_theme: "dark", ... }). The raw
// rows are {key, value, category} so the flat map is the natural
// serialization for the preference store.
func (h *Handlers) PreferencesList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	rows, err := h.DB.Query(r.Context(), "SELECT id, key, value, category, created_at, updated_at FROM user_preferences ORDER BY category, key")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.preferences.queryFailed"))
		return
	}
	defer rows.Close()
	prefs := map[string]any{}
	for rows.Next() {
		// Scan timestamps into db.SQLTime: modernc.org/sqlite stores TEXT
		// and database/sql cannot scan TEXT into *time.Time (P-TSG
		// time-column pitfall). AppConfig/UserPreference model fields are
		// time.Time, so bypass them here.
		var id int
		var key, value, category string
		var ca, ua db.SQLTime
		if err := rows.Scan(&id, &key, &value, &category, &ca, &ua); err != nil {
			continue
		}
		prefs[key] = value
	}
	writeJSON(w, http.StatusOK, prefs)
}

// PreferencesUpdate accepts either the legacy single-preference shape
// {key, value, category} or the frontend's flat object shape
// { <key>: { value, category }, ... } and upserts each entry.
func (h *Handlers) PreferencesUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	// Read the raw body once; the two shapes share no common struct.
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJSON"))
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(bodyBytes, &raw); err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJSON"))
		return
	}
	type prefEntry struct{ key, value, category string }
	var entries []prefEntry
	for k, v := range raw {
		// Flat-object shape: {"ui_theme": {"value": "dark", "category": "ui"}}.
		var obj struct {
			Value    string `json:"value"`
			Category string `json:"category"`
		}
		if err := json.Unmarshal(v, &obj); err == nil && (obj.Value != "" || obj.Category != "") {
			cat := obj.Category
			if cat == "" {
				cat = "ui"
			}
			entries = append(entries, prefEntry{key: k, value: obj.Value, category: cat})
			continue
		}
		// Legacy single-preference shape: {"key": "...", "value": "...", "category": "..."}.
		if k == "key" {
			var single struct {
				Key      string `json:"key"`
				Value    string `json:"value"`
				Category string `json:"category"`
			}
			if err := json.Unmarshal(bodyBytes, &single); err == nil && single.Key != "" {
				entries = append(entries, prefEntry{key: single.Key, value: single.Value, category: single.Category})
			}
		}
	}
	if len(entries) == 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.keyRequired"))
		return
	}
	for _, e := range entries {
		if e.key == "" {
			continue
		}
		_, err := h.DB.Exec(r.Context(),
			`INSERT INTO user_preferences (key, value, category) VALUES (?, ?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = ?, category = ?, updated_at = CURRENT_TIMESTAMP`,
			e.key, e.value, e.category, e.value, e.category)
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.preferences.updateFailed"))
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": true, "count": len(entries)})
}

// TaskSettingsList returns the 5 task concurrency settings by reading
// live runtime values from the SlotPool and DownloadManager — not stale
// app_configs rows. This ensures the frontend always sees the effective
// concurrency limits, even if they were changed via /api/slots/{type}.
func (h *Handlers) TaskSettingsList(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{
		"maxConcurrentTasks":      5,
		"maxScrapingTasks":        3,
		"maxConcurrentSniffTasks": 1,
		"tsSegmentConcurrent":     3,
		"galleryImageConcurrent":  5,
	}

	if h.Sched != nil {
		snapshot := h.Sched.GetSlotSnapshot()
		if usage, ok := snapshot["download"]; ok {
			result["maxConcurrentTasks"] = usage.Max
		}
		if usage, ok := snapshot["scraping"]; ok {
			result["maxScrapingTasks"] = usage.Max
		}
		if usage, ok := snapshot["sniff"]; ok {
			result["maxConcurrentSniffTasks"] = usage.Max
		}
	}
	if h.DownloadMgr != nil {
		result["tsSegmentConcurrent"] = h.DownloadMgr.GetMaxConcurrent()
	}
	if h.DlDefaults != nil {
		if h.DlDefaults.GalleryImageConcurrent > 0 {
			result["galleryImageConcurrent"] = h.DlDefaults.GalleryImageConcurrent
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// TaskSettingsUpdate parses the 5 task concurrency settings from the
// request body, validates ranges, persists them to app_configs (so they
// survive restarts), and applies them to the live SlotPool and
// DownloadManager — closing the broken link where settings were written
// to DB but never applied to the runtime concurrency controllers.
//
// Settings mapping:
//   maxConcurrentTasks      → SlotPool "download"  type (1-10)
//   maxScrapingTasks        → SlotPool "scraping" type (1-5)
//   maxConcurrentSniffTasks → SlotPool "sniff"    type (1-3)
//   tsSegmentConcurrent     → DownloadManager.maxConcurrent (1-200)
//   galleryImageConcurrent  → DownloadDefaults.GalleryImageConcurrent (1-20)
func (h *Handlers) TaskSettingsUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}

	var req struct {
		MaxConcurrentTasks      *int `json:"maxConcurrentTasks"`
		MaxScrapingTasks        *int `json:"maxScrapingTasks"`
		MaxConcurrentSniffTasks *int `json:"maxConcurrentSniffTasks"`
		TsSegmentConcurrent     *int `json:"tsSegmentConcurrent"`
		GalleryImageConcurrent  *int `json:"galleryImageConcurrent"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate and clamp each provided field.
	clamp := func(v, lo, hi int) int {
		if v < lo {
			return lo
		}
		if v > hi {
			return hi
		}
		return v
	}

	type settingUpdate struct {
		key, dbKey string
		value      int
	}
	var updates []settingUpdate

	if req.MaxConcurrentTasks != nil {
		v := clamp(*req.MaxConcurrentTasks, 1, 10)
		updates = append(updates, settingUpdate{"maxConcurrentTasks", "max_concurrent_tasks", v})
	}
	if req.MaxScrapingTasks != nil {
		v := clamp(*req.MaxScrapingTasks, 1, 5)
		updates = append(updates, settingUpdate{"maxScrapingTasks", "max_scraping_tasks", v})
	}
	if req.MaxConcurrentSniffTasks != nil {
		v := clamp(*req.MaxConcurrentSniffTasks, 1, 3)
		updates = append(updates, settingUpdate{"maxConcurrentSniffTasks", "max_concurrent_sniff_tasks", v})
	}
	if req.TsSegmentConcurrent != nil {
		v := clamp(*req.TsSegmentConcurrent, 1, 200)
		updates = append(updates, settingUpdate{"tsSegmentConcurrent", "ts_segment_concurrent", v})
	}
	if req.GalleryImageConcurrent != nil {
		v := clamp(*req.GalleryImageConcurrent, 1, 20)
		updates = append(updates, settingUpdate{"galleryImageConcurrent", "gallery_image_concurrent", v})
	}

	if len(updates) == 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.keyRequired"))
		return
	}

	// 1. Persist to app_configs so values survive restarts.
	for _, u := range updates {
		_, err := h.DB.Exec(r.Context(),
			`INSERT INTO app_configs (key, value) VALUES (?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
			u.dbKey, strconv.Itoa(u.value), strconv.Itoa(u.value))
		if err != nil {
			writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.updateFailed"))
			return
		}
	}

	// 2. Apply to live runtime — SlotPool, DownloadManager, DownloadDefaults.
	result := map[string]any{}
	for _, u := range updates {
		result[u.key] = u.value
		switch u.key {
		case "maxConcurrentTasks":
			if h.Sched != nil {
				h.Sched.UpdateSlotMax("download", u.value)
			}
		case "maxScrapingTasks":
			if h.Sched != nil {
				h.Sched.UpdateSlotMax("scraping", u.value)
			}
		case "maxConcurrentSniffTasks":
			if h.Sched != nil {
				h.Sched.UpdateSlotMax("sniff", u.value)
			}
		case "tsSegmentConcurrent":
			if h.DownloadMgr != nil {
				h.DownloadMgr.SetMaxConcurrent(u.value)
			}
		case "galleryImageConcurrent":
			if h.DlDefaults != nil {
				h.DlDefaults.GalleryImageConcurrent = u.value
			}
		}
	}
	result["updated"] = true

	writeJSON(w, http.StatusOK, result)
}

func parseIDParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	idStr := r.PathValue("id")
	// Fallback to chi.URLParam for Go < 1.22 compatibility or when
	// PathValue is not available in older chi versions.
	if idStr == "" {
		idStr = chi.URLParam(r, "id")
	}
	if idStr == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidId"))
		return 0, false
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidId"))
		return 0, false
	}
	return id, true
}
