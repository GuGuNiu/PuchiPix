package sse

import (
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestSSEStormAggregation exercises the SSE batch aggregator under load,
// simulating a storm of 1400 tasks emitting events at once.
func TestSSEStormAggregation(t *testing.T) {
	rec := httptest.NewRecorder()

	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	// Wait for writerLoop to start
	time.Sleep(50 * time.Millisecond)

	// Simulate 1400 tasks emitting events at once
	const totalEvents = 1400
	var sentCount atomic.Int64
	var wg sync.WaitGroup

	// Send concurrently (task storm)
	for i := 0; i < totalEvents; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if stream.TrySendEvent("dag:nodeStateChanged", map[string]any{
				"dagID":  string(rune('a' + idx%26)),
				"nodeID": idx,
				"state":  "running",
			}) {
				sentCount.Add(1)
			}
		}(i)
	}

	wg.Wait()

	// Let the aggregator flush
	time.Sleep(200 * time.Millisecond)

	finalSent := sentCount.Load()
	t.Logf("Total events sent: %d / %d", finalSent, totalEvents)

	aggCount := stream.AggregatedCount()
	t.Logf("Aggregation triggered: %d times", aggCount)

	// All events must be accepted (none lost)
	if finalSent != totalEvents {
		t.Errorf("Event loss detected: sent %d, expected %d", finalSent, totalEvents)
	}

	// Note: whether the aggregator triggers depends on queue backlog. With a
	// fast consumer the queue may never back up, so aggregation may not fire —
	// expected, since it only works during backlog.
	t.Logf("Queue length: %d, Threshold: %d", len(stream.queue), sseAggregateThreshold)
}

// TestSSEAggregatorDirect tests aggregator logic directly.
func TestSSEAggregatorDirect(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	time.Sleep(50 * time.Millisecond)

	// Fill the aggregator directly to simulate queue backlog
	const batchSize = 150 // exceeds threshold 100
	for i := 0; i < batchSize; i++ {
		stream.aggregator.add(sseEvent{
			event: "dag:nodeStateChanged",
			data:  []byte(`{"idx":` + string(rune('0'+i%10)) + `}`),
		})
	}

	// Let the aggregator process
	time.Sleep(150 * time.Millisecond)

	aggCount := stream.AggregatedCount()
	t.Logf("Aggregation triggered: %d times", aggCount)

	if aggCount == 0 {
		t.Error("Expected aggregation to be triggered after adding 150 events")
	}
}

// TestSSEQueueExpansion checks SSE queue capacity after expansion.
func TestSSEQueueExpansion(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	// Queue capacity must be >= 4096
	queueCap := cap(stream.queue)
	t.Logf("Queue capacity: %d", queueCap)

	if queueCap < 4096 {
		t.Errorf("Queue capacity too small: expected >= 4096, got %d", queueCap)
	}
}

// TestSSEProgressThrottling tests progress event throttling.
func TestSSEProgressThrottling(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	time.Sleep(50 * time.Millisecond)

	const taskID = "gallery:123"
	const progressEvents = 20

	// Burst 20 progress events (high-frequency updates)
	sent := 0
	for i := 0; i < progressEvents; i++ {
		if stream.TrySendEvent("task:progress", map[string]any{
			"taskId":   taskID,
			"taskType": "gallery",
			"progress": float64(i * 5),
		}) {
			sent++
		}
		time.Sleep(10 * time.Millisecond) // one send per 10ms
	}

	t.Logf("Progress events sent: %d / %d", sent, progressEvents)

	// All events must be accepted: throttling lives in the TaskStreamSSE
	// layer, not the SSE layer — SSE only aggregates, it does not throttle.
	if sent != progressEvents {
		t.Errorf("SSE layer should accept all events: sent %d, expected %d", sent, progressEvents)
	}
}

// TestSSEAggregatorFlush tests the aggregator flush path.
func TestSSEAggregatorFlush(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	time.Sleep(50 * time.Millisecond)

	// Fill the aggregator
	const batchSize = 150 // exceeds threshold 100
	for i := 0; i < batchSize; i++ {
		stream.aggregator.add(sseEvent{
			event: "test",
			data:  []byte(`{"idx":` + string(rune('0'+i%10)) + `}`),
		})
	}

	// Flush manually
	stream.aggregator.flush()

	time.Sleep(100 * time.Millisecond)

	aggCount := stream.AggregatedCount()
	if aggCount == 0 {
		t.Error("Expected aggregation count > 0 after flush")
	}
}

// BenchmarkSSEStorm benchmarks SSE storm performance.
func BenchmarkSSEStorm(b *testing.B) {
	for i := 0; i < b.N; i++ {
		rec := httptest.NewRecorder()
		stream := NewSSEStream(rec)
		if stream == nil {
			b.Fatal("Failed to create SSE stream")
		}

		// Send 1000 events
		for j := 0; j < 1000; j++ {
			stream.TrySendEvent("dag:nodeStateChanged", map[string]any{
				"dagID":  "test",
				"nodeID": j,
			})
		}

		stream.Close()
	}
}
