package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"backend/internal/infra"
)

// SSEClient holds the writer and flusher for a single SSE connection.
type SSEClient struct {
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

// SSEStream wraps an HTTP response for Server-Sent Events streaming,
// mirroring the TypeScript SSE route handler pattern.
type SSEStream struct {
	client *SSEClient
}

// NewSSEStream sets SSE headers and returns a stream ready to send
// events. Returns nil if the ResponseWriter does not support flushing.
func NewSSEStream(w http.ResponseWriter) *SSEStream {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	return &SSEStream{
		client: &SSEClient{w: w, flusher: flusher},
	}
}

// SendEvent writes a named SSE event with JSON-encoded data.
func (s *SSEStream) SendEvent(event string, data any) {
	s.client.mu.Lock()
	defer s.client.mu.Unlock()

	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	fmt.Fprintf(s.client.w, "event: %s\ndata: %s\n\n", event, payload)
	s.client.flusher.Flush()
}

// SendKeepalive writes a comment line to keep the connection alive
// through proxies that may timeout on idle connections.
func (s *SSEStream) SendKeepalive() {
	s.client.mu.Lock()
	defer s.client.mu.Unlock()
	fmt.Fprintf(s.client.w, ": keepalive\n\n")
	s.client.flusher.Flush()
}

// streamLogs subscribes to the global LogSink and pushes filtered
// entries to the SSE client, mirroring the TypeScript /api/logs SSE
// handler.
func StreamLogs(sse *SSEStream, filter infra.LogQueryFilter, ctx <-chan struct{}) {
	sink := infra.GetGlobalSink()

	history := sink.Query(filter)
	sse.SendEvent("history", history)

	var mu sync.Mutex
	unsub := sink.Subscribe(func(entry infra.StructuredLogEntry) {
		mu.Lock()
		defer mu.Unlock()
		if filter.HasLevel && entry.LevelValue < filter.Level {
			return
		}
		if filter.Module != "" && entry.Module != filter.Module {
			return
		}
		if filter.DagID != "" && entry.Context.DagID != filter.DagID {
			return
		}
		if filter.NodeID != "" && entry.Context.NodeID != filter.NodeID {
			return
		}
		if filter.TraceID != "" && entry.Context.TraceID != filter.TraceID {
			return
		}
		if filter.TaskType != "" && entry.Context.TaskType != filter.TaskType {
			return
		}
		sse.SendEvent("log", entry)
	})

	// Heartbeat: a named "heartbeat" event every 15s so the frontend's
	// connection watchdog can reset its liveness timer. (Previously a
	// ": keepalive" comment line was sent — but EventSource does not
	// dispatch any event for comment-only lines, so a watchdog that
	// keys off incoming events could never observe liveness.)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx:
			unsub()
			return
		case <-ticker.C:
			sse.SendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
		}
	}
}
