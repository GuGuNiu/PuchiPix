package taskstate

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

func newTestStore(t *testing.T) (*Store, *db.Database, *infra.EventBus) {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "test.db"), nil)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	bus := infra.NewEventBus()
	return NewStore(database, bus), database, bus
}

func insertTask(t *testing.T, database *db.Database, status string) int {
	t.Helper()
	ctx := context.Background()
	res, err := database.Exec(ctx,
		"INSERT INTO download_tasks (url, status) VALUES ('https://example.com/v.m3u8', ?)", status)
	if err != nil {
		t.Fatalf("insert task: %v", err)
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func statusOf(t *testing.T, database *db.Database, id int) string {
	t.Helper()
	var status string
	if err := database.QueryRow(context.Background(),
		"SELECT status FROM download_tasks WHERE id = ?", id).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

func TestCanTransition(t *testing.T) {
	happy := [][2]string{
		{StatusPending, StatusDownloading},
		{StatusDownloading, StatusMerging},
		{StatusMerging, StatusTranscoding},
		{StatusTranscoding, StatusProbing},
		{StatusProbing, StatusCompleted},
		{StatusPaused, StatusDownloading},
		{StatusFailed, StatusPending},
		{StatusCancelled, StatusPending},
		{StatusDownloading, StatusPaused},
		{StatusTranscoding, StatusCancelled},
		// Auto-retry: a mid-pipeline failure writes pending to requeue the task.
		{StatusDownloading, StatusPending},
		{StatusMerging, StatusPending},
		{StatusTranscoding, StatusPending},
		{StatusProbing, StatusPending},
	}
	for _, pair := range happy {
		if !CanTransition(pair[0], pair[1]) {
			t.Errorf("expected %s -> %s to be legal", pair[0], pair[1])
		}
	}
	illegal := [][2]string{
		{StatusCompleted, StatusDownloading},
		{StatusCompleted, StatusPending},
		{StatusProbing, StatusDownloading},
	}
	for _, pair := range illegal {
		if CanTransition(pair[0], pair[1]) {
			t.Errorf("expected %s -> %s to be illegal", pair[0], pair[1])
		}
	}
	if !CanTransition(StatusDownloading, StatusDownloading) {
		t.Error("same-state transition should be idempotent-legal")
	}
}

func TestTransitionHappyPathAndEvent(t *testing.T) {
	store, database, bus := newTestStore(t)
	id := insertTask(t, database, StatusPending)

	var events []map[string]any
	var mu sync.Mutex
	unsub := bus.On("task:progress", func(payload any) {
		mu.Lock()
		defer mu.Unlock()
		if m, ok := payload.(map[string]any); ok {
			events = append(events, m)
		}
	})
	defer unsub()

	ctx := context.Background()
	pct := 0.0
	if err := store.Transition(ctx, id, Update{
		Status:   StatusDownloading,
		Progress: &pct,
		Set:      map[string]any{"error_msg": "", "completed_segments": 0},
	}); err != nil {
		t.Fatalf("transition to downloading: %v", err)
	}
	if got := statusOf(t, database, id); got != StatusDownloading {
		t.Fatalf("status = %q, want downloading", got)
	}

	mu.Lock()
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	ev := events[0]
	mu.Unlock()
	if ev["status"] != StatusDownloading || ev["taskType"] != "video" {
		t.Fatalf("event payload mismatch: %v", ev)
	}
	if ev["progress"].(float64) != 0 {
		t.Fatalf("event progress = %v, want 0", ev["progress"])
	}

	for _, step := range []struct{ from, to string }{
		{StatusDownloading, StatusMerging},
		{StatusMerging, StatusTranscoding},
		{StatusTranscoding, StatusProbing},
		{StatusProbing, StatusCompleted},
	} {
		p := 100.0
		if err := store.Transition(ctx, id, Update{Status: step.to, Progress: &p}); err != nil {
			t.Fatalf("%s -> %s: %v", step.from, step.to, err)
		}
		if got := statusOf(t, database, id); got != step.to {
			t.Fatalf("status = %q, want %q", got, step.to)
		}
	}
}

func TestTransitionConflictCancelWins(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusDownloading)

	// A user cancel lands between the pipeline's read and write.
	ctx := context.Background()
	if _, err := database.Exec(ctx,
		"UPDATE download_tasks SET status = 'cancelled' WHERE id = ?", id); err != nil {
		t.Fatal(err)
	}

	err := store.Transition(ctx, id, Update{Status: StatusMerging})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("want ConflictError, got %v", err)
	}
	if conflict.Current != StatusCancelled {
		t.Fatalf("conflict.Current = %q, want cancelled", conflict.Current)
	}
	if got := statusOf(t, database, id); got != StatusCancelled {
		t.Fatalf("conflicting write must not clobber cancel, got %q", got)
	}
}

func TestTransitionIdempotentAppliesSet(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusTranscoding)

	ctx := context.Background()
	if err := store.Transition(ctx, id, Update{
		Status: StatusTranscoding,
		Set:    map[string]any{"error_msg": "cleared"},
	}); err != nil {
		t.Fatalf("idempotent transition: %v", err)
	}
	var msg string
	if err := database.QueryRow(ctx,
		"SELECT error_msg FROM download_tasks WHERE id = ?", id).Scan(&msg); err != nil {
		t.Fatal(err)
	}
	if msg != "cleared" {
		t.Fatalf("error_msg = %q, want cleared", msg)
	}
}

func TestTransitionDeletedRowIsNoop(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusPending)
	ctx := context.Background()
	if _, err := database.Exec(ctx, "DELETE FROM download_tasks WHERE id = ?", id); err != nil {
		t.Fatal(err)
	}
	if err := store.Transition(ctx, id, Update{Status: StatusDownloading}); err != nil {
		t.Fatalf("deleted row transition should be a no-op, got %v", err)
	}
}

func TestTransitionRejectsUnknownStatus(t *testing.T) {
	store, _, _ := newTestStore(t)
	if err := store.Transition(context.Background(), 1, Update{Status: "bogus"}); err == nil {
		t.Fatal("unknown target status must be rejected")
	}
}

func TestSetPhaseProgressThrottle(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusTranscoding)
	ctx := context.Background()

	readProgress := func() float64 {
		var p float64
		if err := database.QueryRow(ctx,
			"SELECT progress FROM download_tasks WHERE id = ?", id).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return p
	}

	store.SetPhaseProgress(id, StatusTranscoding, 10)
	if got := readProgress(); got != 10 {
		t.Fatalf("first persist: progress = %v, want 10", got)
	}
	store.SetPhaseProgress(id, StatusTranscoding, 12)
	if got := readProgress(); got != 10 {
		t.Fatalf("throttled write leaked: progress = %v, want 10", got)
	}
	store.SetPhaseProgress(id, StatusTranscoding, 20)
	if got := readProgress(); got != 20 {
		t.Fatalf("jump persist: progress = %v, want 20", got)
	}
	store.SetPhaseProgress(id, StatusTranscoding, ProgressTerminal)
	if got := readProgress(); got != 100 {
		t.Fatalf("terminal persist: progress = %v, want 100", got)
	}
}

func TestSetPhaseProgressIgnoresOtherStatuses(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusDownloading)
	store.SetPhaseProgress(id, StatusDownloading, 50)
	var p float64
	if err := database.QueryRow(context.Background(),
		"SELECT progress FROM download_tasks WHERE id = ?", id).Scan(&p); err != nil {
		t.Fatal(err)
	}
	if p != 0 {
		t.Fatalf("phase progress must only apply to merging/transcoding, got %v", p)
	}
}

func TestRecoverStale(t *testing.T) {
	store, database, _ := newTestStore(t)
	ctx := context.Background()

	stuck := map[string]int{
		StatusDownloading: insertTask(t, database, StatusDownloading),
		StatusScraping:    insertTask(t, database, StatusScraping),
		StatusMerging:     insertTask(t, database, StatusMerging),
		StatusTranscoding: insertTask(t, database, StatusTranscoding),
		StatusProbing:     insertTask(t, database, StatusProbing),
	}
	keep := map[string]int{
		StatusCompleted: insertTask(t, database, StatusCompleted),
		StatusFailed:    insertTask(t, database, StatusFailed),
		StatusCancelled: insertTask(t, database, StatusCancelled),
		StatusPaused:    insertTask(t, database, StatusPaused),
	}

	n, err := store.RecoverStale(ctx)
	if err != nil {
		t.Fatalf("RecoverStale: %v", err)
	}
	if n != int64(len(stuck)) {
		t.Fatalf("reset %d rows, want %d", n, len(stuck))
	}
	for status, id := range stuck {
		if got := statusOf(t, database, id); got != StatusPaused {
			t.Fatalf("stale %s row: status = %q, want paused", status, got)
		}
	}
	for status, id := range keep {
		if got := statusOf(t, database, id); got != status {
			t.Fatalf("terminal %s row was clobbered: %q", status, got)
		}
	}
}

func TestSetPhaseProgressRespectsInterval(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusMerging)
	ctx := context.Background()

	store.SetPhaseProgress(id, StatusMerging, 30)
	// Within the throttle window and below the jump threshold: no write.
	store.SetPhaseProgress(id, StatusMerging, 33)
	var p float64
	if err := database.QueryRow(ctx,
		"SELECT progress FROM download_tasks WHERE id = ?", id).Scan(&p); err != nil {
		t.Fatal(err)
	}
	if p != 30 {
		t.Fatalf("progress = %v, want 30", p)
	}

	// Simulate the interval elapsing.
	store.mu.Lock()
	store.marks[id] = progressMark{at: time.Now().Add(-3 * time.Second), pc: 33}
	store.mu.Unlock()
	store.SetPhaseProgress(id, StatusMerging, 34)
	if err := database.QueryRow(ctx,
		"SELECT progress FROM download_tasks WHERE id = ?", id).Scan(&p); err != nil {
		t.Fatal(err)
	}
	if p != 34 {
		t.Fatalf("interval persist: progress = %v, want 34", p)
	}
}
