package orchestrator

import (
	"context"
	"fmt"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// TaskQueueManager manages the task queue and startup state reset,
// mirroring the TypeScript TaskQueueManager and state-reset modules.
type TaskQueueManager struct {
	mu     sync.Mutex
	logger *infra.Logger
	db     *db.Database
}

// NewTaskQueueManager creates a queue manager backed by the given database.
func NewTaskQueueManager(database *db.Database) *TaskQueueManager {
	return &TaskQueueManager{
		logger: infra.NewLogger("TaskQueue"),
		db:     database,
	}
}

// ResetRunningTasksOnStartup resets all tasks that were left in a
// running or downloading state due to a previous crash. This mirrors
// the TypeScript resetRunningTasksOnStartup function.
func (t *TaskQueueManager) ResetRunningTasksOnStartup(ctx context.Context) error {
	if t.db == nil {
		t.logger.Warn("No database, skipping startup reset")
		return nil
	}

	tx, err := t.db.BeginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	resetCount := 0

	_, err = tx.ExecContext(ctx, "UPDATE "+db.TableGallery+" SET status = 'pending' WHERE status IN ('scraping', 'downloading', 'scrape_pending', 'download_pending')")
	if err != nil {
		t.logger.Error("Failed to reset gallery running states", err)
	} else {
		resetCount++
	}

	_, err = tx.ExecContext(ctx, "UPDATE "+db.TableGalleryImage+" SET status = 'pending', local_path = '', file_size = 0, completed_at = NULL WHERE status IN ('downloading', 'downloaded')")
	if err != nil {
		t.logger.Error("Failed to reset gallery image states", err)
	} else {
		resetCount++
	}

	_, err = tx.ExecContext(ctx, "UPDATE "+db.TableGalleryVideo+" SET status = 'pending', local_path = '', file_size = 0, completed_at = NULL WHERE status IN ('downloading', 'downloaded')")
	if err != nil {
		t.logger.Error("Failed to reset gallery video states", err)
	} else {
		resetCount++
	}

	_, err = tx.ExecContext(ctx, "UPDATE "+db.TableDownloadTask+" SET status = 'pending', progress = 0 WHERE status IN ('downloading', 'processing')")
	if err != nil {
		t.logger.Error("Failed to reset download task states", err)
	} else {
		resetCount++
	}

	_, err = tx.ExecContext(ctx, "UPDATE "+db.TableSniffTask+" SET status = 'pending' WHERE status IN ('running', 'processing')")
	if err != nil {
		t.logger.Error("Failed to reset sniff task states", err)
	} else {
		resetCount++
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	t.logger.Info("Startup task reset completed", "resetTables", resetCount)
	return nil
}

// EnqueueGalleryTask creates a gallery download task and returns its
// generated ID. The actual DAG submission is handled by the orchestrator.
func (t *TaskQueueManager) EnqueueGalleryTask(ctx context.Context, galleryID int, sourceURL, siteID string, priority int) error {
	if t.db == nil {
		return fmt.Errorf("no database connection")
	}
	_, err := t.db.Exec(ctx,
		"UPDATE "+db.TableGallery+" SET status = 'scrape_pending' WHERE id = ?",
		galleryID,
	)
	if err != nil {
		return fmt.Errorf("enqueue gallery task: %w", err)
	}
	t.logger.Info("Gallery task enqueued", "galleryId", galleryID, "siteId", siteID)
	return nil
}

// EnqueueSniffTask creates a sniff task and returns its generated ID.
func (t *TaskQueueManager) EnqueueSniffTask(ctx context.Context, sniffTaskID int, url, siteID string) error {
	if t.db == nil {
		return fmt.Errorf("no database connection")
	}
	_, err := t.db.Exec(ctx,
		"UPDATE "+db.TableSniffTask+" SET status = 'pending' WHERE id = ?",
		sniffTaskID,
	)
	if err != nil {
		return fmt.Errorf("enqueue sniff task: %w", err)
	}
	t.logger.Info("Sniff task enqueued", "sniffTaskId", sniffTaskID, "siteId", siteID)
	return nil
}

// CancelTask marks a task as cancelled in the database.
func (t *TaskQueueManager) CancelTask(ctx context.Context, taskType string, taskID int) error {
	if t.db == nil {
		return fmt.Errorf("no database connection")
	}
	table := db.TableGallery
	if taskType == "sniff" {
		table = db.TableSniffTask
	} else if taskType == "video" {
		table = db.TableDownloadTask
	}
	_, err := t.db.Exec(ctx,
		fmt.Sprintf("UPDATE %s SET status = 'cancelled', completed_at = ? WHERE id = ?", table),
		time.Now(), taskID,
	)
	if err != nil {
		return fmt.Errorf("cancel task: %w", err)
	}
	t.logger.Info("Task cancelled", "taskType", taskType, "taskId", taskID)
	return nil
}

// RetryTask marks a failed task for retry by resetting its status.
func (t *TaskQueueManager) RetryTask(ctx context.Context, taskType string, taskID int) error {
	if t.db == nil {
		return fmt.Errorf("no database connection")
	}
	table := db.TableGallery
	status := "scrape_pending"
	if taskType == "sniff" {
		table = db.TableSniffTask
		status = "pending"
	} else if taskType == "video" {
		table = db.TableDownloadTask
		status = "pending"
	}
	_, err := t.db.Exec(ctx,
		fmt.Sprintf("UPDATE %s SET status = ?, error_msg = '' WHERE id = ?", table),
		status, taskID,
	)
	if err != nil {
		return fmt.Errorf("retry task: %w", err)
	}
	t.logger.Info("Task retried", "taskType", taskType, "taskId", taskID)
	return nil
}
