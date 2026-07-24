package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"backend/internal/api"
	"backend/internal/i18n"
	"backend/internal/orchestrator"
	orchestratordag "backend/internal/orchestrator/dag"
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

// DagCreate builds and submits a new DAG based on the requested task type.
// Supported task types: gallery, video, sniff, scrape.
func (h *Handlers) DagCreate(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}
	var req struct {
		TaskType   string `json:"taskType"`
		SourceURL  string `json:"sourceUrl,omitempty"`
		ProviderID string `json:"providerId,omitempty"`
		GalleryID  int    `json:"galleryId,omitempty"`
		TaskID     int    `json:"taskId,omitempty"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ctx := r.Context()
	var dagID string
	var err error

	switch req.TaskType {
	case "gallery":
		if req.GalleryID > 0 {
			// Resume pipeline: re-download existing gallery without re-scrape
			dagID, err = h.submitGalleryResumePipeline(ctx, req.GalleryID)
		} else if req.SourceURL != "" {
			dagID, err = h.submitGalleryPipeline(ctx, req.SourceURL, req.ProviderID)
		} else {
			writeError(w, http.StatusBadRequest, "gallery task requires sourceUrl or galleryId")
			return
		}
	case "video":
		if req.TaskID <= 0 {
			writeError(w, http.StatusBadRequest, "video task requires taskId")
			return
		}
		dagID, err = h.submitVideoPipeline(ctx, req.TaskID)
	case "sniff":
		if req.SourceURL == "" {
			writeError(w, http.StatusBadRequest, "sniff task requires sourceUrl")
			return
		}
		dagID, err = h.submitSniffPipeline(ctx, req.SourceURL)
	case "scrape":
		if req.SourceURL == "" {
			writeError(w, http.StatusBadRequest, "scrape task requires sourceUrl")
			return
		}
		dagID, err = h.submitScrapePipeline(ctx, req.SourceURL, req.ProviderID)
	default:
		writeError(w, http.StatusBadRequest, "unknown task type: "+req.TaskType)
		return
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "DAG creation failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"dagId":    dagID,
		"taskType": req.TaskType,
		"status":   "created",
	})
}

// DagLink adds a runtime dependency edge between two nodes in an existing DAG.
func (h *Handlers) DagLink(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
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
		writeError(w, http.StatusBadRequest, "Failed to add dependency: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"dagId":    dagID,
		"parentId": req.ParentID,
		"childId":  req.ChildID,
		"status":   "linked",
	})
}

// DagTrigger re-activates pending/ready nodes in a DAG by calling
// activateReadyNodes, useful after dependency modifications or recovery.
func (h *Handlers) DagTrigger(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}
	dagID := chi.URLParam(r, "id")

	// Reactivate any ready nodes
	if err := h.DagOrch.ReactivateDagNodes(r.Context(), dagID); err != nil {
		writeError(w, http.StatusInternalServerError, "Trigger failed: "+err.Error())
		return
	}

	// Return current DAG status after trigger
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
		"dagId": dagID,
		"nodes": nodes,
	})
}

// DagDelete removes a DAG from the orchestrator's memory. Only DAGs in
// terminal states (completed, cancelled, failed) can be deleted.
func (h *Handlers) DagDelete(w http.ResponseWriter, r *http.Request) {
	if h.DagOrch == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}
	dagID := chi.URLParam(r, "id")

	if err := h.DagOrch.RemoveDag(r.Context(), dagID); err != nil {
		writeError(w, http.StatusConflict, "Cannot delete DAG: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"dagId":  dagID,
		"status": "deleted",
	})
}

// submitGalleryPipeline creates a new full gallery download DAG.
func (h *Handlers) submitGalleryPipeline(ctx context.Context, sourceURL, providerID string) (string, error) {
	factory := orchestratordag.NewDagFactory()
	def := factory.NewGalleryPipeline(sourceURL, providerID, "")
	return h.DagOrch.SubmitDag(ctx, def)
}

// submitGalleryResumePipeline creates a resume pipeline for an existing gallery.
func (h *Handlers) submitGalleryResumePipeline(ctx context.Context, galleryID int) (string, error) {
	factory := orchestratordag.NewDagFactory()
	gid := fmt.Sprintf("%d", galleryID)
	def := factory.NewGalleryResumePipeline(gid)
	return h.DagOrch.SubmitDag(ctx, def)
}

// submitVideoPipeline creates a video download DAG.
func (h *Handlers) submitVideoPipeline(ctx context.Context, taskID int) (string, error) {
	factory := orchestratordag.NewDagFactory()
	def := factory.NewVideoPipeline(taskID)
	return h.DagOrch.SubmitDag(ctx, def)
}

// submitSniffPipeline creates an M3U8 sniff DAG.
func (h *Handlers) submitSniffPipeline(ctx context.Context, sourceURL string) (string, error) {
	factory := orchestratordag.NewDagFactory()
	def := factory.NewSniffPipeline(sourceURL)
	return h.DagOrch.SubmitDag(ctx, def)
}

// submitScrapePipeline creates a single-node scrape DAG.
func (h *Handlers) submitScrapePipeline(ctx context.Context, sourceURL, providerID string) (string, error) {
	factory := orchestratordag.NewDagFactory()
	def := factory.NewScrapeTask(sourceURL, providerID)
	return h.DagOrch.SubmitDag(ctx, def)
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
	sse := api.NewSSEStream(w)
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

	events := []string{
		"dag:nodeStateChanged",
		"dag:created",
		"dag:completed",
		"dag:failed",
		"dag:paused",
		"dag:resumed",
	}

	for _, ev := range events {
		eventName := ev
		h.EventBus.On(eventName, func(payload any) {
			raw, err := json.Marshal(payload)
			if err != nil {
				return
			}
			sse.SendEvent(eventName, string(raw))
		})
	}

	<-r.Context().Done()
}
