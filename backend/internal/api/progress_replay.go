package api

import (
	"encoding/json"
	"sync"
	"time"

	"backend/internal/api/internal/task_compute"
)

// progressReplayCache keeps the latest task:progress payload per task so a
// reconnecting SSE client replays fresh state for EVERY live task. The
// EventBus's per-type GetLastEvent only retains one global event per type,
// which restored at most a single task's progress after a refresh — with a
// long transcode running, every other task restarted from its stale
// snapshot value.
//
// The cache doubles as the status-change detector: when an incoming payload
// carries a status different from the task's cached one, that event is a
// transition and must not be throttled or shed as low priority.
type progressReplayCache struct {
	mu      sync.Mutex
	entries map[string]replayEntry
	order   []string // insertion order, oldest first, for eviction
}

type replayEntry struct {
	data   []byte
	status string
	at     time.Time
}

// maxReplayEntries caps memory: 500 live tasks is far above the realistic
// concurrent pipeline count; evicting the oldest third on overflow keeps
// the bookkeeping O(1) amortized.
const maxReplayEntries = 500

// observe records a payload and reports whether it carries a status
// transition for its task. The returned bytes are the marshaled payload,
// ready to be sent as json.RawMessage.
func (c *progressReplayCache) observe(payload any) (data []byte, transition bool) {
	m, ok := payload.(map[string]any)
	if !ok {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, false
		}
		return data, false
	}
	status, _ := m["status"].(string)
	key := task_compute.TaskIDKey(m)

	data, err := json.Marshal(m)
	if err != nil {
		return nil, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]replayEntry)
	}
	prev, seen := c.entries[key]
	transition = !seen || prev.status != status
	c.entries[key] = replayEntry{data: data, status: status, at: time.Now()}
	if !seen {
		c.order = append(c.order, key)
		c.evictLocked()
	}
	return data, transition
}

// snapshot returns the cached payload for every task, oldest first.
func (c *progressReplayCache) snapshot() [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([][]byte, 0, len(c.entries))
	for _, key := range c.order {
		if e, ok := c.entries[key]; ok {
			out = append(out, e.data)
		}
	}
	return out
}

func (c *progressReplayCache) evictLocked() {
	if len(c.order) <= maxReplayEntries {
		return
	}
	// Drop the oldest third; entries were inserted in order.
	drop := len(c.order) - maxReplayEntries + maxReplayEntries/3
	for i := 0; i < drop; i++ {
		delete(c.entries, c.order[i])
	}
	c.order = append([]string(nil), c.order[drop:]...)
}
