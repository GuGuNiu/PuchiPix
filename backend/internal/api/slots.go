package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"backend/internal/i18n"
)

// SlotList returns the current snapshot of all slot types with their
// usage, max, available counts, and utilization rates for real-time
// monitoring dashboards and the frontend config panel.
func (h *Handlers) SlotList(w http.ResponseWriter, r *http.Request) {
	if h.Sched == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"slots":   []any{},
			"message": "scheduler not initialized",
		})
		return
	}

	stats := h.Sched.GetSlotSnapshot()
	slots := make([]map[string]any, 0, len(stats))
	for slotType, usage := range stats {
		utilization := 0.0
		if usage.Max > 0 {
			utilization = float64(usage.Current) / float64(usage.Max) * 100
		}
		status := "normal"
		if utilization >= 90 {
			status = "critical"
		} else if utilization >= 70 {
			status = "warning"
		}
		slots = append(slots, map[string]any{
			"slotType":    slotType,
			"current":     usage.Current,
			"max":         usage.Max,
			"available":   usage.Available,
			"utilization": roundTo2(utilization),
			"status":      status,
		})
	}

	// Also include scheduler queue depth.
	schedStats := h.Sched.GetStats()
	writeJSON(w, http.StatusOK, map[string]any{
		"slots":         slots,
		"queueSize":     schedStats.QueueSize,
		"byPriority":    schedStats.ByPriority,
		"byTaskType":    schedStats.ByTaskType,
		"schedulerStrategy": schedStats.Strategy,
	})
}

// SlotUpdate accepts a new max value for a slot type, clamped to the
// type's configured [Min, Max] range, and triggers scheduler re-scan.
// PUT /api/slots/{type}  {"max": 5}
func (h *Handlers) SlotUpdate(w http.ResponseWriter, r *http.Request) {
	slotType := chi.URLParam(r, "type")
	if slotType == "" {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.slots.missingSlotType"))
		return
	}

	var req struct {
		Max int `json:"max"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Max <= 0 {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.slots.invalidMax"))
		return
	}

	if h.Sched == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}

	h.Sched.UpdateSlotMax(slotType, req.Max)

	// Return updated usage for this slot type.
	stats := h.Sched.GetSlotSnapshot()
	usage, ok := stats[slotType]
	if !ok {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.slots.slotTypeNotFound")+" "+slotType)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"slotType":  usage.SlotType,
		"current":   usage.Current,
		"max":       usage.Max,
		"available": usage.Available,
	})
}

// SlotHolders returns the list of active holder IDs for all slot types,
// useful for diagnosing slot leaks and identifying stuck tasks.
func (h *Handlers) SlotHolders(w http.ResponseWriter, r *http.Request) {
	if h.Sched == nil {
		writeJSON(w, http.StatusOK, map[string]any{"holders": map[string][]string{}})
		return
	}
	holders := h.Sched.GetActiveSlotHolders()
	writeJSON(w, http.StatusOK, map[string]any{"holders": holders})
}

// SlotDetail returns detailed information for a single slot type
// including active holders, queue depth, and utilization.
func (h *Handlers) SlotDetail(w http.ResponseWriter, r *http.Request) {
	slotType := chi.URLParam(r, "type")
	if slotType == "" {
		writeError(w, http.StatusBadRequest, "missing slot type")
		return
	}

	if h.Sched == nil {
		writeJSON(w, http.StatusOK, map[string]any{"message": "scheduler not initialized"})
		return
	}

	stats := h.Sched.GetSlotSnapshot()
	usage, ok := stats[slotType]
	if !ok {
		writeError(w, http.StatusNotFound, "slot type not found: "+slotType)
		return
	}

	holders := h.Sched.GetActiveSlotHolders()
	slotHolders := holders[slotType]
	if slotHolders == nil {
		slotHolders = []string{}
	}

	utilization := 0.0
	if usage.Max > 0 {
		utilization = float64(usage.Current) / float64(usage.Max) * 100
	}

	queueStats := h.Sched.GetStats()

	writeJSON(w, http.StatusOK, map[string]any{
		"slotType":        slotType,
		"current":         usage.Current,
		"max":             usage.Max,
		"available":       usage.Available,
		"utilization":     roundTo2(utilization),
		"activeHolders":   slotHolders,
		"holderCount":     len(slotHolders),
		"schedulerQueue":  queueStats.QueueSize,
		"queueByTaskType": queueStats.ByTaskType,
	})
}

// roundTo2 rounds a float64 to 2 decimal places.
func roundTo2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

// SlotReset clears all usage for a single slot type. Emergency tool for
// ghost-slot recovery (P-SLOT-01): when the running counter drifts from
// the activeSlots map and tasks are starved, `DELETE /api/slots/{type}`
// (or `cli slots reset <type>`) restores availability immediately.
func (h *Handlers) SlotReset(w http.ResponseWriter, r *http.Request) {
	slotType := chi.URLParam(r, "type")
	if slotType == "" {
		writeError(w, http.StatusBadRequest, "missing slot type")
		return
	}

	if h.Sched == nil {
		writeError(w, http.StatusServiceUnavailable, i18n.TFromRequest(r, "api.dag.schedulerRequired"))
		return
	}

	if !h.Sched.ResetSlot(slotType) {
		writeError(w, http.StatusNotFound, "slot type not found: "+slotType)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"slotType":  slotType,
		"reset":     true,
		"current":   0,
		"available": 0,
	})
}
