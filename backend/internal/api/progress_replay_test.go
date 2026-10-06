package api

import (
	"encoding/json"
	"testing"
)

func TestProgressReplayObserveDetectsTransitions(t *testing.T) {
	var c progressReplayCache

	data, transition := c.observe(map[string]any{
		"taskId":   7,
		"taskType": "video",
		"status":   "downloading",
		"progress": 40.0,
	})
	if !transition {
		t.Fatal("first observation must count as a transition")
	}
	if json.Valid(data) != true {
		t.Fatal("observe must return marshaled payload")
	}

	_, transition = c.observe(map[string]any{
		"taskId":   7,
		"taskType": "video",
		"status":   "downloading",
		"progress": 41.5,
	})
	if transition {
		t.Fatal("same-status update must not count as a transition")
	}

	_, transition = c.observe(map[string]any{
		"taskId":   7,
		"taskType": "video",
		"status":   "transcoding",
		"progress": 0,
	})
	if !transition {
		t.Fatal("status change must count as a transition")
	}
}

func TestProgressReplayKeysOnTaskTypeAndID(t *testing.T) {
	var c progressReplayCache
	c.observe(map[string]any{"taskId": 7, "taskType": "video", "status": "downloading"})
	_, transition := c.observe(map[string]any{"taskId": 7, "taskType": "gallery", "status": "downloading"})
	if !transition {
		t.Fatal("different taskType must be a separate cache entry")
	}
	if got := len(c.snapshot()); got != 2 {
		t.Fatalf("snapshot holds %d entries, want 2", got)
	}
}

func TestProgressReplaySnapshotReturnsLatestPerTask(t *testing.T) {
	var c progressReplayCache
	c.observe(map[string]any{"taskId": 1, "taskType": "video", "status": "downloading", "progress": 10.0})
	c.observe(map[string]any{"taskId": 2, "taskType": "video", "status": "downloading", "progress": 20.0})
	c.observe(map[string]any{"taskId": 1, "taskType": "video", "status": "transcoding", "progress": 0})

	snap := c.snapshot()
	if len(snap) != 2 {
		t.Fatalf("snapshot holds %d entries, want 2", len(snap))
	}
	var task1 map[string]any
	if err := json.Unmarshal(snap[0], &task1); err != nil {
		t.Fatal(err)
	}
	if task1["status"] != "transcoding" || task1["progress"].(float64) != 0 {
		t.Fatalf("task 1 cached payload = %v, want latest transcoding frame", task1)
	}
}

func TestProgressReplayEviction(t *testing.T) {
	var c progressReplayCache
	for i := 0; i < maxReplayEntries+120; i++ {
		c.observe(map[string]any{"taskId": i, "taskType": "video", "status": "downloading"})
	}
	c.mu.Lock()
	n := len(c.entries)
	c.mu.Unlock()
	if n > maxReplayEntries {
		t.Fatalf("cache holds %d entries after eviction, want <= %d", n, maxReplayEntries)
	}
	// Newest entry must survive eviction.
	data := c.snapshot()
	var newest map[string]any
	if err := json.Unmarshal(data[len(data)-1], &newest); err != nil {
		t.Fatal(err)
	}
	if id, ok := newest["taskId"].(float64); !ok || int(id) != maxReplayEntries+119 {
		t.Fatalf("newest entry evicted: %+v", newest)
	}
}

func TestProgressReplayNonMapPayload(t *testing.T) {
	var c progressReplayCache
	data, transition := c.observe("scalar")
	if transition {
		t.Fatal("non-map payload cannot be a transition")
	}
	if string(data) != `"scalar"` {
		t.Fatalf("payload = %s", data)
	}
}
