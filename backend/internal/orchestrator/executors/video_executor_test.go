package executors

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"backend/internal/infra"
)

// alwaysActiveStatusFn simulates a row that never reaches a terminal status.
func alwaysActiveStatusFn(ctx context.Context, taskID int) (string, string, bool) {
	return "downloading", "", true
}

func TestWaitTerminalResolvesViaCompletedEvent(t *testing.T) {
	bus := infra.NewEventBus()
	e := &VideoDownloadExecutor{
		logger:        infra.NewLogger("VideoDownloadExecutor"),
		statusQueryFn: alwaysActiveStatusFn,
		eventBus:      bus,
	}

	go func() {
		// Emit shortly after waitTerminal subscribes.
		time.Sleep(50 * time.Millisecond)
		bus.Emit("task:completed", map[string]any{
			"taskId":   7,
			"taskType": "video",
		})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ok, err := e.waitTerminal(ctx, 7)
	if err != nil {
		t.Fatalf("waitTerminal: %v", err)
	}
	if !ok {
		t.Fatal("completed event must resolve with ok=true")
	}
}

func TestWaitTerminalResolvesViaFailedEvent(t *testing.T) {
	bus := infra.NewEventBus()
	e := &VideoDownloadExecutor{
		logger:        infra.NewLogger("VideoDownloadExecutor"),
		statusQueryFn: alwaysActiveStatusFn,
		eventBus:      bus,
	}

	go func() {
		time.Sleep(50 * time.Millisecond)
		bus.Emit("task:failed", map[string]any{
			"taskId":   7,
			"taskType": "video",
			"error":    "segment 12 failed",
		})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ok, err := e.waitTerminal(ctx, 7)
	if ok {
		t.Fatal("failed event must resolve with ok=false")
	}
	if err == nil || err.Error() != "video download failed: segment 12 failed" {
		t.Fatalf("err = %v, want the payload error propagated", err)
	}
}

// Events for other tasks (different ID) and other task types (gallery/sniff
// share the numeric ID space) must be ignored.
func TestWaitTerminalIgnoresForeignEvents(t *testing.T) {
	bus := infra.NewEventBus()
	e := &VideoDownloadExecutor{
		logger:        infra.NewLogger("VideoDownloadExecutor"),
		statusQueryFn: alwaysActiveStatusFn,
		eventBus:      bus,
	}

	bus.Emit("task:completed", map[string]any{"taskId": 8, "taskType": "video"})
	bus.Emit("task:completed", map[string]any{"taskId": 7, "taskType": "gallery"})

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	ok, err := e.waitTerminal(ctx, 7)
	if ok {
		t.Fatal("foreign events must not resolve the wait")
	}
	if err == nil {
		t.Fatal("expected ctx deadline error")
	}
}

// The DB poll safety net must still resolve the wait when the terminal
// status was written without an event (DAG terminal guard rail).
func TestWaitTerminalFallbackPollResolves(t *testing.T) {
	var mu sync.Mutex
	completed := false
	e := &VideoDownloadExecutor{
		logger: infra.NewLogger("VideoDownloadExecutor"),
		statusQueryFn: func(ctx context.Context, taskID int) (string, string, bool) {
			mu.Lock()
			defer mu.Unlock()
			if completed {
				return "completed", "", true
			}
			return "downloading", "", true
		},
		eventBus: infra.NewEventBus(), // no events will arrive
	}

	go func() {
		time.Sleep(200 * time.Millisecond)
		mu.Lock()
		completed = true
		mu.Unlock()
	}()

	// The safety-net poll fires every 5s when a bus is attached; allow two.
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Second)
	defer cancel()
	ok, err := e.waitTerminal(ctx, 7)
	if err != nil {
		t.Fatalf("waitTerminal: %v", err)
	}
	if !ok {
		t.Fatal("fallback poll must resolve completion")
	}
}

// Without an EventBus the executor must still resolve via the fast poll path.
func TestWaitTerminalWithoutBusPolls(t *testing.T) {
	e := &VideoDownloadExecutor{
		logger: infra.NewLogger("VideoDownloadExecutor"),
		statusQueryFn: func(ctx context.Context, taskID int) (string, string, bool) {
			return "failed", "boom", true
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ok, err := e.waitTerminal(ctx, 7)
	if ok {
		t.Fatal("failed status must resolve with ok=false")
	}
	if err == nil || fmt.Sprint(err) != "video download failed: boom" {
		t.Fatalf("err = %v", err)
	}
}
