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

type VideoSegmentStatus string

const (
	SegPending     VideoSegmentStatus = "pending"
	SegDownloading VideoSegmentStatus = "downloading"
	SegCompleted   VideoSegmentStatus = "completed"
	SegFailed      VideoSegmentStatus = "failed"
)

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
	// BackoffBaseMs is the base delay for exponential backoff between retries.
	BackoffBaseMs int
}

func DefaultVideoRetryStrategy() VideoRetryStrategy {
	return VideoRetryStrategy{
		MaxRetries:         5,
		ConcurrentSegments: 3,
		VerifyIntegrity:    true,
		BackoffBaseMs:      1000,
	}
}

type VideoProgressTracker struct {
	mu       sync.RWMutex
	segments map[int]map[int]*VideoSegmentProgress // taskID -> segmentIdx -> progress
	strategy VideoRetryStrategy
	logger   *infra.Logger
}

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

func (vt *VideoProgressTracker) RegisterSegments(taskID int, totalSegments int) {
	indices := make([]int, totalSegments)
	for i := range indices {
		indices[i] = i
	}
	vt.RegisterSegmentIndices(taskID, indices)
}

func (vt *VideoProgressTracker) RegisterSegmentIndices(taskID int, indices []int) {
	vt.mu.Lock()
	defer vt.mu.Unlock()

	existing, exists := vt.segments[taskID]
	sameIndices := exists && len(existing) == len(indices)
	if sameIndices {
		for _, index := range indices {
			if _, ok := existing[index]; !ok {
				sameIndices = false
				break
			}
		}
	}
	if sameIndices {
		return
	}

	vt.segments[taskID] = make(map[int]*VideoSegmentProgress, len(indices))
	now := time.Now()
	for _, index := range indices {
		vt.segments[taskID][index] = &VideoSegmentProgress{
			TaskID:     taskID,
			SegmentIdx: index,
			Status:     SegPending,
			UpdatedAt:  now,
		}
	}
}

func (vt *VideoProgressTracker) RemoveTask(taskID int) {
	vt.mu.Lock()
	delete(vt.segments, taskID)
	vt.mu.Unlock()
}

// UpdateSegment records the outcome for one segment, resolving the file size
// from disk when the caller reports completion without a size.
func (vt *VideoProgressTracker) UpdateSegment(taskID, segmentIdx int, status VideoSegmentStatus, localPath string, fileSize int64, errMsg string) {
	if status == SegCompleted && fileSize <= 0 && localPath != "" {
		if info, err := os.Stat(localPath); err == nil {
			fileSize = info.Size()
		}
	}
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

	if vt.strategy.VerifyIntegrity && summary.CompletedSegments > 0 {
		integrity := vt.computeIntegrityLocked(taskSegments)
		summary.IntegrityScore = integrity
	}

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
	// Cap the shift so the computed duration does not overflow.
	if shift > 10 {
		shift = 10
	}
	return time.Duration(vt.strategy.BackoffBaseMs<<shift) * time.Millisecond
}

// VerifySegmentIntegrity rejects a missing or empty segment, and for .ts
// segments also requires the 0x47 sync byte at offset 0.
func (vt *VideoProgressTracker) VerifySegmentIntegrity(localPath string) error {
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("segment file not found: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("segment file is empty: %s", localPath)
	}

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
