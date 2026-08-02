package api

import (
	"net/http"

	"backend/internal/i18n"
	"backend/internal/infra"
)

// LogsSSE streams structured log entries in real-time via Server-Sent
// Events, mirroring the TypeScript /api/logs SSE handler.
func (h *Handlers) LogsSSE(w http.ResponseWriter, r *http.Request) {
	sse := NewSSEStream(w)
	if sse == nil {
		writeError(w, http.StatusInternalServerError, i18n.TFromRequest(r, "api.common.streamingNotSupported"))
		return
	}

	filter := parseLogFilter(r)
	ctx := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(ctx)
	}()
	StreamLogs(sse, filter, ctx)
}

// LogsHistory returns historical log entries as a JSON array, matching
// the /api/logs/history REST endpoint.
func (h *Handlers) LogsHistory(w http.ResponseWriter, r *http.Request) {
	sink := infra.GetGlobalSink()
	filter := parseLogFilter(r)
	entries := sink.Query(filter)
	writeJSON(w, http.StatusOK, entries)
}

// LogsLatest returns the most recent log entries as a JSON array,
// matching the /api/logs/latest endpoint used by the console-log
// frontend component. Returns the last 20 entries by default.
func (h *Handlers) LogsLatest(w http.ResponseWriter, r *http.Request) {
	sink := infra.GetGlobalSink()
	limit := queryInt(r, "limit", 20)
	if limit > 200 {
		limit = 200
	}
	filter := parseLogFilter(r)
	filter.Limit = limit
	entries := sink.Query(filter)
	writeJSON(w, http.StatusOK, entries)
}

func parseLogFilter(r *http.Request) infra.LogQueryFilter {
	q := r.URL.Query()
	filter := infra.LogQueryFilter{
		Module:   q.Get("module"),
		DagID:    q.Get("dagId"),
		NodeID:   q.Get("nodeId"),
		TraceID:  q.Get("traceId"),
		TaskType: q.Get("taskType"),
	}

	if levelStr := q.Get("level"); levelStr != "" {
		filter.HasLevel = true
		switch levelStr {
		case "debug":
			filter.Level = infra.LevelDebug
		case "info":
			filter.Level = infra.LevelInfo
		case "warn":
			filter.Level = infra.LevelWarn
		case "error":
			filter.Level = infra.LevelError
		}
	}

	if limitStr := q.Get("limit"); limitStr != "" {
		n := 0
		for _, c := range limitStr {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		if n > 0 {
			filter.Limit = n
		}
	}

	return filter
}
