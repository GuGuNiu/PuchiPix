package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	ssepkg "backend/internal/api/internal/sse"
	"backend/internal/infra"
)

// TestNewSSEStream verifies that SSE headers are set correctly and
// the stream is initialized when the ResponseWriter supports flushing.
func TestNewSSEStream(t *testing.T) {
	w := httptest.NewRecorder()
	stream := ssepkg.NewSSEStream(w)

	require.NotNil(t, stream)
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
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)

	stream.SendEvent("update", map[string]string{"key": "value"})
	body := w.Body.String()
	assert.Contains(t, body, "event: update")
	assert.Contains(t, body, `"key":"value"`)
}

// TestSSESendKeepalive verifies that keepalive comments are written
// in the correct SSE comment format.
func TestSSESendKeepalive(t *testing.T) {
	w := httptest.NewRecorder()
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)

	stream.SendKeepalive()
	body := w.Body.String()
	assert.Contains(t, body, ": keepalive")
}

// TestSSEStreamRetryField verifies the retry frame is the very first
// bytes on the wire so EventSource applies it to reconnection timing.
func TestSSEStreamRetryField(t *testing.T) {
	w := newRecordingResponseWriter()
	s := ssepkg.NewSSEStream(w)
	require.NotNil(t, s)
	defer s.Close()

	want := fmt.Sprintf("retry: %d\n\n", ssepkg.SseRetryDelayMs)
	assert.True(t, strings.HasPrefix(w.written(), want),
		"stream should start with %q, got %q", want, w.written())
}

// TestSSEStreamEventDelivery verifies named events survive the batched
// writer path and arrive as spec-compliant frames.
func TestSSEStreamEventDelivery(t *testing.T) {
	w := newRecordingResponseWriter()
	s := ssepkg.NewSSEStream(w)
	require.NotNil(t, s)
	defer s.Close()

	s.SendEvent("task:progress", map[string]any{"taskId": 1})
	deadline := time.After(2 * time.Second)
	for {
		if strings.Contains(w.written(), "event: task:progress") {
			break
		}
		select {
		case <-deadline:
			t.Fatal("event was not written within 2s")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// TestStreamLogsShutdown verifies that sse.StreamLogs exits cleanly when
// the context channel is closed, preventing goroutine leaks.
func TestStreamLogsShutdown(t *testing.T) {
	w := httptest.NewRecorder()
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)

	filter := infra.LogQueryFilter{}
	ctx := make(chan struct{})
	done := make(chan struct{})
	go func() {
		ssepkg.StreamLogs(stream, filter, ctx)
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
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)
	defer stream.Close()

	// Burst far more events than the queue capacity (256) — a slow
	// consumer is simulated by NOT reading the recorder body. Every
	// TrySendEvent must return quickly (non-blocking).
	done := make(chan struct{})
	go func() {
		for i := 0; i < 5000; i++ {
			stream.TrySendEvent("task:progress", map[string]any{"taskId": i, "progress": i})
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
	_ = stream.Dropped()
	ok := stream.TrySendEvent("heartbeat", map[string]string{"ts": "x"})
	assert.True(t, ok, "stream must remain usable after burst")
}

// TestSSEEventOrderingPreserved verifies synchronous SendEvent calls
// are flushed in FIFO order even when interleaved with non-blocking
// TrySendEvent calls.
func TestSSEEventOrderingPreserved(t *testing.T) {
	w := httptest.NewRecorder()
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)
	defer stream.Close()

	stream.SendEvent("initial", map[string]string{"seq": "1"})
	stream.TrySendEvent("task:created", map[string]string{"seq": "2"})
	stream.SendEvent("task:completed", map[string]string{"seq": "3"})

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
	stream := ssepkg.NewSSEStream(w)
	require.NotNil(t, stream)
	stream.Close()

	assert.NotPanics(t, func() {
		stream.SendEvent("x", map[string]string{"a": "b"})
		stream.TrySendEvent("y", map[string]string{"a": "b"})
		stream.SendKeepalive()
		stream.Close()
	})
}

type recordingResponseWriter struct {
	mu         sync.Mutex
	header     http.Header
	body       strings.Builder
	flushes    int
	deadline   bool
	deadlineAt time.Time
}

func newRecordingResponseWriter() *recordingResponseWriter {
	return &recordingResponseWriter{header: make(http.Header)}
}

func (w *recordingResponseWriter) Header() http.Header { return w.header }

func (w *recordingResponseWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.WriteString(string(b))
}

func (w *recordingResponseWriter) WriteHeader(int) {}

func (w *recordingResponseWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.flushes++
}

func (w *recordingResponseWriter) SetWriteDeadline(t time.Time) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.deadline = true
	w.deadlineAt = t
	return nil
}

func (w *recordingResponseWriter) written() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.String()
}

func (w *recordingResponseWriter) flushCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flushes
}

// TestSSEStreamBatchReducesFlushCount enqueues the burst sequentially from
// a single goroutine, mirroring how the EventBus dispatches task:created
// for 27 bulk-created tasks. With a 64-event cap a 128-event burst needs
// only 2 flushes in theory; burst/2 is the acceptance threshold (>=50%
// reduction).
func TestSSEStreamBatchReducesFlushCount(t *testing.T) {
	w := newRecordingResponseWriter()
	s := ssepkg.NewSSEStream(w)
	require.NotNil(t, s)
	defer s.Close()

	const burst = 128
	for i := 0; i < burst; i++ {
		s.TrySendEvent("task:progress", map[string]any{"taskId": i})
	}

	deadline := time.After(5 * time.Second)
	const marker = "task:progress"
	for {
		if strings.Count(w.written(), marker) >= burst {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("not all %d events written within 5s (got %d)", burst, strings.Count(w.written(), marker))
		case <-time.After(10 * time.Millisecond):
		}
	}

	if got := w.flushCount(); got >= burst/2 {
		t.Fatalf("expected flush count to drop below %d with batching, got %d", burst/2, got)
	}
}

// wrappedResponseWriter simulates middleware wrapping: only the
// innermost writer implements Flusher and SetWriteDeadline.
type wrappedResponseWriter struct {
	http.ResponseWriter
	inner http.ResponseWriter
}

func (w *wrappedResponseWriter) Unwrap() http.ResponseWriter { return w.inner }

// TestUnwrapResponseWriterThroughMiddleware verifies the recursive unwrap
// finds flush + deadline capabilities hidden behind middleware wrappers.
func TestUnwrapResponseWriterThroughMiddleware(t *testing.T) {
	inner := newRecordingResponseWriter()
	outer := &wrappedResponseWriter{inner: &wrappedResponseWriter{inner: inner}}

	flush, dl := ssepkg.UnwrapResponseWriter(outer)
	require.NotNil(t, flush, "unwrap failed to find Flusher through middleware wrappers")
	require.NotNil(t, dl, "unwrap failed to find writeDeadliner through middleware wrappers")

	flush2, dl2 := ssepkg.UnwrapResponseWriter(inner)
	require.NotNil(t, flush2, "unwrap failed on a bare writer")
	require.NotNil(t, dl2, "unwrap failed on a bare writer")
}

type selfReferencingWriter struct {
	http.ResponseWriter
}

func (w *selfReferencingWriter) Unwrap() http.ResponseWriter { return w }

// TestUnwrapResponseWriterSelfReferencing guards against infinite loops
// when a wrapper's Unwrap returns itself.
func TestUnwrapResponseWriterSelfReferencing(t *testing.T) {
	w := &selfReferencingWriter{}
	flush, dl := ssepkg.UnwrapResponseWriter(w)
	assert.Nil(t, flush)
	assert.Nil(t, dl)
}

type noFlushWriter struct {
	header http.Header
}

func (w noFlushWriter) Header() http.Header       { return w.header }
func (w noFlushWriter) Write([]byte) (int, error) { return 0, nil }
func (w noFlushWriter) WriteHeader(int)           {}

func TestSSEStreamNilWhenNoFlusher(t *testing.T) {
	nf := noFlushWriter{header: http.Header{}}
	assert.Nil(t, ssepkg.NewSSEStream(nf), "NewSSEStream should return nil when Flusher is unavailable")
}
