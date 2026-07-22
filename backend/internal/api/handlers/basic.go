package handlers

import (
	"net/http"
	"runtime"
	"time"
)

// Health returns a simple status check that the server is alive and
// the database pool is reachable.
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

// System returns runtime information for the system info dashboard.
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

// Stats returns aggregate counts for the dashboard overview panel.
// Fields match the frontend's Stats type: galleries, tasks,
// downloadHistory, plus speed/disk metrics for the task bar.
func (h *Handlers) Stats(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"galleries":         0,
			"tasks":             0,
			"downloadHistory":   0,
			"current_speed_str": "0 B/s",
			"disk_io_str":       "--",
		})
		return
	}

	ctx := r.Context()
	var galleryCount, taskCount, historyCount int

	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM galleries").Scan(&galleryCount)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks").Scan(&taskCount)
	h.DB.QueryRow(ctx, "SELECT COUNT(*) FROM download_history").Scan(&historyCount)

	writeJSON(w, http.StatusOK, map[string]any{
		"galleries":         galleryCount,
		"tasks":             taskCount,
		"downloadHistory":   historyCount,
		"current_speed_str": "0 B/s",
		"disk_io_str":       "--",
	})
}

// Sites returns the list of supported site providers, sourced
// dynamically from the injected SiteRegistry.
func (h *Handlers) Sites(w http.ResponseWriter, r *http.Request) {
	if h.SiteReg == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, h.SiteReg.GetSiteInfos())
}
