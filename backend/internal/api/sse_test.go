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
