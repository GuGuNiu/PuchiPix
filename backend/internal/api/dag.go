package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"backend/internal/i18n"
	"backend/internal/orchestrator"
)

// DagList returns all active DAG snapshots. Each entry carries the DAG
// ID, node count, and aggregate state for the frontend DAG dashboard.
func (h *Handlers) DagList(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	snapshots := h.DagOrch.GetAllDagSnapshots()
	result := make([]map[string]any, 0, len(snapshots))
	for _, snap := range snapshots {
		infos := make([]orchestrator.NodeSnapshotInfo, len(snap.NodeStates))
		for i, ns := range snap.NodeStates {
			infos[i] = orchestrator.NodeSnapshotInfo{State: ns.State, Phase: "", NonCritical: false}
		}
		result = append(result, map[string]any{
			"dagId":     snap.DagID,
			"nodeCount": len(snap.NodeStates),
			"state":     orchestrator.AggregateTaskStatus(snap.Definition.TaskType, infos),
			"sourceUrl": snap.Definition.Metadata.SourceURL,
			"createdAt": snap.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

// DagDetail returns the full state of a single DAG instance by ID,
// including all node states for the frontend DAG detail view.
func (h *Handlers) DagDetail(w http.ResponseWriter, r *http.Request) {
	dagID := chi.URLParam(r, "id")
	if h.DagOrch == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"id":    dagID,
			"state": "not_initialized",
			"nodes": []any{},
		})
		return
	}
	status := h.DagOrch.GetDagStatus(dagID)
	if status == nil {
		writeError(w, http.StatusNotFound, "DAG not found")
		return
	}
	nodes := make([]map[string]any, 0, len(status.Nodes))
	for _, n := range status.Nodes {
		nodes = append(nodes, map[string]any{
			"nodeId": n.NodeID,
			"state":  string(n.State),
			"phase":  string(n.Phase),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":    status.DagID,
		"nodes": nodes,
	})
}

// DagControl accepts pause, resume, cancel, and retry commands for a
// DAG or individual node, routing to the DagOrchestrator.
func (h *Handlers) DagControl(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}
	dagID := chi.URLParam(r, "id")
	var req struct {
		Action string `json:"action"`
		NodeID string `json:"nodeId,omitempty"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx := r.Context()
	var err error
	switch req.Action {
	case "pause":
		err = h.DagOrch.PauseDag(ctx, dagID)
	case "resume":
		err = h.DagOrch.ResumeDag(ctx, dagID, req.NodeID)
	case "cancel":
		err = h.DagOrch.CancelDag(ctx, dagID)
	case "retry":
		err = h.DagOrch.RetryDag(ctx, dagID, req.NodeID)
	default:
		writeError(w, http.StatusBadRequest, "Unknown action: "+req.Action)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DAG control operation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// DagNodes returns the node list for a DAG instance as a lightweight
// array for the frontend task panel.
func (h *Handlers) DagNodes(w http.ResponseWriter, r *http.Request) {
	dagID := chi.URLParam(r, "id")
	if h.DagOrch == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	status := h.DagOrch.GetDagStatus(dagID)
	if status == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	nodes := make([]map[string]any, 0, len(status.Nodes))
	for _, n := range status.Nodes {
		nodes = append(nodes, map[string]any{
			"nodeId": n.NodeID,
			"state":  string(n.State),
			"phase":  string(n.Phase),
		})
	}
	writeJSON(w, http.StatusOK, nodes)
}

// DagSnapshot returns the latest persisted snapshot for a DAG.
func (h *Handlers) DagSnapshot(w http.ResponseWriter, r *http.Request) {
	dagID := chi.URLParam(r, "id")
	if h.DagOrch == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"state":   "not_initialized",
			"lastSeq": 0,
		})
		return
	}
	snap := h.DagOrch.GetDagSnapshot(dagID)
	if snap == nil {
		writeError(w, http.StatusNotFound, "DAG not found")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// DagStreamSSE pushes DAG state change events in real-time via SSE,
// subscribing to the EventBus dag:* namespace and forwarding to the
// frontend with keepalive pings.
func (h *Handlers) DagStreamSSE(w http.ResponseWriter, r *http.Request) {
	sse := NewSSEStream(w)
	if sse == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	if h.DagOrch == nil || h.EventBus == nil {
		sse.SendEvent("status", map[string]string{"state": "waiting_for_scheduler"})
		<-r.Context().Done()
		return
	}

	sse.SendEvent("status", map[string]string{"state": "connected"})

	// Subscribe to dag:* events with proper cleanup via defer,
	// matching the TaskStreamSSE pattern to avoid memory leaks.
	unsubNodeState := h.EventBus.On("dag:nodeStateChanged", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:nodeStateChanged", string(raw))
	})
	unsubCreated := h.EventBus.On("dag:created", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:created", string(raw))
	})
	unsubCompleted := h.EventBus.On("dag:completed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:completed", string(raw))
	})
	unsubFailed := h.EventBus.On("dag:failed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:failed", string(raw))
	})
	unsubPaused := h.EventBus.On("dag:paused", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:paused", string(raw))
	})
	unsubResumed := h.EventBus.On("dag:resumed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		sse.SendEvent("dag:resumed", string(raw))
	})

	defer func() {
		unsubNodeState()
		unsubCreated()
		unsubCompleted()
		unsubFailed()
		unsubPaused()
		unsubResumed()
	}()

	<-r.Context().Done()
}
