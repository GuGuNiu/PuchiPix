package taskprogress

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"backend/internal/infra"
)

// VideoSegmentStatus tracks the download state of individual TS segments
// within a video download task.
type VideoSegmentStatus string

const (
	SegPending    VideoSegmentStatus = "pending"
	SegDownloading VideoSegmentStatus = "downloading"
	SegCompleted  VideoSegmentStatus = "completed"
	SegFailed     VideoSegmentStatus = "failed"
)

// VideoSegmentProgress tracks a single TS segment within a video.
type VideoSegmentProgress struct {
	TaskID     int                `json:"taskId"`
	SegmentIdx int                `json:"segmentIdx"`
	URL        string             `json:"url"`
	LocalPath  string             `json:"localPath,omitempty"`
	FileSize   int64              `json:"fileSize"`
	Status     VideoSegmentStatus `json:"status"`
	ErrorMsg   string             `json:"errorMsg,omitempty"`
	RetryCount int                `json:"retryCount"`
	UpdatedAt  time.Time          `json:"updatedAt"`
}

// VideoProgressSummary aggregates segment-level progress for a video.
type VideoProgressSummary struct {
	TaskID            int     `json:"taskId"`
	TotalSegments     int     `json:"totalSegments"`
	CompletedSegments int     `json:"completedSegments"`
	FailedSegments    int     `json:"failedSegments"`
	PendingSegments   int     `json:"pendingSegments"`
	Progress          float64 `json:"progress"`
	// DownloadedBytes is the sum of FileSize for completed segments.
	// Carried in SSE progress events so the frontend size column can
	// show a live partial size instead of "—" until the MP4 merge.
	DownloadedBytes int64 `json:"downloadedBytes"`
	// IntegrityScore 0-100: percentage of segments that passed checksum
	// or size verification.
	IntegrityScore float64 `json:"integrityScore"`
	Status         string  `json:"status"`
}

// VideoRetryStrategy defines how to retry failed video segments.
type VideoRetryStrategy struct {
	// MaxRetries per segment before marking as permanently failed.
	MaxRetries int
	// ConcurrentSegments limits concurrent re-downloads.
	ConcurrentSegments int
	// VerifyIntegrity enables checksum/size verification on retry.
	VerifyIntegrity bool
	// BackoffBaseMs base delay for exponential backoff between retries.
	BackoffBaseMs int
}

// DefaultVideoRetryStrategy returns sensible defaults.
func DefaultVideoRetryStrategy() VideoRetryStrategy {
	return VideoRetryStrategy{
		MaxRetries:         5,
		ConcurrentSegments: 3,
		VerifyIntegrity:    true,
		BackoffBaseMs:      1000,
	}
}

// VideoProgressTracker manages segment-level progress for video
// download tasks. It supports fine-grained retry of individual
// segments and integrity verification.
type VideoProgressTracker struct {
	mu       sync.RWMutex
	segments map[int]map[int]*VideoSegmentProgress // taskID -> segmentIdx -> progress
	strategy VideoRetryStrategy
	logger   *infra.Logger
}

// NewVideoProgressTracker creates a video progress tracker.
func NewVideoProgressTracker(strategy VideoRetryStrategy) *VideoProgressTracker {
	if strategy.MaxRetries == 0 {
		strategy = DefaultVideoRetryStrategy()
	}
	return &VideoProgressTracker{
		segments: make(map[int]map[int]*VideoSegmentProgress),
		strategy: strategy,
		logger:   infra.NewLogger("VideoProgress"),
	}
}

// RegisterSegments initializes segment tracking for a video task.
func (vt *VideoProgressTracker) RegisterSegments(taskID int, totalSegments int) {
	vt.mu.Lock()
	defer vt.mu.Unlock()

	if _, ok := vt.segments[taskID]; !ok {
		vt.segments[taskID] = make(map[int]*VideoSegmentProgress, totalSegments)
	}
	now := time.Now()
	for i := 0; i < totalSegments; i++ {
		if _, exists := vt.segments[taskID][i]; !exists {
			vt.segments[taskID][i] = &VideoSegmentProgress{
				TaskID:     taskID,
				SegmentIdx: i,
				Status:     SegPending,
				UpdatedAt:  now,
			}
		}
	}
}

// UpdateSegment updates a single segment's status.
func (vt *VideoProgressTracker) UpdateSegment(taskID, segmentIdx int, status VideoSegmentStatus, localPath string, fileSize int64, errMsg string) {
	vt.mu.Lock()
	defer vt.mu.Unlock()

	taskSegments, ok := vt.segments[taskID]
	if !ok {
		return
	}
	s, ok := taskSegments[segmentIdx]
	if !ok {
		return
	}
	s.Status = status
	s.UpdatedAt = time.Now()
	if localPath != "" {
		s.LocalPath = localPath
	}
	if fileSize > 0 {
		s.FileSize = fileSize
	}
	if errMsg != "" {
		s.ErrorMsg = errMsg
	}
	if status == SegFailed {
		s.RetryCount++
	}
}

// GetSummary computes the current progress for a video task.
func (vt *VideoProgressTracker) GetSummary(taskID int) VideoProgressSummary {
	vt.mu.RLock()
	defer vt.mu.RUnlock()

	return vt.computeSummaryLocked(taskID)
}

func (vt *VideoProgressTracker) computeSummaryLocked(taskID int) VideoProgressSummary {
	taskSegments, ok := vt.segments[taskID]
	summary := VideoProgressSummary{TaskID: taskID}
	if !ok || len(taskSegments) == 0 {
		return summary
	}

	summary.TotalSegments = len(taskSegments)
	var downloadedBytes int64
	for _, s := range taskSegments {
		switch s.Status {
		case SegCompleted:
			summary.CompletedSegments++
			if s.FileSize > 0 {
				downloadedBytes += s.FileSize
			} else if s.LocalPath != "" {
				if info, err := os.Stat(s.LocalPath); err == nil {
					downloadedBytes += info.Size()
				}
			}
		case SegFailed:
			summary.FailedSegments++
		default:
			summary.PendingSegments++
		}
	}
	summary.DownloadedBytes = downloadedBytes

	if summary.TotalSegments > 0 {
		summary.Progress = math.Round(float64(summary.CompletedSegments)/float64(summary.TotalSegments)*100*100) / 100
	}

	// Compute integrity score: verify file sizes for completed segments.
	if vt.strategy.VerifyIntegrity && summary.CompletedSegments > 0 {
		integrity := vt.computeIntegrityLocked(taskSegments)
		summary.IntegrityScore = integrity
	}

	// Determine status.
	switch {
	case summary.CompletedSegments == summary.TotalSegments:
		summary.Status = "completed"
	case summary.FailedSegments > 0 && summary.CompletedSegments > 0:
		summary.Status = "partial"
	case summary.FailedSegments == summary.TotalSegments:
		summary.Status = "failed"
	default:
		summary.Status = "downloading"
	}

	return summary
}

// computeIntegrityLocked checks file sizes of completed segments
// and returns the percentage that appear valid (non-zero size).
func (vt *VideoProgressTracker) computeIntegrityLocked(taskSegments map[int]*VideoSegmentProgress) float64 {
	if len(taskSegments) == 0 {
		return 0
	}
	completed := 0
	valid := 0
	for _, s := range taskSegments {
		if s.Status != SegCompleted {
			continue
		}
		completed++
		if s.FileSize > 0 {
			valid++
		} else if s.LocalPath != "" {
			if info, err := os.Stat(s.LocalPath); err == nil && info.Size() > 0 {
				valid++
			}
		}
	}
	if completed == 0 {
		return 0
	}
	return math.Round(float64(valid)/float64(completed)*100*100) / 100
}

// GetRetryableSegments returns segments that should be retried.
// Segments exceeding MaxRetries are excluded (permanently failed).
func (vt *VideoProgressTracker) GetRetryableSegments(taskID int) []int {
	vt.mu.RLock()
	defer vt.mu.RUnlock()

	taskSegments, ok := vt.segments[taskID]
	if !ok {
		return nil
	}

	var retryable []int
	for idx, s := range taskSegments {
		if s.Status == SegFailed && s.RetryCount < vt.strategy.MaxRetries {
			retryable = append(retryable, idx)
		}
	}
	sort.Ints(retryable)
	return retryable
}

// GetBackoffDelay computes the delay before the next retry attempt
// using exponential backoff: base * 2^retryCount ms.
func (vt *VideoProgressTracker) GetBackoffDelay(retryCount int) time.Duration {
	shift := uint(retryCount)
	if shift > 10 {
		shift = 10 // cap to avoid overflow
	}
	return time.Duration(vt.strategy.BackoffBaseMs<<shift) * time.Millisecond
}

// VerifySegmentIntegrity checks a downloaded segment file:
//   - File exists and is not empty.
//   - For TS segments, checks for the sync byte (0x47).
// Returns an error if integrity check fails.
func (vt *VideoProgressTracker) VerifySegmentIntegrity(localPath string) error {
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("segment file not found: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("segment file is empty: %s", localPath)
	}

	// Quick TS sync byte check for .ts files.
	if filepath.Ext(localPath) == ".ts" {
		data, err := os.ReadFile(localPath)
		if err != nil {
			return fmt.Errorf("cannot read segment for sync check: %w", err)
		}
		if len(data) == 0 || data[0] != 0x47 {
			return fmt.Errorf("invalid TS sync byte in segment: %s", localPath)
		}
	}

	return nil
}

// CleanupFailedSegments removes segment files that failed integrity
// checks, freeing disk space before retry.
func (vt *VideoProgressTracker) CleanupFailedSegments(taskID int, segDir string) error {
	vt.mu.RLock()
	taskSegments, ok := vt.segments[taskID]
	vt.mu.RUnlock()
	if !ok {
		return fmt.Errorf("task %d not tracked", taskID)
	}

	var cleaned int
	for _, s := range taskSegments {
		if s.Status == SegFailed && s.LocalPath != "" {
			if err := os.Remove(s.LocalPath); err == nil {
				cleaned++
			}
		}
	}

	vt.logger.Info("Cleaned up failed segment files",
		infra.LogContext{Extra: map[string]any{
			"taskId":  taskID,
			"cleaned": cleaned,
		}})
	return nil
}
