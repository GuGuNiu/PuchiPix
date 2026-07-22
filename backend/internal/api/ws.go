package api

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"

	"backend/internal/infra"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// wsSession tracks a single WebSocket connection and its active
// subscriptions, allowing clean teardown when the client disconnects.
type wsSession struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	closed bool
}

func (s *wsSession) send(event string, payload any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	data, _ := json.Marshal(payload)
	msg, _ := json.Marshal(map[string]any{
		"event": event,
		"data":  json.RawMessage(data),
	})
	_ = s.conn.WriteMessage(websocket.TextMessage, msg)
}

func (s *wsSession) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		_ = s.conn.Close()
	}
}

// WSHandler upgrades HTTP to WebSocket and bridges EventBus events to
// the client, mirroring the Socket.io event protocol used by the
// frontend.
func WSHandler(eventBus *infra.EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		session := &wsSession{conn: conn}
		logger := infra.NewLogger("WebSocket")
		logger.Info("WebSocket client connected")

		events := []string{
			"task:created", "task:progress", "task:completed",
			"task:failed", "task:cancelled",
			"gallery:downloadProgress",
			"dag:nodeStateChanged", "dag:nodeProgress",
			"search:started", "search:completed",
			"scrape:started", "scrape:failed",
			"system:shutdown",
		}

		for _, ev := range events {
			eventName := ev
			eventBus.On(eventName, func(payload any) {
				session.send(eventName, payload)
			})
		}

		go session.readLoop()

		<-r.Context().Done()
		session.close()
		logger.Info("WebSocket client disconnected")
	}
}

func (s *wsSession) readLoop() {
	for {
		_, _, err := s.conn.ReadMessage()
		if err != nil {
			s.close()
			return
		}
	}
}
