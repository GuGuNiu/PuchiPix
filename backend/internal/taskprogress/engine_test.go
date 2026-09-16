package taskprogress

import (
	"context"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"
)

func newEngineTestDB(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "engine_test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("EngineTest"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// TestEnsureLoadedForRetry_Idempotent verifies that a gallery already
// tracked in memory is not reloaded (in-flight statuses preserved) and
// that an untracked gallery is restored from the checkpoint table —
// the restart-recovery path the file-level retry depends on.
func TestEnsureLoadedForRetry_Idempotent(t *testing.T) {
	ctx := context.Background()
	database := newEngineTestDB(t)
	e := NewEngine(nil)

	if err := e.EnsureLoadedForRetry(ctx, database, 42); err != nil {
		t.Fatalf("EnsureLoadedForRetry on unknown gallery should not error: %v", err)
	}

	// Populate the checkpoint table for gallery 42 directly, then load.
	if _, err := database.Exec(ctx,
		`INSERT INTO gallery_file_progress (gallery_id, file_index, file_type, file_url, status, error_msg)
		 VALUES (42, 0, 'image', 'https://example.com/a.jpg', 'failed', 'boom')`); err != nil {
		t.Fatalf("seed checkpoint row: %v", err)
	}
	if _, err := database.Exec(ctx,
		`INSERT INTO gallery_file_progress (gallery_id, file_index, file_type, file_url, status, error_msg)
		 VALUES (42, 1, 'image', 'https://example.com/b.jpg', 'completed', '')`); err != nil {
		t.Fatalf("seed checkpoint row: %v", err)
	}
	if err := e.EnsureLoadedForRetry(ctx, database, 42); err != nil {
		t.Fatalf("EnsureLoadedForRetry: %v", err)
	}

	// The engine must now compute retry indices for the failed file.
	indices, err := e.ComputeRetryRange(42, RetryRequest{Strategy: RetryFailedOnly})
	if err != nil {
		t.Fatalf("ComputeRetryRange after load: %v", err)
	}
	if len(indices) != 1 || indices[0] != 0 {
		t.Fatalf("expected failed index [0], got %v", indices)
	}

	// Idempotency: an in-memory status flip must survive a second
	// EnsureLoadedForRetry call (already-populated galleries are skipped).
	e.UpdateFileStatus(42, 0, FileCompleted, "/tmp/a.jpg", 1, "")
	if err := e.EnsureLoadedForRetry(ctx, database, 42); err != nil {
		t.Fatalf("second EnsureLoadedForRetry: %v", err)
	}
	indices, err = e.ComputeRetryRange(42, RetryRequest{Strategy: RetryFailedOnly})
	if err != nil {
		t.Fatalf("ComputeRetryRange after reload: %v", err)
	}
	if len(indices) != 0 {
		t.Fatalf("in-memory state was clobbered by reload: %v", indices)
	}
}

// TestResetFileStatusForRetry verifies the reset only touches
// non-completed files — a completed file must never be re-queued, even
// when an over-broad strategy (regional/all) includes it.
func TestResetFileStatusForRetry(t *testing.T) {
	e := NewEngine(nil)
	e.RegisterFiles(1, []FileProgress{
		{FileIndex: 0, FileType: FileTypeImage, Status: FileFailed, ErrorMsg: "timeout"},
		{FileIndex: 1, FileType: FileTypeImage, Status: FileCompleted},
		{FileIndex: 2, FileType: FileTypeImage, Status: FileFailed, ErrorMsg: "403"},
	})

	reset := e.ResetFileStatusForRetry(1, []int{0, 1, 2})
	if reset != 2 {
		t.Fatalf("expected 2 resets (failed files only), got %d", reset)
	}

	failed, _ := e.ComputeRetryRange(1, RetryRequest{Strategy: RetryFailedOnly})
	if len(failed) != 0 {
		t.Fatalf("after reset no files should read failed, got %v", failed)
	}
	summary := e.GetSummary(1)
	if summary.CompletedFiles != 1 {
		t.Fatalf("completed count must stay 1, got %d", summary.CompletedFiles)
	}

	// Unknown gallery must be a safe no-op.
	if n := e.ResetFileStatusForRetry(99, []int{0}); n != 0 {
		t.Fatalf("unknown gallery should reset 0, got %d", n)
	}
}
