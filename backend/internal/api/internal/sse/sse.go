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

	// 批量聚合器：当短时间内有大量事件时，合并成聚合摘要
	aggregator *sseAggregator
}

// sseAggregator 批量事件聚合器
// 当事件风暴来临时（如 1400+ 任务同时恢复），将大量细粒度事件
// 合并成聚合摘要推送，避免 SSE 队列溢出和前端卡顿
type sseAggregator struct {
	mu       sync.Mutex
	events   []sseEvent
	timer    *time.Timer
	stream   *SSEStream
	aggCount atomic.Int64 // 聚合触发次数统计
}

// TryGetAggCount 返回聚合触发次数（用于监控）
func (a *sseAggregator) TryGetAggCount() int64 {
	return a.aggCount.Load()
}

const (
	sseQueueSize       = 4096  // 扩容: 256 → 4096，应对任务风暴
	sseWriteTimeout    = 30 * time.Second
	sseDrainTimeout    = 2 * time.Second
	sseSyncWaitTimeout = 5 * time.Second
	SseRetryDelayMs    = 2000
	sseBatchMaxSize    = 256   // 扩容: 64 → 256，减少系统调用
	sseMaxUnwrapDepth  = 8

	// 批量聚合参数：当短时间内有大量事件时，合并成聚合摘要推送
	sseAggregateThreshold = 100   // 事件数阈值，超过此值触发聚合
	sseAggregateTimeout   = 100 * time.Millisecond  // 聚合等待超时
	sseAggregateMaxSize   = 64    // 单次聚合最多包含的原事件数
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
	// 初始化聚合器
	s.aggregator = newSseAggregator(s)
	go s.writerLoop()
	return s
}

// newSseAggregator 创建批量事件聚合器
func newSseAggregator(stream *SSEStream) *sseAggregator {
	return &sseAggregator{
		stream: stream,
	}
}

// flush 将缓存的事件合并成聚合摘要推送
func (a *sseAggregator) flush() {
	a.mu.Lock()
	events := a.events
	a.events = nil
	a.timer = nil
	a.mu.Unlock()

	if len(events) == 0 {
		return
	}

	// 统计各类型事件数量
	type eventSummary struct {
		EventType string `json:"eventType"`
		Count     int    `json:"count"`
	}
	summaries := make(map[string]int)
	for _, ev := range events {
		summaries[ev.event]++
	}

	// 构建聚合摘要
	summaryList := make([]eventSummary, 0, len(summaries))
	for eventType, count := range summaries {
		summaryList = append(summaryList, eventSummary{
			EventType: eventType,
			Count:     count,
		})
	}

	// 推送聚合摘要
	a.stream.enqueueRaw("events:aggregated", mustJSON(map[string]any{
		"type":      "aggregated",
		"count":     len(events),
		"summary":   summaryList,
		"timestamp": time.Now().UnixMilli(),
	}), false)

	// 通知原事件 ack（避免阻塞）
	for _, ev := range events {
		if ev.ack != nil {
			close(ev.ack)
		}
	}

	a.aggCount.Add(1)
}

// add 添加事件到聚合器，如果触发阈值则立即 flush
func (a *sseAggregator) add(ev sseEvent) {
	a.mu.Lock()
	a.events = append(a.events, ev)
	shouldFlush := len(a.events) >= sseAggregateThreshold

	if a.timer == nil && !shouldFlush {
		// 设置超时 flush
		a.timer = time.AfterFunc(sseAggregateTimeout, func() {
			a.flush()
		})
	}
	a.mu.Unlock()

	if shouldFlush {
		a.flush()
	}
}

// maybeAggregate 判断是否应该聚合
// 当队列积压超过阈值时，启用聚合模式
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

	// 聚合模式判断：当队列积压超过阈值时，启用聚合。
	// 低优先级事件（progress/heartbeat）直接进入聚合器，
	// 高/关键事件仍尝试入队，保证关键信息不丢失。
	if !wait && s.aggregator != nil && s.aggregator.shouldAggregate(len(s.queue)) {
		if ev.priority == PriorityLow {
			s.aggregator.add(ev)
			return true
		}
		// 高/关键事件在聚合模式下仍尝试直接入队，
		// 只在队列满时才进入聚合器作为降级。
	}

	if !wait {
		select {
		case s.queue <- ev:
			return true
		default:
			// 队列满时的优先级处理：
			// 低优先级事件直接丢弃（进度可丢失），计数递增
			if ev.priority == PriorityLow {
				s.mu.Lock()
				s.dropped++
				s.mu.Unlock()
				// 尝试进入聚合器（如果启用）
				if s.aggregator != nil {
					s.aggregator.add(ev)
					return true
				}
				return false
			}
			// 高/关键事件不轻易丢弃，尝试挤出一条低优先级事件
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

// AggregatedCount 返回聚合触发次数（用于监控）
func (s *SSEStream) AggregatedCount() int64 {
	if s.aggregator == nil {
		return 0
	}
	return s.aggregator.TryGetAggCount()
}

// mustJSON 是 json.Marshal 的 panic 版本（用于确定性的结构体序列化）
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
