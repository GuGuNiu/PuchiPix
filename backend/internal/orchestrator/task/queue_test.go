package orchestrator

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestTaskQueueManagerNilDBResetRunningTasks verifies that startup reset
// is a no-op when no database is connected, allowing the queue manager
// to be used in test environments without a live PostgreSQL instance.
func TestTaskQueueManagerNilDBResetRunningTasks(t *testing.T) {
	tqm := NewTaskQueueManager(nil)
	err := tqm.ResetRunningTasksOnStartup(context.Background())
	assert.NoError(t, err, "should skip reset gracefully when db is nil")
}

// TestTaskQueueManagerNilDBEnqueueGallery verifies that enqueuing a
// gallery task without a database returns a clear error rather than
// silently dropping the request.
func TestTaskQueueManagerNilDBEnqueueGallery(t *testing.T) {
	tqm := NewTaskQueueManager(nil)
	err := tqm.EnqueueGalleryTask(context.Background(), 1, "https://example.com", "aimeizizi", 5)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no database connection")
}

// TestTaskQueueManagerNilDBEnqueueSniff verifies that enqueuing a sniff
// task without a database returns a clear error.
func TestTaskQueueManagerNilDBEnqueueSniff(t *testing.T) {
	tqm := NewTaskQueueManager(nil)
	err := tqm.EnqueueSniffTask(context.Background(), 1, "https://example.com", "aimeizizi")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no database connection")
}

// TestTaskQueueManagerNilDBCancelTask verifies that cancelling a task
// without a database returns a clear error, preventing silent failures.
func TestTaskQueueManagerNilDBCancelTask(t *testing.T) {
	tqm := NewTaskQueueManager(nil)
	err := tqm.CancelTask(context.Background(), "gallery", 1)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no database connection")
}

// TestTaskQueueManagerNilDBRetryTask verifies that retrying a task
// without a database returns a clear error.
func TestTaskQueueManagerNilDBRetryTask(t *testing.T) {
	tqm := NewTaskQueueManager(nil)
	err := tqm.RetryTask(context.Background(), "gallery", 1)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no database connection")
}

// TestTaskQueueManagerNilDBCancelTaskTypeMapping verifies that the nil-db
// guard fires before any table selection logic, so all task types
// return the same error regardless of the type parameter.
func TestTaskQueueManagerNilDBCancelTaskTypeMapping(t *testing.T) {
	tqm := NewTaskQueueManager(nil)

	types := []string{"gallery", "sniff", "video", "unknown"}
	for _, taskType := range types {
		err := tqm.CancelTask(context.Background(), taskType, 1)
		assert.Error(t, err, "task type %s should return error with nil db", taskType)
		assert.Contains(t, err.Error(), "no database connection")
	}
}

// TestTaskQueueManagerNilDBRetryTaskTypeMapping verifies that retry
// also returns the same error for all task types when db is nil.
func TestTaskQueueManagerNilDBRetryTaskTypeMapping(t *testing.T) {
	tqm := NewTaskQueueManager(nil)

	types := []string{"gallery", "sniff", "video", "unknown"}
	for _, taskType := range types {
		err := tqm.RetryTask(context.Background(), taskType, 1)
		assert.Error(t, err, "task type %s should return error with nil db", taskType)
		assert.Contains(t, err.Error(), "no database connection")
	}
}
