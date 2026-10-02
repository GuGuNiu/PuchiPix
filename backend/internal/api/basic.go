package api

import (
	"net/http"
	"runtime"
	"time"

	"backend/internal/infra"
)

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	}

	if h.DB != nil {
		if err := h.DB.Ping(r.Context()); err != nil {
			status["status"] = "degraded"
			status["database"] = "unreachable"
			writeJSON(w, http.StatusServiceUnavailable, status)
			return
		}
		status["database"] = "ok"
	}

	writeJSON(w, http.StatusOK, status)
}

func (h *Handlers) System(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	writeJSON(w, http.StatusOK, map[string]any{
		"version":    "0.1.0-go",
		"goVersion":  runtime.Version(),
		"goroutines": runtime.NumGoroutine(),
		"memAlloc":   m.Alloc,
		"memSys":     m.Sys,
		"uptime":     time.Since(startTime).String(),
		"cpuCores":   runtime.NumCPU(),
	})
}

var startTime = time.Now()

func (h *Handlers) Stats(w http.ResponseWriter, r *http.Request) {
	result := map[string]any{
		"galleries":       0,
		"tasks":           0,
		"downloadHistory": 0,
		"speed_rating":    0,
	}

	if h.DB != nil {
		ctx := r.Context()
		var galleryCount, taskCount, historyCount int
		h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries").Scan(&galleryCount)
		h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks").Scan(&taskCount)
		h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_history").Scan(&historyCount)
		result["galleries"] = galleryCount
		result["tasks"] = taskCount
		result["downloadHistory"] = historyCount
	}

	// Live throughput: diff the global download/write byte counters over
	// the window since the previous /api/stats request, so the window
	// tracks the client's polling interval.
	netBps, diskBps := infra.ThroughputSnapshot()
	avgBps := infra.AvgNetBps()
	result["current_speed"] = roundTo2(netBps)
	result["current_speed_str"] = infra.FormatBytesPerSec(netBps)
	result["disk_io_str"] = infra.FormatBytesPerSec(diskBps)
	result["avg_speed"] = roundTo2(avgBps)
	result["avg_speed_str"] = infra.FormatBytesPerSec(avgBps)

	if h.Sched != nil {
		slotSnapshot := h.Sched.GetSlotSnapshot()
		slots := make(map[string]any, len(slotSnapshot))
		for slotType, usage := range slotSnapshot {
			utilization := 0.0
			if usage.Max > 0 {
				utilization = float64(usage.Current) / float64(usage.Max) * 100
			}
			slots[slotType] = map[string]any{
				"current":     usage.Current,
				"max":         usage.Max,
				"available":   usage.Available,
				"utilization": roundTo2(utilization),
			}
		}
		result["slotUsage"] = slots

		schedStats := h.Sched.GetStats()
		result["schedulerQueueSize"] = schedStats.QueueSize
		result["schedulerByPriority"] = schedStats.ByPriority
	}

	if h.DagOrch != nil {
		dagStats := h.DagOrch.GetStats()
		result["dagTotal"] = dagStats.TotalDags
		// dagActive counts only truly-running DAGs; paused ones are reported
		// separately so the dashboard does not overstate concurrency.
		result["dagActive"] = dagStats.ActiveDags
		result["dagPaused"] = dagStats.PausedDags
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *Handlers) Sites(w http.ResponseWriter, r *http.Request) {
	if h.SiteReg == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, h.SiteReg.GetSiteInfos())
}
