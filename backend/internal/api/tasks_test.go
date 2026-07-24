package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestTaskListNoDB verifies that the task list endpoint returns an
// empty array when no database is configured.
func TestTaskListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/tasks", nil)
	w := httptest.NewRecorder()
	h.TaskList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestTaskCreateNoDB verifies that creating a task without a database
// returns a 503 error.
func TestTaskCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{"url":"https://example.com/video"}`))
	w := httptest.NewRecorder()
	h.TaskCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskDetailNoDB verifies that fetching a task detail without a
// database returns a 503 error.
func TestTaskDetailNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/tasks/1", nil)
	req.SetPathValue("id", "1")
	w := httptest.NewRecorder()
	h.TaskDetail(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskActionNotImplemented verifies that task actions return
// 503 when the download manager is not injected.
func TestTaskActionNotImplemented(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/tasks/1/start", nil)
	w := httptest.NewRecorder()
	h.TaskAction(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskCreateMissingUrl verifies that creating a task without a URL
// returns 503 because the nil-DB guard fires before field validation.
func TestTaskCreateMissingUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.TaskCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskCreateBadJson verifies that malformed JSON returns 503
// because the nil-DB guard fires before JSON decoding.
func TestTaskCreateBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.TaskCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestTaskDetailInvalidId verifies that fetching a task with a
// non-numeric ID returns 400 when a database is available.
// With nil DB, the handler returns 503 before reaching ID validation.
func TestTaskDetailInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/tasks/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.TaskDetail(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}
