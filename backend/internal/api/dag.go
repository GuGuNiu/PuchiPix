package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"backend/internal/api/internal/sse"
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

// DagDelete removes a completed, cancelled, or failed DAG from memory.
func (h *Handlers) DagDelete(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
		return
	}
	dagID := chi.URLParam(r, "id")
	if err := h.DagOrch.RemoveDag(r.Context(), dagID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete DAG: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"dagId":  dagID,
	})
}

// DagDetail returns the full state of a single DAG instance by ID,
// including all node states for the frontend DAG detail view.
func (h *Handlers) DagDetail(w http.ResponseWriter, r *http.Request) {
	dagID := chi.URLParam(r, "id")
	if h.DagOrch == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"id":        dagID,
			"state":     "not_initialized",
			"nodes":     []any{},
			"taskType":  "",
			"sourceUrl": "",
			"createdAt": "",
			"workerDown": true,
		})
		return
	}
	status := h.DagOrch.GetDagStatus(dagID)
	if status == nil {
		writeError(w, http.StatusNotFound, "DAG not found")
		return
	}

	// Compute aggregate state from node states
	infos := make([]orchestrator.NodeSnapshotInfo, len(status.Nodes))
	for i, n := range status.Nodes {
		infos[i] = orchestrator.NodeSnapshotInfo{
			State:       n.State,
			Phase:       n.Phase,
			NonCritical: false,
		}
	}
	// Default taskType; will be overridden if snapshot available
	taskType := orchestrator.TaskTypeGallery
	aggregateState := orchestrator.AggregateTaskStatus(taskType, infos)

	// Get additional metadata from snapshot
	var sourceURL string
	var createdAt string
	snap := h.DagOrch.GetDagSnapshot(dagID)
	if snap != nil {
		sourceURL = snap.Definition.Metadata.SourceURL
		createdAt = snap.CreatedAt.Format("2006-01-02 15:04:05")
		if snap.Definition.TaskType != "" {
			taskType = snap.Definition.TaskType
			// Recompute aggregate with correct task type
			aggregateState = orchestrator.AggregateTaskStatus(taskType, infos)
		}
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
		"id":         status.DagID,
		"nodes":      nodes,
		"state":      aggregateState,
		"taskType":   taskType,
		"sourceUrl":  sourceURL,
		"createdAt":  createdAt,
		"workerDown": false,
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
		Action   string `json:"action"`
		NodeID   string `json:"nodeId,omitempty"`
		Priority int    `json:"priority,omitempty"`
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
	case "setPriority":
		// Dynamic priority adjustment: nodeId is required, priority is
		// the new TaskPriority value (1..10). Applied to the queued node
		// immediately and persisted for future submissions.
		if req.NodeID == "" {
			writeError(w, http.StatusBadRequest, "nodeId required for setPriority")
			return
		}
		if req.Priority <= 0 {
			writeError(w, http.StatusBadRequest, "priority must be a positive integer")
			return
		}
		err = h.DagOrch.UpdateNodePriority(ctx, dagID, req.NodeID, orchestrator.TaskPriority(req.Priority))
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

// DagSchedulerStats returns the scheduler queue statistics for monitoring.
func (h *Handlers) DagSchedulerStats(w http.ResponseWriter, r *http.Request) {
	if h.Sched == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"queueSize":  0,
			"byPriority": map[string]int{},
			"byTaskType": map[string]int{},
			"strategy":   "none",
		})
		return
	}
	stats := h.Sched.GetStats()
	writeJSON(w, http.StatusOK, stats)
}

// DagLink adds a runtime dependency edge between two nodes in a DAG.
func (h *Handlers) DagLink(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
		return
	}
	dagID := chi.URLParam(r, "id")
	var req struct {
		ParentID string `json:"parentId"`
		ChildID  string `json:"childId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ParentID == "" || req.ChildID == "" {
		writeError(w, http.StatusBadRequest, "parentId and childId are required")
		return
	}
	if err := h.DagOrch.AddDependency(r.Context(), dagID, req.ParentID, req.ChildID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to add dependency: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"dagId":    dagID,
		"parentId": req.ParentID,
		"childId":  req.ChildID,
	})
}

// DagTrigger re-activates pending/ready nodes in a DAG, useful for
// recovering stuck nodes after dependency modifications or slot pool
// recovery.
func (h *Handlers) DagTrigger(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, "DAG orchestrator not available")
		return
	}
	dagID := chi.URLParam(r, "id")
	if err := h.DagOrch.ReactivateDagNodes(r.Context(), dagID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to trigger DAG: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"dagId":  dagID,
	})
}

// DagStreamSSE pushes DAG state change events in real-time via SSE,
// subscribing to the EventBus dag:* namespace and forwarding to the
// CLI/frontend with 15s heartbeats so clients can detect dead
// connections and reconnect proactively.
func (h *Handlers) DagStreamSSE(w http.ResponseWriter, r *http.Request) {
	stream := sse.NewSSEStream(w)
	if stream == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	if h.DagOrch == nil || h.EventBus == nil {
		stream.SendEvent("status", map[string]string{"state": "waiting_for_scheduler"})
		<-r.Context().Done()
		return
	}

	stream.SendEvent("status", map[string]string{"state": "connected"})

	// Subscribe to dag:* events with proper cleanup via defer,
	// matching the TaskStreamSSE pattern to avoid memory leaks.
	// 260809 fix: business events use TrySendEvent (non-blocking) so a
	// slow client cannot block the EventBus caller; heartbeat also uses
	// the non-blocking path.
	unsubNodeState := h.EventBus.On("dag:nodeStateChanged", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:nodeStateChanged", string(raw))
	})
	unsubCreated := h.EventBus.On("dag:created", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:created", string(raw))
	})
	unsubCompleted := h.EventBus.On("dag:completed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:completed", string(raw))
	})
	unsubFailed := h.EventBus.On("dag:failed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:failed", string(raw))
	})
	unsubPaused := h.EventBus.On("dag:paused", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:paused", string(raw))
	})
	unsubResumed := h.EventBus.On("dag:resumed", func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		stream.TrySendEvent("dag:resumed", string(raw))
	})

	defer func() {
		unsubNodeState()
		unsubCreated()
		unsubCompleted()
		unsubFailed()
		unsubPaused()
		unsubResumed()
	}()

	// Heartbeat: send a named event every 15s so clients can detect
	// dead connections and trigger proactive reconnection (mirrors
	// TaskStreamSSE; previously this endpoint had no heartbeat at all).
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	defer stream.Close()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			stream.TrySendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
		}
	}
}
