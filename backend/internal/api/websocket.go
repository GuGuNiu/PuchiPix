package api

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"puchipix-backend/internal/downloader"
	"puchipix-backend/pkg/logger"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type ProgressMessage struct {
	Type     string  `json:"type"`
	TaskID   uint    `json:"task_id"`
	Progress float64 `json:"progress"`
	Speed    string  `json:"speed,omitempty"`
	Segment  int     `json:"segment"`
	Total    int     `json:"total"`
	Status   string  `json:"status"`
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type WSHub struct {
	clients    map[*WSClient]bool
	register   chan *WSClient
	unregister chan *WSClient
	broadcast  chan []byte
	mu         sync.RWMutex
}

type WSClient struct {
	hub  *WSHub
	conn *websocket.Conn
	send chan []byte
}

var Hub *WSHub

func InitWSHub() *WSHub {
	Hub = &WSHub{
		clients:    make(map[*WSClient]bool),
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
		broadcast:  make(chan []byte, 256),
	}
	go Hub.run()
	return Hub
}

func SetupProgressCallback() {
	if downloader.Manager != nil {
		downloader.Manager.SetProgressCallback(func(update downloader.ProgressUpdate) {
			msg := ProgressMessage{
				Type:     "progress",
				TaskID:   update.TaskID,
				Progress: update.Progress,
				Speed:    update.Speed,
				Segment:  update.Segment,
				Total:    update.Total,
				Status:   string(update.Status),
			}
			data, err := json.Marshal(msg)
			if err != nil {
				logger.Error("Failed to marshal progress: %v", err)
				return
			}
			if Hub != nil {
				Hub.broadcast <- data
			}
		})
	}
}

func (h *WSHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			logger.Debug("WebSocket client connected (%d total)", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			logger.Debug("WebSocket client disconnected (%d remaining)", len(h.clients))

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func BroadcastEvent(eventType string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"type":    eventType,
		"payload": payload,
	})
	if Hub != nil {
		Hub.broadcast <- data
	}
}

func handleWebSocket(hub *WSHub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("WebSocket upgrade error: %v", err)
		return
	}

	client := &WSClient{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
	}
	hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *WSClient) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}