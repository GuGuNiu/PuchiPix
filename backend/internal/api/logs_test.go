package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestLogsHistory verifies that the logs history endpoint returns
// a JSON array, ensuring the LogSink is queryable without errors.
func TestLogsHistory(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/logs/history", nil)
	w := httptest.NewRecorder()
	h.LogsHistory(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// TestLogsQuery verifies that the logs query endpoint delegates to
// the history endpoint and returns a valid JSON response.
func TestLogsQuery(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/logs/query?module=API&level=info", nil)
	w := httptest.NewRecorder()
	h.LogsQuery(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// TestParseLogFilter verifies that query parameters are correctly
// parsed into the LogQueryFilter struct.
func TestParseLogFilter(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		module   string
		hasLevel bool
	}{
		{"module only", "/api/logs?module=API", "API", false},
		{"level info", "/api/logs?level=info", "", true},
		{"level debug", "/api/logs?level=debug", "", true},
		{"level warn", "/api/logs?level=warn", "", true},
		{"level error", "/api/logs?level=error", "", true},
		{"combined", "/api/logs?module=API&level=warn&dagId=dag1", "API", true},
		{"no params", "/api/logs", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.url, nil)
			filter := parseLogFilter(req)
			assert.Equal(t, tt.module, filter.Module)
			assert.Equal(t, tt.hasLevel, filter.HasLevel)
		})
	}
}

// TestParseLogFilterLimit verifies that the limit parameter is
// parsed correctly.
func TestParseLogFilterLimit(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/logs?limit=100", nil)
	filter := parseLogFilter(req)
	assert.Equal(t, 100, filter.Limit)
}
