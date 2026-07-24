package infra

import (
	"sync"
)

// MultiHandler fans out a single entry to multiple sub-handlers.
// Each handler is isolated — a panic in one does not affect others.
type MultiHandler struct {
	name     string
	handlers []LogHandler
	mu       sync.RWMutex
}

// NewMultiHandler creates a composite handler from the given sub-handlers.
func NewMultiHandler(handlers ...LogHandler) *MultiHandler {
	h := make([]LogHandler, len(handlers))
	copy(h, handlers)
	return &MultiHandler{
		name:     "MultiHandler",
		handlers: h,
	}
}

func (h *MultiHandler) Name() string { return h.name }

func (h *MultiHandler) Enabled(level LogLevel) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, handler := range h.handlers {
		if handler.Enabled(level) {
			return true
		}
	}
	return false
}

func (h *MultiHandler) Handle(entry StructuredLogEntry) error {
	h.mu.RLock()
	handlers := make([]LogHandler, len(h.handlers))
	copy(handlers, h.handlers)
	h.mu.RUnlock()

	for _, handler := range handlers {
		if handler.Enabled(entry.LevelValue) {
			// Best-effort: one handler failure does not block others
			_ = handler.Handle(entry)
		}
	}
	return nil
}

func (h *MultiHandler) Flush() error {
	h.mu.RLock()
	handlers := make([]LogHandler, len(h.handlers))
	copy(handlers, h.handlers)
	h.mu.RUnlock()

	for _, handler := range handlers {
		_ = handler.Flush()
	}
	return nil
}
