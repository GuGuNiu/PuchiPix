package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestDagDetailNoOrchestrator verifies that the DAG detail endpoint returns
// a not_initialized state when no orchestrator is wired.
func TestDagDetailNoOrchestrator(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/dag/1", nil)
	req.SetPathValue("id", "1")
	w := httptest.NewRecorder()
	h.DagDetail(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "not_initialized")
}

// TestDagControlNoOrchestrator verifies that DAG control commands return
// 503 when the orchestrator is not wired.
func TestDagControlNoOrchestrator(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/dag/1/pause", nil)
	w := httptest.NewRecorder()
	h.DagControl(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestDagNodesEmpty verifies that the DAG nodes endpoint returns an
// empty array before scheduler integration.
func TestDagNodesEmpty(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/dag/1/nodes", nil)
	w := httptest.NewRecorder()
	h.DagNodes(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestDagSnapshotNoOrchestrator verifies that the DAG snapshot endpoint
// returns a not_initialized state when no orchestrator is wired.
func TestDagSnapshotNoOrchestrator(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/dag/1/snapshot", nil)
	w := httptest.NewRecorder()
	h.DagSnapshot(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "not_initialized")
}
