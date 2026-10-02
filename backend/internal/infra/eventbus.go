package infra

import (
	"sync"
)

type EventHandler func(payload any)

type subscriber struct {
	id      uint64
	handler EventHandler
	once    bool
}

// EventBus is a publish/subscribe event hub with typed event names, wildcard
// subscription, last-event cache, and per-handler error isolation.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string][]*subscriber
	lastEvents  map[string]any
	nextID      uint64
	logger      *Logger
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string][]*subscriber),
		lastEvents:  make(map[string]any),
		logger:      NewLogger("EventBus"),
	}
}

// On registers a persistent handler for the given event name. Pass "*"
// to receive every event. Returns an unsubscribe function.
func (eb *EventBus) On(event string, handler EventHandler) func() {
	return eb.subscribe(event, handler, false)
}

func (eb *EventBus) Once(event string, handler EventHandler) {
	eb.subscribe(event, handler, true)
}

func (eb *EventBus) subscribe(event string, handler EventHandler, once bool) func() {
	eb.mu.Lock()
	id := eb.nextID
	eb.nextID++
	sub := &subscriber{id: id, handler: handler, once: once}
	eb.subscribers[event] = append(eb.subscribers[event], sub)
	eb.mu.Unlock()

	return func() {
		eb.mu.Lock()
		defer eb.mu.Unlock()
		subs := eb.subscribers[event]
		for i, s := range subs {
			if s.id == id {
				eb.subscribers[event] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		if len(eb.subscribers[event]) == 0 {
			delete(eb.subscribers, event)
		}
	}
}

// Emit dispatches an event to all matching subscribers, including
// wildcard listeners. Each handler runs in isolation; a panic in one
// handler does not prevent subsequent handlers from executing.
func (eb *EventBus) Emit(event string, payload any) {
	eb.mu.Lock()
	eb.lastEvents[event] = payload
	subs := make([]*subscriber, len(eb.subscribers[event]))
	copy(subs, eb.subscribers[event])
	wildcard := make([]*subscriber, len(eb.subscribers["*"]))
	copy(wildcard, eb.subscribers["*"])
	eb.mu.Unlock()

	toRemove := []string{}
	for _, s := range subs {
		eb.dispatch(s, payload)
		if s.once {
			toRemove = append(toRemove, event)
		}
	}
	for _, s := range wildcard {
		eb.dispatch(s, payload)
	}

	for _, ev := range toRemove {
		eb.removeOnce(ev)
	}
}

func (eb *EventBus) dispatch(s *subscriber, payload any) {
	defer func() {
		if r := recover(); r != nil {
			eb.logger.Error("Handler panic recovered", r)
		}
	}()
	s.handler(payload)
}

func (eb *EventBus) removeOnce(event string) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	subs := eb.subscribers[event]
	filtered := subs[:0]
	for _, s := range subs {
		if !s.once {
			filtered = append(filtered, s)
		}
	}
	if len(filtered) > 0 {
		eb.subscribers[event] = filtered
	} else {
		delete(eb.subscribers, event)
	}
}

// GetLastEvent returns the most recent payload for the given event,
// allowing late subscribers to recover initial state.
func (eb *EventBus) GetLastEvent(event string) any {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	return eb.lastEvents[event]
}

func (eb *EventBus) Clear() {
	eb.mu.Lock()
	eb.subscribers = make(map[string][]*subscriber)
	eb.lastEvents = make(map[string]any)
	eb.mu.Unlock()
}
