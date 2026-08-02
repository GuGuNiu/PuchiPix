package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"backend/internal/i18n"
)

// SlotStreamSSE streams real-time slot state changes via Server-Sent
// Events. Clients subscribe to the EventBus "slot:stateChanged" event
// and receive acquire / release / max_updated / dag_quota_set /
// dag_quota_cleared notifications as they happen. An optional
// ?slotType=download query parameter filters to a single slot type.
// An initial snapshot is sent on connect so clients can render the
// current occupancy immediately, then 15s heartbeats keep the
// connection alive (mirroring TaskStreamSSE).
func (h *Handlers) SlotStreamSSE(w http.ResponseWriter, r *http.Request) {
	sse := NewSSEStream(w)
	if sse == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	filter := r.URL.Query().Get("slotType")

	// Initial snapshot: current usage for all slot types.
	if h.Sched != nil {
		stats := h.Sched.GetSlotSnapshot()
		if filter != "" {
			if usage, ok := stats[filter]; ok {
				sse.SendEvent("initial", []map[string]any{{
					"slotType":  usage.SlotType,
					"current":   usage.Current,
					"max":       usage.Max,
					"available": usage.Available,
				}})
			} else {
				sse.SendEvent("initial", []any{})
			}
		} else {
			slots := make([]map[string]any, 0, len(stats))
			for slotType, usage := range stats {
				slots = append(slots, map[string]any{
					"slotType":  slotType,
					"current":   usage.Current,
					"max":       usage.Max,
					"available": usage.Available,
				})
			}
			sse.SendEvent("initial", slots)
		}
	} else {
		sse.SendEvent("initial", []any{})
	}

	// Subscribe to slot state changes with proper cleanup via defer.
	if h.EventBus != nil {
		unsub := h.EventBus.On("slot:stateChanged", func(payload any) {
			// Optional client-side filter by slot type.
			if m, ok := payload.(map[string]any); ok {
				if filter != "" {
					slotType, _ := m["slotType"].(string)
					if slotType != filter {
						return
					}
				}
				// Normalize int64 (from JSON-free map passthrough the
				// values arrive as int; keep as-is for the frontend).
				if ts, ok := m["ts"].(int64); ok {
					m["ts"] = ts
				}
			}
			sse.SendEvent("slot:stateChanged", payload)
		})
		defer unsub()
	}

	sse.SendEvent("status", map[string]string{"state": "connected"})

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			sse.SendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
		}
	}
}

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
