package sse

import (
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestSSEStormAggregation 测试 SSE 批量聚合器在高压下的表现
// 模拟 1400 个任务同时产生事件的风暴场景
func TestSSEStormAggregation(t *testing.T) {
	// 创建测试用的 ResponseRecorder
	rec := httptest.NewRecorder()

	// 创建 SSE Stream
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	// 等待 writerLoop 启动
	time.Sleep(50 * time.Millisecond)

	// 模拟 1400 个任务同时产生事件
	const totalEvents = 1400
	var sentCount atomic.Int64
	var wg sync.WaitGroup

	// 并发发送事件（模拟任务风暴）
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

	// 等待所有事件发送完成
	wg.Wait()

	// 等待聚合器 flush
	time.Sleep(200 * time.Millisecond)

	// 验证结果
	finalSent := sentCount.Load()
	t.Logf("Total events sent: %d / %d", finalSent, totalEvents)

	// 验证聚合触发
	aggCount := stream.AggregatedCount()
	t.Logf("Aggregation triggered: %d times", aggCount)

	// 断言：所有事件都被接受（没有丢失）
	if finalSent != totalEvents {
		t.Errorf("Event loss detected: sent %d, expected %d", finalSent, totalEvents)
	}

	// 注意：聚合器是否触发取决于队列是否积压
	// 在高速消费场景下，队列可能不会积压，聚合器可能不会触发
	// 这是正常行为 - 聚合器只在队列积压时工作
	t.Logf("Queue length: %d, Threshold: %d", len(stream.queue), sseAggregateThreshold)
}

// TestSSEAggregatorDirect 直接测试聚合器逻辑
func TestSSEAggregatorDirect(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	time.Sleep(50 * time.Millisecond)

	// 直接填充聚合器，模拟队列积压时的行为
	const batchSize = 150 // 超过阈值 100
	for i := 0; i < batchSize; i++ {
		stream.aggregator.add(sseEvent{
			event: "dag:nodeStateChanged",
			data:  []byte(`{"idx":` + string(rune('0'+i%10)) + `}`),
		})
	}

	// 等待聚合器处理
	time.Sleep(150 * time.Millisecond)

	// 验证聚合触发
	aggCount := stream.AggregatedCount()
	t.Logf("Aggregation triggered: %d times", aggCount)

	if aggCount == 0 {
		t.Error("Expected aggregation to be triggered after adding 150 events")
	}
}

// TestSSEQueueExpansion 测试 SSE 队列扩容后的容量
func TestSSEQueueExpansion(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	// 验证队列容量（cap）是否扩容到 4096
	queueCap := cap(stream.queue)
	t.Logf("Queue capacity: %d", queueCap)

	// 断言：队列容量应该 >= 4096
	if queueCap < 4096 {
		t.Errorf("Queue capacity too small: expected >= 4096, got %d", queueCap)
	}
}

// TestSSEProgressThrottling 测试 Progress 事件节流
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

	// 快速发送 20 个 progress 事件（模拟高频更新）
	sent := 0
	for i := 0; i < progressEvents; i++ {
		if stream.TrySendEvent("task:progress", map[string]any{
			"taskId":   taskID,
			"taskType": "gallery",
			"progress": float64(i * 5),
		}) {
			sent++
		}
		time.Sleep(10 * time.Millisecond) // 每 10ms 发送一次
	}

	t.Logf("Progress events sent: %d / %d", sent, progressEvents)

	// 验证：所有事件都被接受（节流在 TaskStreamSSE 层，不在 SSE 层）
	// SSE 层只负责聚合，不负责节流
	if sent != progressEvents {
		t.Errorf("SSE layer should accept all events: sent %d, expected %d", sent, progressEvents)
	}
}

// TestSSEAggregatorFlush 测试聚合器 flush 逻辑
func TestSSEAggregatorFlush(t *testing.T) {
	rec := httptest.NewRecorder()
	stream := NewSSEStream(rec)
	if stream == nil {
		t.Fatal("Failed to create SSE stream")
	}
	defer stream.Close()

	time.Sleep(50 * time.Millisecond)

	// 填充聚合器
	const batchSize = 150 // 超过阈值 100
	for i := 0; i < batchSize; i++ {
		stream.aggregator.add(sseEvent{
			event: "test",
			data:  []byte(`{"idx":` + string(rune('0'+i%10)) + `}`),
		})
	}

	// 手动触发 flush
	stream.aggregator.flush()

	// 等待处理
	time.Sleep(100 * time.Millisecond)

	// 验证聚合触发
	aggCount := stream.AggregatedCount()
	if aggCount == 0 {
		t.Error("Expected aggregation count > 0 after flush")
	}
}

// BenchmarkSSEStorm 基准测试：SSE 风暴场景性能
func BenchmarkSSEStorm(b *testing.B) {
	for i := 0; i < b.N; i++ {
		rec := httptest.NewRecorder()
		stream := NewSSEStream(rec)
		if stream == nil {
			b.Fatal("Failed to create SSE stream")
		}

		// 发送 1000 个事件
		for j := 0; j < 1000; j++ {
			stream.TrySendEvent("dag:nodeStateChanged", map[string]any{
				"dagID":  "test",
				"nodeID": j,
			})
		}

		stream.Close()
	}
}
