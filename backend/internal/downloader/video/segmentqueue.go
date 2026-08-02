package video

import (
	"context"
	"fmt"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// DownloadStatus represents the lifecycle state of an active download.
type DownloadStatus string

const (
	StatusActive    DownloadStatus = "active"
	StatusPaused    DownloadStatus = "paused"
	StatusCancelled DownloadStatus = "cancelled"
)

// ActiveDownload tracks the state of a video download in progress,
// including completed/failed segments for resume and verification.
type ActiveDownload struct {
	TaskID            int
	Status            DownloadStatus
	Segments          []M3U8Segment
	CompletedSegments map[int]bool
	FailedSegments    map[int]error
	TotalSegments     int
	SegDir            string
	OutputPath        string
	StartTime         time.Time
	LastProgressTime  time.Time
	Referer           string
}

// CompletedCount returns the number of successfully downloaded segments.
func (d *ActiveDownload) CompletedCount() int {
	return len(d.CompletedSegments)
}

// FailedCount returns the number of segments that failed all retries.
func (d *ActiveDownload) FailedCount() int {
	return len(d.FailedSegments)
}

// QueueItem represents a segment pending download in the queue.
type QueueItem struct {
	TaskID  int
	Segment M3U8Segment
	Referer string
}

// ProgressFunc is the callback signature for progress reporting.
type ProgressFunc func(taskID int, progress float64, segment, total int, status, speed string)

// SegmentQueueConfig holds the dependencies the queue needs from its
// owning DownloadManager, avoiding tight coupling to the full struct.
type SegmentQueueConfig struct {
	MaxRetries       int
	GetMaxConcurrent func() int
	OnProgress        ProgressFunc
	// OnSegmentUpdate is called after each segment download completes
	// or fails, bridging the VideoProgressTracker pipeline. The
	// completed parameter is true on success, false on failure.
	OnSegmentUpdate   func(taskID, segmentIdx int, completed bool, localPath string, fileSize int64, errMsg string)
	DB               *db.Database
	Logger           *infra.Logger
}

// SegmentQueue manages concurrent segment downloads with a dynamic
// concurrency limit, replacing the TypeScript callback-based queue
// with Go goroutines and condition variables for signaling.
type SegmentQueue struct {
	mu               *sync.Mutex
	cond             *sync.Cond
	queue            []QueueItem
	currentRunning   int
	stopped          bool
	activeDownloads  map[int]*ActiveDownload
	cfg              SegmentQueueConfig
}

// NewSegmentQueue creates a queue sharing the given mutex and condition
// variable with the DownloadManager, so both can safely coordinate
// access to the shared activeDownloads map.
func NewSegmentQueue(mu *sync.Mutex, cond *sync.Cond, activeDownloads map[int]*ActiveDownload, cfg SegmentQueueConfig) *SegmentQueue {
	return &SegmentQueue{
		mu:              mu,
		cond:            cond,
		activeDownloads: activeDownloads,
		cfg:             cfg,
	}
}

// Push adds a segment to the pending queue.
func (q *SegmentQueue) Push(item QueueItem) {
	q.mu.Lock()
	q.queue = append(q.queue, item)
	q.mu.Unlock()
}

// pushLocked appends without locking, for use when the caller already
// holds the shared mutex to avoid self-deadlock.
func (q *SegmentQueue) pushLocked(item QueueItem) {
	q.queue = append(q.queue, item)
}

// RemoveByTask filters out all pending items for the given task,
// used when pausing or cancelling a download.
func (q *SegmentQueue) RemoveByTask(taskID int) {
	q.mu.Lock()
	filtered := q.queue[:0]
	for _, item := range q.queue {
		if item.TaskID != taskID {
			filtered = append(filtered, item)
		}
	}
	q.queue = filtered
	q.mu.Unlock()
}

// HasPending reports whether the queue still has items for the task.
func (q *SegmentQueue) HasPending(taskID int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, item := range q.queue {
		if item.TaskID == taskID {
			return true
		}
	}
	return false
}

// GetQueueLength returns the total number of pending items.
func (q *SegmentQueue) GetQueueLength() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.queue)
}

// GetConcurrentCount returns the number of goroutines currently
// downloading segments.
func (q *SegmentQueue) GetConcurrentCount() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.currentRunning
}

// Stop halts all queue processing and clears pending items.
func (q *SegmentQueue) Stop() {
	q.mu.Lock()
	q.stopped = true
	q.queue = nil
	q.mu.Unlock()
}

// ProcessQueue launches goroutines for pending segments up to the
// concurrency limit. Each goroutine calls ProcessQueue again on
// completion, creating a self-sustaining dispatch loop.
func (q *SegmentQueue) ProcessQueue() {
	for {
		q.mu.Lock()
		if q.stopped {
			q.mu.Unlock()
			return
		}
		maxConcurrent := 3
		if q.cfg.GetMaxConcurrent != nil {
			maxConcurrent = q.cfg.GetMaxConcurrent()
		}
		if q.currentRunning >= maxConcurrent || len(q.queue) == 0 {
			q.mu.Unlock()
			return
		}

		item := q.queue[0]
		q.queue = q.queue[1:]

		download := q.activeDownloads[item.TaskID]
		if download == nil || download.Status == StatusCancelled || download.Status == StatusPaused {
			q.mu.Unlock()
			continue
		}

		q.currentRunning++
		q.mu.Unlock()

		go q.downloadOneSegment(item)
	}
}

func (q *SegmentQueue) downloadOneSegment(item QueueItem) {
	defer func() {
		q.mu.Lock()
		q.currentRunning--
		q.cond.Broadcast()
		q.mu.Unlock()
		q.ProcessQueue()
	}()

	q.mu.Lock()
	download := q.activeDownloads[item.TaskID]
	q.mu.Unlock()

	if download == nil {
		return
	}

	tsid := GenerateTSID(item.Segment.URI, item.Segment.Index)

	result := DownloadSegment(context.Background(), SegmentTask{
		Segment: item.Segment,
		DestDir: download.SegDir,
		TSID:    tsid,
		Referer: item.Referer,
	}, q.cfg.MaxRetries)

	q.mu.Lock()
	if download.Status == StatusCancelled || download.Status == StatusPaused {
		q.mu.Unlock()
		return
	}

	if result.Error != nil {
		download.FailedSegments[item.Segment.Index] = result.Error
		if q.cfg.Logger != nil {
			q.cfg.Logger.Error("Segment download failed",
				infra.LogContext{Extra: map[string]any{
					"taskId":   item.TaskID,
					"index":    item.Segment.Index,
					"tsid":     tsid,
					"attempts": result.Attempts,
				}},
				result.Error)
		}
		// Bridge to VideoProgressTracker: report failed segment.
		if q.cfg.OnSegmentUpdate != nil {
			q.cfg.OnSegmentUpdate(item.TaskID, item.Segment.Index, false, "", 0, result.Error.Error())
		}
	} else {
		download.CompletedSegments[item.Segment.Index] = true
		// Bridge to VideoProgressTracker: report completed segment.
		if q.cfg.OnSegmentUpdate != nil {
			q.cfg.OnSegmentUpdate(item.TaskID, item.Segment.Index, true, result.FilePath, 0, "")
		}
	}

	completed := download.CompletedCount()
	failed := download.FailedCount()
	progress := float64(completed) / float64(download.TotalSegments) * 90
	now := time.Now()
	var speed string
	if now.Sub(download.LastProgressTime) > 500*time.Millisecond {
		elapsed := now.Sub(download.StartTime).Seconds()
		if elapsed > 0 && completed > 0 {
			speed = fmt.Sprintf("%.1f seg/s", float64(completed)/elapsed)
		}
		download.LastProgressTime = now
	}

	if completed%5 == 0 || completed+failed == download.TotalSegments {
		if q.cfg.DB != nil {
			go func(taskID int, p float64, comp int) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = q.cfg.DB.Exec(ctx,
					"UPDATE download_tasks SET progress = $1, completed_segments = $2 WHERE id = $3",
					p, comp, taskID)
			}(item.TaskID, progress, completed)
		}
	}

	if q.cfg.OnProgress != nil {
		q.cfg.OnProgress(item.TaskID, progress, completed, download.TotalSegments, "downloading", speed)
	}
	q.mu.Unlock()
}

// WaitForSegments blocks until the task has at least count segments
// completed or failed, or the download is cancelled.
func (q *SegmentQueue) WaitForSegments(ctx context.Context, taskID, count int) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		download := q.activeDownloads[taskID]
		if download == nil {
			return nil
		}
		if download.Status == StatusCancelled {
			return nil
		}

		done := download.CompletedCount() + download.FailedCount()
		if done >= count {
			return nil
		}

		q.cond.Wait()
	}
}

// WaitForAllSegments blocks until all segments for the task are either
// completed or failed, or the download is cancelled.
func (q *SegmentQueue) WaitForAllSegments(ctx context.Context, taskID int) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		download := q.activeDownloads[taskID]
		if download == nil {
			return nil
		}
		if download.Status == StatusCancelled {
			return nil
		}

		totalDone := download.CompletedCount() + download.FailedCount()
		if totalDone >= download.TotalSegments && !q.HasPendingLocked(taskID) {
			return nil
		}

		q.cond.Wait()
	}
}

func (q *SegmentQueue) HasPendingLocked(taskID int) bool {
	for _, item := range q.queue {
		if item.TaskID == taskID {
			return true
		}
	}
	return false
}
