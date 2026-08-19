package infra

import (
	"testing"
)

// TestLoggerPushesToSink verifies that a log call is recorded in the
// attached LogSink, ensuring the dual-write contract holds.
func TestLoggerPushesToSink(t *testing.T) {
	sink := NewLogSink(100)
	logger := &Logger{
		module:   "TestModule",
		sink:     sink,
		minLevel: LevelInfo,
		isDev:    true,
	}
	logger.Info("test message")

	entries := sink.GetRecent(10)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Message != "test message" {
		t.Errorf("expected message 'test message', got '%s'", entries[0].Message)
	}
	if entries[0].Module != "TestModule" {
		t.Errorf("expected module 'TestModule', got '%s'", entries[0].Module)
	}
	if entries[0].Level != "INFO" {
		t.Errorf("expected level 'INFO', got '%s'", entries[0].Level)
	}
}

// TestLogLevelFilter verifies that messages below the minimum level
// are suppressed, preventing log noise in production.
func TestLogLevelFilter(t *testing.T) {
	sink := NewLogSink(100)
	logger := &Logger{
		module:   "Filtered",
		sink:     sink,
		minLevel: LevelWarn,
		isDev:    true,
	}
	logger.Info("below threshold")
	logger.Warn("at threshold")
	logger.Error("above threshold")

	entries := sink.GetRecent(10)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Message != "at threshold" {
		t.Errorf("first entry should be 'at threshold', got '%s'", entries[0].Message)
	}
	if entries[1].Message != "above threshold" {
		t.Errorf("second entry should be 'above threshold', got '%s'", entries[1].Message)
	}
}

// TestLoggerChildContext verifies that child loggers merge context
// fields, allowing trace identifiers to propagate without repetition.
func TestLoggerChildContext(t *testing.T) {
	sink := NewLogSink(100)
	logger := &Logger{
		module:   "Parent",
		sink:     sink,
		minLevel: LevelInfo,
		isDev:    true,
	}
	child := logger.Child(LogContext{DagID: "gallery-1", NodeID: "scrape"})
	child.Info("child message")

	entries := sink.GetRecent(10)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Context.DagID != "gallery-1" {
		t.Errorf("expected DagID 'gallery-1', got '%s'", entries[0].Context.DagID)
	}
	if entries[0].Context.NodeID != "scrape" {
		t.Errorf("expected NodeID 'scrape', got '%s'", entries[0].Context.NodeID)
	}
}

// TestLogSinkRingBuffer verifies that the buffer evicts oldest entries
// when capacity is exceeded, preventing unbounded memory growth.
func TestLogSinkRingBuffer(t *testing.T) {
	sink := NewLogSink(100)
	for i := 0; i < 150; i++ {
		sink.Push(StructuredLogEntry{
			Message:    "entry",
			Module:     "Test",
			LevelValue: LevelInfo,
		})
	}
	entries := sink.GetRecent(200)
	if len(entries) != 100 {
		t.Fatalf("expected 100 entries (ring buffer), got %d", len(entries))
	}
}

// TestLogSinkQuery verifies that the query filter narrows results by
// module and context fields.
func TestLogSinkQuery(t *testing.T) {
	sink := NewLogSink(100)
	sink.Push(StructuredLogEntry{Message: "a", Module: "Scheduler", LevelValue: LevelInfo, Context: LogContext{DagID: "dag-1"}})
	sink.Push(StructuredLogEntry{Message: "b", Module: "Scheduler", LevelValue: LevelInfo, Context: LogContext{DagID: "dag-2"}})
	sink.Push(StructuredLogEntry{Message: "c", Module: "Worker", LevelValue: LevelInfo, Context: LogContext{DagID: "dag-1"}})

	sched := sink.Query(LogQueryFilter{Module: "Scheduler", Limit: 10})
	if len(sched) != 2 {
		t.Errorf("expected 2 Scheduler entries, got %d", len(sched))
	}

	dag1 := sink.Query(LogQueryFilter{DagID: "dag-1", Limit: 10})
	if len(dag1) != 2 {
		t.Errorf("expected 2 dag-1 entries, got %d", len(dag1))
	}
}

// TestLogSinkSubscribe verifies that subscribers receive pushed entries
// in real-time and can unsubscribe.
func TestLogSinkSubscribe(t *testing.T) {
	sink := NewLogSink(100)
	var count int
	unsub := sink.Subscribe(func(entry StructuredLogEntry) {
		count++
	})
	sink.Push(StructuredLogEntry{Message: "a", Module: "Test"})
	sink.Push(StructuredLogEntry{Message: "b", Module: "Test"})
	if count != 2 {
		t.Fatalf("expected 2 subscriber calls, got %d", count)
	}
	unsub()
	sink.Push(StructuredLogEntry{Message: "c", Module: "Test"})
	if count != 2 {
		t.Errorf("expected no more calls after unsubscribe, got %d", count)
	}
}

// TestLogSinkStats verifies the stats snapshot reflects buffer state.
func TestLogSinkStats(t *testing.T) {
	sink := NewLogSink(100)
	sink.Push(StructuredLogEntry{Message: "a", Module: "Test"})
	sink.Push(StructuredLogEntry{Message: "b", Module: "Test"})
	stats := sink.Stats()
	if stats.Total != 2 {
		t.Errorf("expected total 2, got %d", stats.Total)
	}
	if stats.Capacity != 100 {
		t.Errorf("expected capacity 100, got %d", stats.Capacity)
	}
}
