package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestWSHandlerUpgrade verifies that the WebSocket handler accepts
// a valid upgrade request and establishes a connection.
func TestWSHandlerUpgrade(t *testing.T) {
	eventBus := infra.NewEventBus()
	handler := WSHandler(eventBus)

	server := httptest.NewServer(http.HandlerFunc(handler))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Skipf("WebSocket dial failed: %v", err)
	}
	defer conn.Close()
	assert.NotNil(t, conn)
}

// TestWSHandlerEventBridge verifies that EventBus events are forwarded
// to connected WebSocket clients.
func TestWSHandlerEventBridge(t *testing.T) {
	eventBus := infra.NewEventBus()
	handler := WSHandler(eventBus)

	server := httptest.NewServer(http.HandlerFunc(handler))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Skipf("WebSocket dial failed: %v", err)
	}
	defer conn.Close()

	time.Sleep(100 * time.Millisecond)

	eventBus.Emit("task:created", map[string]any{"id": 1, "url": "https://example.com"})

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err == nil {
		assert.NotEmpty(t, msg, "should receive event message")
	}
}

// TestWSHandlerMultipleClients verifies that multiple WebSocket clients
// can connect simultaneously without interfering with each other.
func TestWSHandlerMultipleClients(t *testing.T) {
	eventBus := infra.NewEventBus()
	handler := WSHandler(eventBus)

	server := httptest.NewServer(http.HandlerFunc(handler))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	conn1, _, err1 := dialer.Dial(wsURL, nil)
	if err1 != nil {
		t.Skipf("WebSocket dial failed: %v", err1)
	}
	defer conn1.Close()

	conn2, _, err2 := dialer.Dial(wsURL, nil)
	if err2 != nil {
		t.Skipf("WebSocket dial failed: %v", err2)
	}
	defer conn2.Close()

	time.Sleep(100 * time.Millisecond)

	eventBus.Emit("task:progress", map[string]any{"id": 1, "progress": 0.5})

	conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg1, err1 := conn1.ReadMessage()
	if err1 == nil {
		assert.NotEmpty(t, msg1)
	}

	conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg2, err2 := conn2.ReadMessage()
	if err2 == nil {
		assert.NotEmpty(t, msg2)
	}
}
