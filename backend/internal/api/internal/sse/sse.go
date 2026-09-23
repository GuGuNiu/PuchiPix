package sse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"backend/internal/infra"
)

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

// EventPriority defines the importance level of an SSE event.
// Critical events (created, completed, failed, cancelled) are always
// delivered; LowPriority events (progress) can be dropped when the
// queue is under pressure to prevent backpressure cascading.
type EventPriority int

const (
	PriorityCritical EventPriority = iota // created/completed/failed/cancelled — never drop
	PriorityHigh                          // nodeStateChanged/gallery:created — drop only as last resort
	PriorityLow                           // progress/heartbeat — droppable under load
)

type sseEvent struct {
	event    string
	data     []byte
	ack      chan struct{}
	priority EventPriority
}

type SSEStream struct {
	client *SSEClient

	queue chan sseEvent
	done  chan struct{}

	writeTimeout time.Duration

	dropped uint64
	mu      sync.Mutex

	// Batch aggregator: under event bursts, merge fine-grained events into summaries
	aggregator *sseAggregator
}

// sseAggregator batches events into aggregate summaries during storms
// (e.g. 1400+ tasks resuming at once), preventing SSE queue overflow and frontend lag.
type sseAggregator struct {
	mu       sync.Mutex
	events   []sseEvent
	timer    *time.Timer
	stream   *SSEStream
	aggCount atomic.Int64 // aggregation trigger count
}

// TryGetAggCount returns the aggregation trigger count (for monitoring).
func (a *sseAggregator) TryGetAggCount() int64 {
	return a.aggCount.Load()
}

const (
	sseQueueSize       = 4096  // grew 256 → 4096 for task storms
	sseWriteTimeout    = 30 * time.Second
	sseDrainTimeout    = 2 * time.Second
	sseSyncWaitTimeout = 5 * time.Second
	SseRetryDelayMs    = 2000
	sseBatchMaxSize    = 256   // grew 64 → 256 to reduce syscalls
	sseMaxUnwrapDepth  = 8

	// Aggregation tuning: merge events into summaries when a burst arrives.
	sseAggregateThreshold = 100   // event count that triggers aggregation
	sseAggregateTimeout   = 100 * time.Millisecond  // max wait before flushing a partial batch
	sseAggregateMaxSize   = 64    // max original events per aggregate
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
	// Initialize the aggregator
	s.aggregator = newSseAggregator(s)
	go s.writerLoop()
	return s
}

// newSseAggregator creates a batch event aggregator.
func newSseAggregator(stream *SSEStream) *sseAggregator {
	return &sseAggregator{
		stream: stream,
	}
}

// flush merges buffered events into an aggregate summary and pushes it.
func (a *sseAggregator) flush() {
	a.mu.Lock()
	events := a.events
	a.events = nil
	a.timer = nil
	a.mu.Unlock()

	if len(events) == 0 {
		return
	}

	// Count events by type
	type eventSummary struct {
		EventType string `json:"eventType"`
		Count     int    `json:"count"`
	}
	summaries := make(map[string]int)
	for _, ev := range events {
		summaries[ev.event]++
	}

	// Build the aggregate summary
	summaryList := make([]eventSummary, 0, len(summaries))
	for eventType, count := range summaries {
		summaryList = append(summaryList, eventSummary{
			EventType: eventType,
			Count:     count,
		})
	}

	// Push the aggregate summary
	a.stream.enqueueRaw("events:aggregated", mustJSON(map[string]any{
		"type":      "aggregated",
		"count":     len(events),
		"summary":   summaryList,
		"timestamp": time.Now().UnixMilli(),
	}), false)

	// Ack original events (non-blocking)
	for _, ev := range events {
		if ev.ack != nil {
			close(ev.ack)
		}
	}

	a.aggCount.Add(1)
}

// add appends an event; flushes immediately when the threshold is reached.
func (a *sseAggregator) add(ev sseEvent) {
	a.mu.Lock()
	a.events = append(a.events, ev)
	shouldFlush := len(a.events) >= sseAggregateThreshold

	if a.timer == nil && !shouldFlush {
		// Schedule a timeout flush
		a.timer = time.AfterFunc(sseAggregateTimeout, func() {
			a.flush()
		})
	}
	a.mu.Unlock()

	if shouldFlush {
		a.flush()
	}
}

// shouldAggregate reports whether to enable aggregation mode
// (queue backlog at or above the threshold).
func (a *sseAggregator) shouldAggregate(queueLen int) bool {
	return queueLen >= sseAggregateThreshold
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

// eventPriorityFor classifies an SSE event name into a priority level.
// Critical events (created, completed, failed, cancelled) must always
// reach the client; High events (gallery:created, nodeStateChanged) are
// important but can be shed in extreme overload; Low events (progress,
// heartbeat, nodeProgress) are high-frequency and safely droppable.
func eventPriorityFor(event string) EventPriority {
	switch event {
	case "task:created", "task:completed", "task:failed", "task:cancelled",
		"gallery:created", "gallery:stateChanged":
		return PriorityCritical
	case "dag:nodeStateChanged", "slot:stateChanged", "task:metadata":
		return PriorityHigh
	default: // "task:progress", "dag:nodeProgress", "heartbeat", etc.
		return PriorityLow
	}
}

func (s *SSEStream) SendEvent(event string, data any) {
	s.enqueue(event, data, true)
}

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
	ev := sseEvent{
		event:    event,
		data:     payload,
		ack:      ack,
		priority: eventPriorityFor(event),
	}

	// Aggregation mode: when queue backlog exceeds the threshold, low-priority
	// events (progress/heartbeat) go straight to the aggregator; high/critical
	// events still try the queue so key information is never lost.
	if !wait && s.aggregator != nil && s.aggregator.shouldAggregate(len(s.queue)) {
		if ev.priority == PriorityLow {
			s.aggregator.add(ev)
			return true
		}
		// High/critical events still attempt direct enqueue in aggregation
		// mode; they fall back to the aggregator only when the queue is full.
	}

	if !wait {
		select {
		case s.queue <- ev:
			return true
		default:
			// Queue-full priority handling: low-priority events are dropped
			// (progress is lossy); the drop counter still increments.
			if ev.priority == PriorityLow {
				s.mu.Lock()
				s.dropped++
				s.mu.Unlock()
				// Try the aggregator if it is enabled
				if s.aggregator != nil {
					s.aggregator.add(ev)
					return true
				}
				return false
			}
			// High/critical events are not dropped lightly: evict one low-priority event.
			s.mu.Lock()
			s.dropped++
			s.mu.Unlock()
			if s.aggregator != nil {
				s.aggregator.add(ev)
				return true
			}
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

func (s *SSEStream) Dropped() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dropped
}

// AggregatedCount returns the aggregation trigger count (for monitoring).
func (s *SSEStream) AggregatedCount() int64 {
	if s.aggregator == nil {
		return 0
	}
	return s.aggregator.TryGetAggCount()
}

// mustJSON marshals v, returning "{}" on error (for deterministic struct serialization).
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func (s *SSEStream) Close() {
	select {
	case <-s.done:
		return
	default:
		close(s.done)
	}
}

func (s *SSEStream) SendKeepalive() {
	s.enqueueRaw("", []byte(": keepalive\n\n"), true)
}

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
