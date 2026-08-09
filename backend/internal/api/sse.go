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
	// closed is set when a write error has been observed (e.g. the
	// client disconnected or a write timed out). Once closed, all
	// subsequent SendEvent calls are no-ops so the stream does not
	// accumulate goroutine churn on a dead connection.
	closed bool
}

// writeError reports whether the last write failed. It is called with
// the client mutex held.
func (c *SSEClient) writeError() {
	c.closed = true
}

// isClosed reports whether the connection has been marked dead.
func (c *SSEClient) isClosed() bool {
	return c.closed
}

// sseEvent is an internal queued event waiting for the writer goroutine.
type sseEvent struct {
	event string
	data  []byte // pre-marshaled JSON payload
	// ack is closed by the writer after the frame is written (or the
	// write failed). Non-nil only for synchronous SendEvent calls.
	ack chan struct{}
}

// SSEStream wraps an HTTP response for Server-Sent Events streaming.
//
// Concurrency model (260809 fix): writes are funneled through a bounded
// channel into a single writer goroutine. This decouples event producers
// (EventBus handlers running in TaskCreate/DAG/executor goroutines) from
// the HTTP write path — a slow client (TCP backpressure) can no longer
// block the event bus or starve the heartbeat, which previously caused
// the frontend watchdog (45s without any event) to force-close the
// connection when bulk task creation (e.g. 27 tasks) flooded the stream.
type SSEStream struct {
	client *SSEClient

	queue chan sseEvent
	done  chan struct{}

	writeTimeout time.Duration

	// dropped counts events discarded when the queue is full.
	dropped uint64
	mu      sync.Mutex
}

const (
	// sseQueueSize bounds the pending event buffer. When full, the
	// writer drains the oldest event so progress updates (which are
	// incremental) never pile up unboundedly behind a slow client.
	sseQueueSize = 256

	// sseWriteTimeout bounds a single HTTP write. A stalled client that
	// stops reading for this long is considered dead and the connection
	// is closed, freeing the goroutine.
	sseWriteTimeout = 30 * time.Second

	// sseDrainTimeout bounds how long the writer waits for the queue to
	// drain during shutdown.
	sseDrainTimeout = 2 * time.Second

	// sseSyncWaitTimeout bounds how long a synchronous SendEvent waits
	// for the writer to flush its frame. This prevents a pathological
	// writer stall from hanging the initial snapshot path.
	sseSyncWaitTimeout = 5 * time.Second
)

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

	s := &SSEStream{
		client:       &SSEClient{w: w, flusher: flusher},
		queue:        make(chan sseEvent, sseQueueSize),
		done:         make(chan struct{}),
		writeTimeout: sseWriteTimeout,
	}
	go s.writerLoop()
	return s
}

// writerLoop is the single writer goroutine. It serializes all writes
// to the HTTP response, applies the write deadline, and detects write
// errors so a dead client stops consuming goroutine resources.
func (s *SSEStream) writerLoop() {
	for {
		select {
		case ev := <-s.queue:
			s.handleEvent(ev)
		case <-s.done:
			// Drain remaining queued events best-effort within a short
			// window, then exit.
			drainCtx := time.NewTimer(sseDrainTimeout)
			defer drainCtx.Stop()
			for {
				select {
				case ev := <-s.queue:
					s.handleEvent(ev)
				case <-drainCtx.C:
					return
				default:
					return
				}
			}
		}
	}
}

// handleEvent writes one event and signals its ack (if any). On write
// failure the connection is marked dead and the writer loop exits.
func (s *SSEStream) handleEvent(ev sseEvent) {
	ok := s.writeEvent(ev)
	if ev.ack != nil {
		close(ev.ack)
	}
	if !ok {
		s.Close()
	}
}

// writeEvent writes the SSE frame for a pre-marshaled payload. Returns
// false on write error (connection dead).
func (s *SSEStream) writeEvent(ev sseEvent) bool {
	c := s.client
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isClosed() {
		return false
	}

	// Bound a single write so a stalled client cannot block forever.
	if cw, ok := c.w.(interface{ SetWriteDeadline(time.Time) error }); ok {
		_ = cw.SetWriteDeadline(time.Now().Add(s.writeTimeout))
	}

	// Comment-only frames (event == "") are written verbatim so
	// SendKeepalive emits ": keepalive\n\n" as the SSE spec requires.
	if ev.event == "" {
		if _, err := c.w.Write(ev.data); err != nil {
			c.writeError()
			return false
		}
		c.flusher.Flush()
		return true
	}

	if _, err := fmt.Fprintf(c.w, "event: %s\ndata: %s\n\n", ev.event, ev.data); err != nil {
		c.writeError()
		return false
	}
	// Flush has no return value; a failed flush surfaces on the next
	// write as an error, which we detect above.
	c.flusher.Flush()
	return true
}

// SendEvent writes a named SSE event with JSON-encoded data. It is
// synchronous from the caller's perspective: the frame is written and
// flushed before SendEvent returns (bounded by sseSyncWaitTimeout), so
// initial-snapshot ordering and tests remain deterministic. The actual
// HTTP write happens on the writer goroutine — a slow client delays
// only that goroutine, never the EventBus caller.
func (s *SSEStream) SendEvent(event string, data any) {
	s.enqueue(event, data, true)
}

// TrySendEvent enqueues an event without blocking the caller. If the
// queue is full, the oldest event is dropped to make room (progress
// updates are incremental; the frontend re-syncs via initial snapshot).
// Returns false when the connection is already closed.
func (s *SSEStream) TrySendEvent(event string, data any) bool {
	return s.enqueue(event, data, false)
}

func (s *SSEStream) enqueue(event string, data any, wait bool) bool {
	c := s.client
	c.mu.Lock()
	dead := c.isClosed()
	c.mu.Unlock()
	if dead {
		return false
	}

	payload, err := json.Marshal(data)
	if err != nil {
		return false
	}
	return s.enqueueRaw(event, payload, wait)
}

// enqueueRaw enqueues a pre-formatted SSE frame body. For comment-only
// frames (event == "") the payload is written verbatim.
func (s *SSEStream) enqueueRaw(event string, payload []byte, wait bool) bool {
	c := s.client
	c.mu.Lock()
	dead := c.isClosed()
	c.mu.Unlock()
	if dead {
		return false
	}

	var ack chan struct{}
	if wait {
		ack = make(chan struct{})
	}
	ev := sseEvent{event: event, data: payload, ack: ack}

	if !wait {
		// Non-blocking path: if the queue is full, drop the oldest event
		// to keep the most recent state, then enqueue the new one.
		select {
		case s.queue <- ev:
			return true
		default:
			s.mu.Lock()
			s.dropped++
			s.mu.Unlock()
			select {
			case <-s.queue: // drop one old event
			case <-s.done:
				return false
			}
			select {
			case s.queue <- ev:
				return true
			case <-s.done:
				return false
			}
		}
	}

	// Synchronous path: enqueue and wait for the writer ack, bounded so
	// a pathological stall never hangs the caller.
	select {
	case s.queue <- ev:
	case <-time.After(sseSyncWaitTimeout):
		return false
	case <-s.done:
		return false
	}
	select {
	case <-ack:
		return true
	case <-time.After(sseSyncWaitTimeout):
		return false
	case <-s.done:
		return false
	}
}

// Dropped reports how many events were discarded due to queue overflow.
func (s *SSEStream) Dropped() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dropped
}

// Close stops the writer goroutine and releases the connection. Safe to
// call multiple times.
func (s *SSEStream) Close() {
	select {
	case <-s.done:
		return
	default:
		close(s.done)
	}
}

// SendKeepalive writes a comment line to keep the connection alive
// through proxies that may timeout on idle connections. Comment lines
// (": ...") are ignored by EventSource, so this does not disturb
// business event ordering. Synchronous (waits for flush) so callers
// that rely on ordering are safe.
func (s *SSEStream) SendKeepalive() {
	s.enqueueRaw("", []byte(": keepalive\n\n"), true)
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
		sse.TrySendEvent("log", entry)
	})

	// Heartbeat: a named "heartbeat" event every 15s so the frontend's
	// connection watchdog can reset its liveness timer.
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx:
			unsub()
			return
		case <-ticker.C:
			sse.TrySendEvent("heartbeat", map[string]string{"ts": time.Now().Format(time.RFC3339)})
		}
	}
}
