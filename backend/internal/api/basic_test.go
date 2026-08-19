package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/infra"
)

// TestHealthNoDB verifies that the health endpoint returns "ok"
// when no database is configured, allowing the server to report
// liveness even in DB-less mode.
func TestHealthNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "ok", body["status"])
}

// TestSystem verifies that the system endpoint returns runtime
// information needed by the dashboard.
func TestSystem(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/system", nil)
	w := httptest.NewRecorder()
	h.System(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.NotEmpty(t, body["version"])
	assert.NotEmpty(t, body["goVersion"])
	assert.NotEmpty(t, body["cpuCores"])
}

// TestStatsNoDB verifies that the stats endpoint returns zeros
// when no database is configured, keeping the dashboard functional.
func TestStatsNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/stats", nil)
	w := httptest.NewRecorder()
	h.Stats(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, float64(0), body["galleries"])
	assert.Equal(t, float64(0), body["tasks"])
}

// TestSites verifies that the sites endpoint returns an empty
// list when no SiteRegistry is injected (degraded mode).
func TestSites(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/sites", nil)
	w := httptest.NewRecorder()
	h.Sites(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var sites []map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &sites))
	assert.Empty(t, sites)
}

// TestHealthReturnsTime verifies that the health response includes
// a timestamp for monitoring synchronization.
func TestHealthReturnsTime(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.NotEmpty(t, body["time"])
}

// TestSystemReturnsUptime verifies that the system response includes
// uptime for diagnostics.
func TestSystemReturnsUptime(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/system", nil)
	w := httptest.NewRecorder()
	h.System(w, req)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.NotEmpty(t, body["uptime"])
}
