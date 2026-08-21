package infra

import (
	"sync"
)

// LogQueryFilter narrows a LogSink query by level, module, or trace context.
type LogQueryFilter struct {
	Level    LogLevel
	HasLevel bool
	Module   string
	DagID    string
	NodeID   string
	TraceID  string
	TaskType string
	Limit    int
}

// LogSinkListener receives every entry pushed into the sink.
type LogSinkListener func(entry StructuredLogEntry)

// LogSinkStats reports buffer occupancy and subscriber count.
type LogSinkStats struct {
	Total     int
	Capacity  int
	Listeners int
}

// LogSink is a thread-safe ring buffer holding structured log entries for
// API/CLI queries and real-time SSE fan-out.
type LogSink struct {
	mu             sync.RWMutex
	buffer         []StructuredLogEntry
	capacity       int
	listeners      map[uint64]LogSinkListener
	nextListenerID uint64
}

// NewLogSink creates a sink with the given ring-buffer capacity.
func NewLogSink(capacity int) *LogSink {
	if capacity < 100 {
		capacity = 1000
	}
	return &LogSink{
		buffer:    make([]StructuredLogEntry, 0, capacity),
		capacity:  capacity,
		listeners: make(map[uint64]LogSinkListener),
	}
}

// Push appends an entry, evicting the oldest when full, then fans out
// to every subscriber. Listeners are invoked outside the lock so a slow
// subscriber cannot block concurrent Push/Query calls.
func (s *LogSink) Push(entry StructuredLogEntry) {
	s.mu.Lock()
	s.buffer = append(s.buffer, entry)
	if len(s.buffer) > s.capacity {
		s.buffer = s.buffer[len(s.buffer)-s.capacity:]
	}
	listeners := make([]LogSinkListener, 0, len(s.listeners))
	for _, fn := range s.listeners {
		listeners = append(listeners, fn)
	}
	s.mu.Unlock()

	for _, fn := range listeners {
		func() {
			defer func() {
				if r := recover(); r != nil {
					_ = r
				}
			}()
			fn(entry)
		}()
	}
}

// Subscribe registers a listener and returns an unsubscribe function.
func (s *LogSink) Subscribe(fn LogSinkListener) func() {
	s.mu.Lock()
	id := s.nextListenerID
	s.nextListenerID++
	s.listeners[id] = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.listeners, id)
		s.mu.Unlock()
	}
}

// Query returns entries matching the filter, newest-first up to Limit.
func (s *LogSink) Query(filter LogQueryFilter) []StructuredLogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	limit := filter.Limit
	if limit <= 0 {
		limit = 500
	}

	var result []StructuredLogEntry
	for i := len(s.buffer) - 1; i >= 0 && len(result) < limit; i-- {
		e := s.buffer[i]
		if filter.HasLevel && e.LevelValue < filter.Level {
			continue
		}
		if filter.Module != "" && e.Module != filter.Module {
			continue
		}
		if filter.DagID != "" && e.Context.DagID != filter.DagID {
			continue
		}
		if filter.NodeID != "" && e.Context.NodeID != filter.NodeID {
			continue
		}
		if filter.TraceID != "" && e.Context.TraceID != filter.TraceID {
			continue
		}
		if filter.TaskType != "" && e.Context.TaskType != filter.TaskType {
			continue
		}
		result = append(result, e)
	}
	return result
}

func (s *LogSink) GetByDagID(dagID string, limit int) []StructuredLogEntry {
	return s.Query(LogQueryFilter{DagID: dagID, Limit: limit})
}

func (s *LogSink) GetByTraceID(traceID string, limit int) []StructuredLogEntry {
	return s.Query(LogQueryFilter{TraceID: traceID, Limit: limit})
}

func (s *LogSink) GetByModule(module string, limit int) []StructuredLogEntry {
	return s.Query(LogQueryFilter{Module: module, Limit: limit})
}

func (s *LogSink) GetRecent(limit int) []StructuredLogEntry {
	if limit <= 0 {
		limit = 500
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	start := len(s.buffer) - limit
	if start < 0 {
		start = 0
	}
	out := make([]StructuredLogEntry, len(s.buffer)-start)
	copy(out, s.buffer[start:])
	return out
}

func (s *LogSink) Stats() LogSinkStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return LogSinkStats{
		Total:     len(s.buffer),
		Capacity:  s.capacity,
		Listeners: len(s.listeners),
	}
}

func (s *LogSink) Clear() {
	s.mu.Lock()
	s.buffer = s.buffer[:0]
	s.mu.Unlock()
}
