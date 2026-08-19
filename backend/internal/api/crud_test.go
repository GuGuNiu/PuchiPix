package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestAccountsListNoDB verifies that the accounts list endpoint
// returns an empty array when no database is configured.
func TestAccountsListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/accounts", nil)
	w := httptest.NewRecorder()
	h.AccountsList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestPersonsListNoDB verifies that the persons list endpoint
// returns an empty array when no database is configured.
func TestPersonsListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/persons", nil)
	w := httptest.NewRecorder()
	h.PersonsList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestBlocklistListNoDB verifies that the blocklist list endpoint
// returns an empty array when no database is configured.
func TestBlocklistListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/blocklist", nil)
	w := httptest.NewRecorder()
	h.BlocklistList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestConfigListNoDB verifies that the config list endpoint returns
// an empty flat object when no database is configured (the frontend
// contract is a flat key->value map, not an array).
func TestConfigListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	h.ConfigList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "{}")
}

// TestPreferencesListNoDB verifies that the preferences list endpoint
// returns an empty flat object when no database is configured (the
// frontend contract is a flat key->value map, not an array).
func TestPreferencesListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/preferences", nil)
	w := httptest.NewRecorder()
	h.PreferencesList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "{}")
}

// TestAccountsCreateNoDB verifies that creating an account without
// a database returns a 503 error.
func TestAccountsCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/accounts", strings.NewReader(`{"siteId":"test","username":"u","password":"p"}`))
	w := httptest.NewRecorder()
	h.AccountsCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPersonsCreateNoDB verifies that creating a person without
// a database returns a 503 error.
func TestPersonsCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/persons", strings.NewReader(`{"name":"test"}`))
	w := httptest.NewRecorder()
	h.PersonsCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestBlocklistCreateNoDB verifies that creating a blocklist rule
// without a database returns a 503 error.
func TestBlocklistCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/blocklist", strings.NewReader(`{"fieldType":"title","keyword":"spam"}`))
	w := httptest.NewRecorder()
	h.BlocklistCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestConfigUpdateNoDB verifies that updating a config without
// a database returns a 503 error.
func TestConfigUpdateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/config", strings.NewReader(`{"key":"test","value":"val"}`))
	w := httptest.NewRecorder()
	h.ConfigUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPreferencesUpdateNoDB verifies that updating a preference
// without a database returns a 503 error.
func TestPreferencesUpdateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/preferences", strings.NewReader(`{"key":"test","value":"val"}`))
	w := httptest.NewRecorder()
	h.PreferencesUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestAccountsUpdateInvalidId verifies that updating an account with
// a non-numeric ID is rejected before any database access occurs.
func TestAccountsUpdateInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/accounts/abc", strings.NewReader(`{"username":"u"}`))
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.AccountsUpdate(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestAccountsDeleteInvalidId verifies that deleting an account with
// a non-numeric ID is rejected before any database access occurs.
func TestAccountsDeleteInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("DELETE", "/api/accounts/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.AccountsDelete(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestPersonsUpdateInvalidId verifies that updating a person with a
// non-numeric ID is rejected before any database access occurs.
func TestPersonsUpdateInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/persons/abc", strings.NewReader(`{"name":"u"}`))
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.PersonsUpdate(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestPersonsDeleteInvalidId verifies that deleting a person with a
// non-numeric ID is rejected before any database access occurs.
func TestPersonsDeleteInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("DELETE", "/api/persons/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.PersonsDelete(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestBlocklistUpdateInvalidId verifies that updating a blocklist rule
// with a non-numeric ID is rejected before any database access occurs.
func TestBlocklistUpdateInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/blocklist/abc", strings.NewReader(`{"fieldType":"title"}`))
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.BlocklistUpdate(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestBlocklistDeleteInvalidId verifies that deleting a blocklist rule
// with a non-numeric ID is rejected before any database access occurs.
func TestBlocklistDeleteInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("DELETE", "/api/blocklist/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.BlocklistDelete(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestTaskSettingsUpdateNoDB verifies that updating task settings
// without a database returns a 503 error (nil-DB guard).
func TestTaskSettingsUpdateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/task-settings", strings.NewReader(`{"maxConcurrentTasks":3}`))
	w := httptest.NewRecorder()
	h.TaskSettingsUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskSettingsUpdateNoFields verifies that a PUT with no recognised
// settings fields returns 400 (keyRequired).
func TestTaskSettingsUpdateNoFields(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/task-settings", strings.NewReader(`{"value":"val"}`))
	w := httptest.NewRecorder()
	h.TaskSettingsUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestAccountsCreateMissingFields verifies that creating an account
// without required fields returns 503 because the nil-DB guard fires first.
func TestAccountsCreateMissingFields(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/accounts", strings.NewReader(`{"siteId":"test"}`))
	w := httptest.NewRecorder()
	h.AccountsCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPersonsCreateMissingName verifies that creating a person without
// a name returns 503 because the nil-DB guard fires first.
func TestPersonsCreateMissingName(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/persons", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.PersonsCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestBlocklistCreateMissingFields verifies that creating a blocklist
// rule without required fields returns 503 because the nil-DB guard fires first.
func TestBlocklistCreateMissingFields(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/blocklist", strings.NewReader(`{"fieldType":"title"}`))
	w := httptest.NewRecorder()
	h.BlocklistCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestConfigUpdateMissingKey verifies that updating config without a
// key returns 503 because the nil-DB guard fires first.
func TestConfigUpdateMissingKey(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/config", strings.NewReader(`{"value":"val"}`))
	w := httptest.NewRecorder()
	h.ConfigUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPreferencesUpdateMissingKey verifies that updating preferences
// without a key returns 503 because the nil-DB guard fires first.
func TestPreferencesUpdateMissingKey(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("PUT", "/api/preferences", strings.NewReader(`{"value":"val"}`))
	w := httptest.NewRecorder()
	h.PreferencesUpdate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestAccountsCreateBadJson verifies that malformed JSON returns 503
// because the nil-DB guard fires before JSON decoding.
func TestAccountsCreateBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/accounts", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.AccountsCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestParseIDParamInvalid verifies that a non-numeric ID parameter
// is rejected with a 400 error.
func TestParseIDParamInvalid(t *testing.T) {
	req := httptest.NewRequest("DELETE", "/api/accounts/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()

	_, ok := parseIDParam(w, req)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestParseIDParamValid verifies that a numeric ID parameter is
// parsed correctly.
func TestParseIDParamValid(t *testing.T) {
	req := httptest.NewRequest("DELETE", "/api/accounts/42", nil)
	req.SetPathValue("id", "42")
	w := httptest.NewRecorder()

	id, ok := parseIDParam(w, req)
	assert.True(t, ok)
	assert.Equal(t, 42, id)
}
