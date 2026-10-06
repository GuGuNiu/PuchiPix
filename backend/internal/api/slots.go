package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"backend/internal/i18n"
)

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

	schedStats := h.Sched.GetStats()
	writeJSON(w, http.StatusOK, map[string]any{
		"slots":             slots,
		"queueSize":         schedStats.QueueSize,
		"byPriority":        schedStats.ByPriority,
		"byTaskType":        schedStats.ByTaskType,
		"schedulerStrategy": schedStats.Strategy,
	})
}

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

	stats := h.Sched.GetSlotSnapshot()
	usage, ok := stats[slotType]
	if !ok {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.slots.slotTypeNotFound")+" "+slotType)
		return
	}

	if h.DB != nil {
		dbKey := ""
		switch slotType {
		case "download":
			dbKey = "max_concurrent_tasks"
		case "scraping":
			dbKey = "max_scraping_tasks"
		case "sniff":
			dbKey = "max_concurrent_sniff_tasks"
		}
		if dbKey != "" {
			if _, err := h.DB.Exec(r.Context(),
				`INSERT INTO app_configs (key, value) VALUES (?, ?)
				 ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
				dbKey, strconv.Itoa(req.Max), strconv.Itoa(req.Max)); err != nil {
				writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.config.updateFailed"))
				return
			}
		}
	}

	h.Sched.UpdateSlotMax(slotType, req.Max)
	// Regulate running work: when the new max is lower than the current
	// holder count, pause the newest-held excess (progress-preserving) so
	// the pipeline converges to the new limit immediately.
	if h.DagOrch != nil {
		h.DagOrch.EnforceSlotMax(r.Context(), slotType, req.Max)
	}
	usage = h.Sched.GetSlotSnapshot()[slotType]
	writeJSON(w, http.StatusOK, map[string]any{
		"slotType":  usage.SlotType,
		"current":   usage.Current,
		"max":       usage.Max,
		"available": usage.Available,
	})
}

func (h *Handlers) SlotHolders(w http.ResponseWriter, r *http.Request) {
	if h.Sched == nil {
		writeJSON(w, http.StatusOK, map[string]any{"holders": map[string][]string{}})
		return
	}
	holders := h.Sched.GetActiveSlotHolders()
	writeJSON(w, http.StatusOK, map[string]any{"holders": holders})
}

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

func roundTo2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

// SlotReset clears all usage for a single slot type. Emergency tool for
// ghost-slot recovery: when the running counter drifts from the activeSlots
// map and tasks are starved, DELETE /api/slots/{type} restores availability.
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

	holders := h.Sched.GetActiveSlotHolders()[slotType]
	force := r.URL.Query().Get("force") == "true"
	if len(holders) > 0 && !force {
		writeError(w, http.StatusConflict, "slot has active holders")
		return
	}
	if !h.Sched.ResetSlot(slotType) {
		writeError(w, http.StatusNotFound, "slot type not found: "+slotType)
		return
	}

	usage := h.Sched.GetSlotSnapshot()[slotType]
	writeJSON(w, http.StatusOK, map[string]any{
		"slotType":  slotType,
		"reset":     true,
		"current":   usage.Current,
		"available": usage.Available,
	})
}
