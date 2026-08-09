package api

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/infra"
)

// TestNewSSEStream verifies that SSE headers are set correctly and
// the stream is initialized when the ResponseWriter supports flushing.
func TestNewSSEStream(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)

	require.NotNil(t, sse)
	assert.Equal(t, "text/event-stream", w.Header().Get("Content-Type"))
	assert.Equal(t, "no-cache, no-transform", w.Header().Get("Cache-Control"))
	assert.Equal(t, "keep-alive", w.Header().Get("Connection"))
	assert.Equal(t, "no", w.Header().Get("X-Accel-Buffering"))
	assert.Equal(t, 200, w.Code)
}

// TestSSESendEvent verifies that named events are formatted with
// the correct SSE wire format (event: name\ndata: payload\n\n).
func TestSSESendEvent(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)

	sse.SendEvent("update", map[string]string{"key": "value"})
	body := w.Body.String()
	assert.Contains(t, body, "event: update")
	assert.Contains(t, body, `"key":"value"`)
}

// TestSSESendKeepalive verifies that keepalive comments are written
// in the correct SSE comment format.
func TestSSESendKeepalive(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)

	sse.SendKeepalive()
	body := w.Body.String()
	assert.Contains(t, body, ": keepalive")
}

// TestStreamLogsShutdown verifies that StreamLogs exits cleanly when
// the context channel is closed, preventing goroutine leaks.
func TestStreamLogsShutdown(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)

	filter := infra.LogQueryFilter{}
	ctx := make(chan struct{})
	done := make(chan struct{})
	go func() {
		StreamLogs(sse, filter, ctx)
		close(done)
	}()

	close(ctx)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("StreamLogs did not exit after context close")
	}
}

// TestSSEBurstTrySendEventNonBlocking verifies that TrySendEvent does
// NOT block the caller under an event burst (the 260809 regression that
// caused bulk task creation to stall the EventBus and starve the
// heartbeat, force-closing the frontend connection). The writer drains
// the queue independently; the caller must return promptly even when
// the queue exceeds its capacity.
func TestSSEBurstTrySendEventNonBlocking(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)
	defer sse.Close()

	// Burst far more events than the queue capacity (256) — a slow
	// consumer is simulated by NOT reading the recorder body. Every
	// TrySendEvent must return quickly (non-blocking).
	done := make(chan struct{})
	go func() {
		for i := 0; i < 5000; i++ {
			sse.TrySendEvent("task:progress", map[string]any{"taskId": i, "progress": i})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("TrySendEvent blocked under burst — this is the 260809 SSE stall regression")
	}

	// Dropped counter should be non-zero once the queue overflows, but
	// the stream must remain usable.
	time.Sleep(50 * time.Millisecond)
	_ = sse.Dropped()
	ok := sse.TrySendEvent("heartbeat", map[string]string{"ts": "x"})
	assert.True(t, ok, "stream must remain usable after burst")
}

// TestSSEEventOrderingPreserved verifies synchronous SendEvent calls
// are flushed in FIFO order even when interleaved with non-blocking
// TrySendEvent calls.
func TestSSEEventOrderingPreserved(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)
	defer sse.Close()

	sse.SendEvent("initial", map[string]string{"seq": "1"})
	sse.TrySendEvent("task:created", map[string]string{"seq": "2"})
	sse.SendEvent("task:completed", map[string]string{"seq": "3"})

	time.Sleep(100 * time.Millisecond)
	body := w.Body.String()
	i1 := indexOf(body, `"seq":"1"`)
	i2 := indexOf(body, `"seq":"2"`)
	i3 := indexOf(body, `"seq":"3"`)
	assert.Greater(t, i1, -1, "initial event must be present")
	assert.Greater(t, i2, -1, "created event must be present")
	assert.Greater(t, i3, -1, "completed event must be present")
	assert.Less(t, i1, i2, "FIFO order: initial before created")
	assert.Less(t, i2, i3, "FIFO order: created before completed")
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// TestSSEAfterCloseNoPanic verifies that SendEvent/TrySendEvent after
// Close are safe no-ops (no panic, no block).
func TestSSEAfterCloseNoPanic(t *testing.T) {
	w := httptest.NewRecorder()
	sse := NewSSEStream(w)
	require.NotNil(t, sse)
	sse.Close()

	assert.NotPanics(t, func() {
		sse.SendEvent("x", map[string]string{"a": "b"})
		sse.TrySendEvent("y", map[string]string{"a": "b"})
		sse.SendKeepalive()
		sse.Close()
	})
}
