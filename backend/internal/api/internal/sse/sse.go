package sse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"backend/internal/infra"
)

// SSEClient holds the writer and flusher for a single SSE connection.
type SSEClient struct {
	w        http.ResponseWriter
	flusher  http.Flusher
	deadline writeDeadliner
	mu       sync.Mutex
	closed   bool
}

func (c *SSEClient) writeError() {
	c.closed = true
}

func (c *SSEClient) isClosed() bool {
	return c.closed
}

type sseEvent struct {
	event string
	data  []byte
	ack   chan struct{}
}

// SSEStream wraps an HTTP response for Server-Sent Events streaming.
type SSEStream struct {
	client *SSEClient

	queue chan sseEvent
	done  chan struct{}

	writeTimeout time.Duration

	dropped uint64
	mu      sync.Mutex
}

const (
	sseQueueSize       = 256
	sseWriteTimeout    = 30 * time.Second
	sseDrainTimeout    = 2 * time.Second
	sseSyncWaitTimeout = 5 * time.Second
	SseRetryDelayMs    = 2000
	sseBatchMaxSize    = 64
	sseMaxUnwrapDepth  = 8
)

type writeDeadliner interface{ SetWriteDeadline(time.Time) error }

type responseWriterUnwrapper interface{ Unwrap() http.ResponseWriter }

func UnwrapResponseWriter(w http.ResponseWriter) (http.Flusher, writeDeadliner) {
	var flush http.Flusher
	var dl writeDeadliner
	current := w
	for i := 0; current != nil && i < sseMaxUnwrapDepth; i++ {
		if flush == nil {
			if f, ok := current.(http.Flusher); ok {
				flush = f
			}
		}
		if dl == nil {
			if d, ok := current.(writeDeadliner); ok {
				dl = d
			}
		}
		unwrapper, ok := current.(responseWriterUnwrapper)
		if !ok {
			break
		}
		next := unwrapper.Unwrap()
		if next == current {
			break
		}
		current = next
	}
	return flush, dl
}

// NewSSEStream sets SSE headers and returns a stream ready to send events.
func NewSSEStream(w http.ResponseWriter) *SSEStream {
	flusher, deadline := UnwrapResponseWriter(w)
	if flusher == nil {
		return nil
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "retry: %d\n\n", SseRetryDelayMs)
	flusher.Flush()

	s := &SSEStream{
		client:       &SSEClient{w: w, flusher: flusher, deadline: deadline},
		queue:        make(chan sseEvent, sseQueueSize),
		done:         make(chan struct{}),
		writeTimeout: sseWriteTimeout,
	}
	go s.writerLoop()
	return s
}

func (s *SSEStream) writerLoop() {
	for {
		select {
		case ev := <-s.queue:
			batch := []sseEvent{ev}
			for len(batch) < sseBatchMaxSize {
				select {
				case ev2 := <-s.queue:
					batch = append(batch, ev2)
				default:
					goto flush
				}
			}
		flush:
			s.handleEventsBatch(batch)
		case <-s.done:
			drainCtx := time.NewTimer(sseDrainTimeout)
			defer drainCtx.Stop()
			for {
				select {
				case ev := <-s.queue:
					s.handleEventsBatch([]sseEvent{ev})
				case <-drainCtx.C:
					return
				default:
					return
				}
			}
		}
	}
}

func (s *SSEStream) handleEventsBatch(events []sseEvent) {
	var buf bytes.Buffer
	for _, ev := range events {
		if ev.event == "" {
			buf.Write(ev.data)
			continue
		}
		fmt.Fprintf(&buf, "event: %s\ndata: %s\n\n", ev.event, ev.data)
	}
	ok := s.writeFrame(buf.Bytes())
	for _, ev := range events {
		if ev.ack != nil {
			close(ev.ack)
		}
	}
	if !ok {
		s.Close()
	}
}

func (s *SSEStream) writeFrame(frame []byte) bool {
	c := s.client
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isClosed() {
		return false
	}

	if c.deadline != nil {
		_ = c.deadline.SetWriteDeadline(time.Now().Add(s.writeTimeout))
	}

	if _, err := c.w.Write(frame); err != nil {
		c.writeError()
		return false
	}
	c.flusher.Flush()
	return true
}

// SendEvent writes a named SSE event with JSON-encoded data. It is
// synchronous from the caller's perspective: the frame is written and
// flushed before SendEvent returns (bounded by sseSyncWaitTimeout).
func (s *SSEStream) SendEvent(event string, data any) {
	s.enqueue(event, data, true)
}

// TrySendEvent enqueues an event without blocking the caller. If the
// queue is full, the oldest event is dropped to make room.
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
		select {
		case s.queue <- ev:
			return true
		default:
			s.mu.Lock()
			s.dropped++
			s.mu.Unlock()
			select {
			case <-s.queue:
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

// Close stops the writer goroutine and releases the connection.
func (s *SSEStream) Close() {
	select {
	case <-s.done:
		return
	default:
		close(s.done)
	}
}

// SendKeepalive writes a comment line to keep the connection alive.
func (s *SSEStream) SendKeepalive() {
	s.enqueueRaw("", []byte(": keepalive\n\n"), true)
}

// StreamLogs subscribes to the global LogSink and pushes filtered
// entries to the SSE client.
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
