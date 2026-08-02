package api

import (
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
		if err := rows.Scan(&a.ID, &a.SiteID, &a.Username, &a.Domain, &a.Status, &a.CookiePrefix, &a.LastLoginAt, &a.LastUsedAt, &a.FailCount, &a.Remark, &a.CreatedAt, &a.UpdatedAt); err != nil {
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
		if err := rows.Scan(&p.ID, &p.Name, &p.Pinyin, &p.Aliases, &p.Source, &p.SourceGame, &p.GalleryCount, &p.Confirmed, &p.CreatedAt, &p.UpdatedAt); err != nil {
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
		var br db.BlocklistRule
		if err := rows.Scan(&br.ID, &br.SiteID, &br.FieldType, &br.Keyword, &br.MatchMode, &br.Enabled, &br.Remark, &br.CreatedAt, &br.UpdatedAt); err != nil {
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
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(), "SELECT id, key, value, created_at, updated_at FROM app_configs ORDER BY key")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.queryFailed"))
		return
	}
	defer rows.Close()
	configs := []db.AppConfig{}
	for rows.Next() {
		var c db.AppConfig
		if err := rows.Scan(&c.ID, &c.Key, &c.Value, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		configs = append(configs, c)
	}
	writeJSON(w, http.StatusOK, configs)
}

// ConfigUpdate upserts a config key-value pair.
func (h *Handlers) ConfigUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var c db.AppConfig
	if !decodeJSON(w, r, &c) {
		return
	}
	if c.Key == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.keyRequired"))
		return
	}
	_, err := h.DB.Exec(r.Context(),
		`INSERT INTO app_configs (key, value) VALUES (?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
		c.Key, c.Value)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.updateFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": c.Key, "updated": true})
}

// PreferencesList returns all user preferences.
func (h *Handlers) PreferencesList(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(r.Context(), "SELECT id, key, value, category, created_at, updated_at FROM user_preferences ORDER BY category, key")
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.preferences.queryFailed"))
		return
	}
	defer rows.Close()
	prefs := []db.UserPreference{}
	for rows.Next() {
		var p db.UserPreference
		if err := rows.Scan(&p.ID, &p.Key, &p.Value, &p.Category, &p.CreatedAt, &p.UpdatedAt); err != nil {
			continue
		}
		prefs = append(prefs, p)
	}
	writeJSON(w, http.StatusOK, prefs)
}

// PreferencesUpdate upserts a user preference.
func (h *Handlers) PreferencesUpdate(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.common.databaseUnavailable"))
		return
	}
	var p db.UserPreference
	if !decodeJSON(w, r, &p) {
		return
	}
	if p.Key == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.keyRequired"))
		return
	}
	_, err := h.DB.Exec(r.Context(),
		`INSERT INTO user_preferences (key, value, category) VALUES (?, ?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = ?, category = ?, updated_at = CURRENT_TIMESTAMP`,
		p.Key, p.Value, p.Category)
	if err != nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.preferences.updateFailed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": p.Key, "updated": true})
}

// TaskSettingsList returns task-related settings from app_config.
func (h *Handlers) TaskSettingsList(w http.ResponseWriter, r *http.Request) {
	h.ConfigList(w, r)
}

// TaskSettingsUpdate updates task-related settings.
func (h *Handlers) TaskSettingsUpdate(w http.ResponseWriter, r *http.Request) {
	h.ConfigUpdate(w, r)
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
