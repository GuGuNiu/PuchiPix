package video

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"
	"backend/internal/taskstate"
)

// newErrorPathManager builds a DownloadManager against a temp database for
// exercising handleDownloadError's state-machine branches.
func newErrorPathManager(t *testing.T) (*DownloadManager, *db.Database) {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "manager_test.db"), nil)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	cfg := DefaultManagerConfig()
	cfg.DownloadPath = filepath.Join(t.TempDir(), "videos")
	cfg.SegmentsPath = filepath.Join(t.TempDir(), "segments")
	m := NewDownloadManager(database, infra.NewEventBus(), cfg)
	return m, database
}

func insertManagerTask(t *testing.T, database *db.Database, status string) int {
	t.Helper()
	res, err := database.Exec(context.Background(),
		"INSERT INTO download_tasks (url, status) VALUES ('https://example.com/v.m3u8', ?)", status)
	if err != nil {
		t.Fatalf("insert task: %v", err)
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func managerTaskStatus(t *testing.T, database *db.Database, id int) string {
	t.Helper()
	var status string
	if err := database.QueryRow(context.Background(),
		"SELECT status FROM download_tasks WHERE id = ?", id).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

// Regression: the transition table once lacked downloading/merging/
// transcoding → pending, so EVERY auto-retry after a mid-pipeline failure
// hit a ConflictError and the row stayed stuck in its phase forever with a
// dead pipeline and no retry scheduled.
func TestHandleDownloadErrorAutoRetryFromActivePhases(t *testing.T) {
	for _, phase := range []string{taskstate.StatusDownloading, taskstate.StatusMerging, taskstate.StatusTranscoding} {
		t.Run(phase, func(t *testing.T) {
			m, database := newErrorPathManager(t)
			id := insertManagerTask(t, database, phase)

			m.handleDownloadError(context.Background(), DownloadTaskInput{ID: id, M3U8URL: ""}, fmt.Errorf("boom: phase failed"))

			if got := managerTaskStatus(t, database, id); got != taskstate.StatusPending {
				t.Fatalf("auto-retry from %s: status = %q, want pending", phase, got)
			}
		})
	}
}

// Regression: a transcode timeout (child-context DeadlineExceeded with a
// live parent) used to be classified as "cancelled" and swallowed — the row
// stayed in transcoding forever. It must reach the retry path.
func TestHandleDownloadErrorTranscodeTimeoutRetries(t *testing.T) {
	m, database := newErrorPathManager(t)
	id := insertManagerTask(t, database, taskstate.StatusTranscoding)

	err := fmt.Errorf("transcode timed out: %w", context.DeadlineExceeded)
	m.handleDownloadError(context.Background(), DownloadTaskInput{ID: id, M3U8URL: ""}, err)

	if got := managerTaskStatus(t, database, id); got != taskstate.StatusPending {
		t.Fatalf("timeout retry: status = %q, want pending", got)
	}
}

// A user cancellation (pipeline context cancelled) must not touch the row:
// the cancelling writer (cancel/stop) owns the terminal write.
func TestHandleDownloadErrorUserCancelLeavesRow(t *testing.T) {
	m, database := newErrorPathManager(t)
	id := insertManagerTask(t, database, taskstate.StatusDownloading)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m.handleDownloadError(ctx, DownloadTaskInput{ID: id, M3U8URL: ""}, context.Canceled)

	if got := managerTaskStatus(t, database, id); got != taskstate.StatusDownloading {
		t.Fatalf("user cancel: status = %q, want untouched downloading", got)
	}
}

// A ConflictError (row taken over by user pause/cancel mid-pipeline) must
// short-circuit: no retry scheduled, no failed write fighting the owner.
func TestHandleDownloadErrorConflictShortCircuit(t *testing.T) {
	m, database := newErrorPathManager(t)
	id := insertManagerTask(t, database, taskstate.StatusPaused)

	conflict := &taskstate.ConflictError{
		TaskID:  id,
		Current: taskstate.StatusPaused,
		Target:  taskstate.StatusTranscoding,
	}
	m.handleDownloadError(context.Background(), DownloadTaskInput{ID: id, M3U8URL: ""},
		fmt.Errorf("enter transcode phase: %w", conflict))

	if got := managerTaskStatus(t, database, id); got != taskstate.StatusPaused {
		t.Fatalf("conflict: status = %q, want untouched paused", got)
	}
}

// Exhausted retries land the row in failed with the error persisted.
func TestHandleDownloadErrorTerminalFailure(t *testing.T) {
	m, database := newErrorPathManager(t)
	id := insertManagerTask(t, database, taskstate.StatusTranscoding)

	m.mu.Lock()
	m.taskRetries[id] = maxTaskRetries // exhausted
	m.mu.Unlock()

	m.handleDownloadError(context.Background(), DownloadTaskInput{ID: id, M3U8URL: ""}, errors.New("permanent failure"))

	if got := managerTaskStatus(t, database, id); got != taskstate.StatusFailed {
		t.Fatalf("terminal failure: status = %q, want failed", got)
	}
	var msg string
	if err := database.QueryRow(context.Background(),
		"SELECT error_msg FROM download_tasks WHERE id = ?", id).Scan(&msg); err != nil {
		t.Fatal(err)
	}
	if msg != "permanent failure" {
		t.Fatalf("error_msg = %q, want the failure message", msg)
	}
}
