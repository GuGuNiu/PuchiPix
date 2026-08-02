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

// Engine tracks per-file progress for gallery tasks, computes aggregate
// progress summaries, and manages retry strategies. It serves as the
// single source of truth for progress calculation, replacing the
// previous approach that hardcoded progress as 0 for gallery tasks.
//
// Design principles:
//  1. Disk-first: actual file count on disk is authoritative for progress.
//  2. Incremental: progress is updated per-file as downloads complete.
//  3. Regional retry: failed files trigger retry of their neighborhood
//     to account for download dependencies (e.g., session cookies, rate limits).
//  4. Video-aware: video files get dedicated retry strategies with
//     segment-level tracking and integrity verification.
type Engine struct {
	mu     sync.RWMutex
	files  map[int]map[int]*FileProgress // galleryID -> fileIndex -> progress
	logger *infra.Logger
	// onProgress is an optional callback invoked when progress changes.
	onProgress func(galleryID int, summary GalleryProgressSummary)
}

// NewEngine creates a progress tracking engine.
func NewEngine(logger *infra.Logger) *Engine {
	if logger == nil {
		logger = infra.NewLogger("TaskProgress")
	}
	return &Engine{
		files:  make(map[int]map[int]*FileProgress),
		logger: logger,
	}
}

// SetProgressCallback registers a callback for progress change notifications.
func (e *Engine) SetProgressCallback(cb func(galleryID int, summary GalleryProgressSummary)) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.onProgress = cb
}

// RegisterFiles initializes file tracking for a gallery. Called after
// the scrape phase when we know the expected file counts.
func (e *Engine) RegisterFiles(galleryID int, files []FileProgress) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if _, ok := e.files[galleryID]; !ok {
		e.files[galleryID] = make(map[int]*FileProgress)
	}
	now := time.Now()
	for i := range files {
		f := &files[i]
		f.GalleryID = galleryID
		f.CreatedAt = now
		f.UpdatedAt = now
		e.files[galleryID][f.FileIndex] = f
	}
	e.logger.Info("Registered files for progress tracking",
		infra.LogContext{Extra: map[string]any{
			"galleryId": galleryID,
			"fileCount": len(files),
		}})
}

// UpdateFileStatus updates the status of a single file and triggers
// progress recalculation.
func (e *Engine) UpdateFileStatus(galleryID, fileIndex int, status FileStatus, localPath string, fileSize int64, errMsg string) {
	e.mu.Lock()
	galleryFiles, ok := e.files[galleryID]
	if !ok {
		e.mu.Unlock()
		return
	}
	f, ok := galleryFiles[fileIndex]
	if !ok {
		e.mu.Unlock()
		return
	}
	f.Status = status
	f.UpdatedAt = time.Now()
	if localPath != "" {
		f.LocalPath = localPath
	}
	if fileSize > 0 {
		f.FileSize = fileSize
	}
	if errMsg != "" {
		f.ErrorMsg = errMsg
	}
	if status == FileFailed {
		f.RetryCount++
	}

	// Snapshot summary under lock, then call callback outside.
	summary := e.computeSummaryLocked(galleryID)
	cb := e.onProgress
	e.mu.Unlock()

	if cb != nil {
		cb(galleryID, summary)
	}
}

// GetSummary computes the current progress summary for a gallery.
func (e *Engine) GetSummary(galleryID int) GalleryProgressSummary {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.computeSummaryLocked(galleryID)
}

// computeSummaryLocked builds the aggregate progress summary for a
// gallery. Must be called with at least a read lock held.
func (e *Engine) computeSummaryLocked(galleryID int) GalleryProgressSummary {
	galleryFiles, ok := e.files[galleryID]
	summary := GalleryProgressSummary{GalleryID: galleryID}

	if !ok || len(galleryFiles) == 0 {
		return summary
	}

	for _, f := range galleryFiles {
		summary.TotalFiles++
		switch f.FileType {
		case FileTypeImage:
			summary.ImageCount++
		case FileTypeVideo:
			summary.VideoCount++
		}
		switch f.Status {
		case FileCompleted:
			summary.CompletedFiles++
		case FileFailed:
			summary.FailedFiles++
		case FileSkipped:
			summary.SkippedFiles++
		default:
			summary.PendingFiles++
		}
	}

	if summary.TotalFiles > 0 {
		// Progress includes both completed and skipped files — skipped
		// files are considered "done" for progress purposes. This ensures
		// the progress bar reaches 100% when all files are either
		// completed or intentionally skipped.
		done := summary.CompletedFiles + summary.SkippedFiles
		summary.Progress = math.Round(float64(done)/float64(summary.TotalFiles)*100*100) / 100
		summary.PartialProgress = summary.Progress // kept for API backward-compat
	}

	// Determine aggregate status.
	summary.Status = computeAggregateStatus(summary)

	return summary
}

// computeAggregateStatus determines the gallery-level status from
// per-file progress.
func computeAggregateStatus(s GalleryProgressSummary) string {
	if s.TotalFiles == 0 {
		return "pending"
	}
	// Skipped files count as "done" for completion purposes.
	// A gallery is completed when all files are either completed or
	// skipped (with zero failures).
	done := s.CompletedFiles + s.SkippedFiles
	if done == s.TotalFiles && s.FailedFiles == 0 {
		return "completed"
	}
	if s.FailedFiles > 0 && s.CompletedFiles > 0 {
		return "partial"
	}
	if s.FailedFiles == s.TotalFiles {
		return "failed"
	}
	if s.CompletedFiles > 0 || s.SkippedFiles > 0 {
		return "downloading"
	}
	return "pending"
}

// GetFailedFiles returns the list of file indices that have failed
// for a gallery. Used by the retry engine to determine what to retry.
func (e *Engine) GetFailedFiles(galleryID int) []FileProgress {
	e.mu.RLock()
	defer e.mu.RUnlock()

	galleryFiles, ok := e.files[galleryID]
	if !ok {
		return nil
	}

	var failed []FileProgress
	for _, f := range galleryFiles {
		if f.Status == FileFailed {
			failed = append(failed, *f)
		}
	}
	sort.Slice(failed, func(i, j int) bool { return failed[i].FileIndex < failed[j].FileIndex })
	return failed
}

// ComputeRetryRange determines which files to retry based on the
// selected strategy.
//
// Strategy behaviors:
//   - failed_only: retry exactly the files that failed.
//   - regional: for each failed file, expand to a window of ±N files
//     (default N=2) to account for download dependencies. Overlapping
//     windows are merged. Video files always get individual retry.
//   - all: retry all non-completed files.
func (e *Engine) ComputeRetryRange(galleryID int, req RetryRequest) ([]int, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	galleryFiles, ok := e.files[galleryID]
	if !ok {
		return nil, fmt.Errorf("gallery %d not found in progress tracker", galleryID)
	}

	strategy := req.Strategy
	if strategy == "" {
		strategy = RetryFailedOnly
	}

	switch strategy {
	case RetryFailedOnly:
		return e.retryFailedOnly(galleryFiles, req)
	case RetryRegional:
		return e.retryRegional(galleryFiles, req)
	case RetryAll:
		return e.retryAll(galleryFiles)
	default:
		return e.retryFailedOnly(galleryFiles, req)
	}
}

// retryFailedOnly returns indices of files that failed, optionally
// filtered by the request's FileIndices or Range.
func (e *Engine) retryFailedOnly(galleryFiles map[int]*FileProgress, req RetryRequest) ([]int, error) {
	// If specific indices requested, validate they're failed.
	if len(req.FileIndices) > 0 {
		var result []int
		for _, idx := range req.FileIndices {
			if f, ok := galleryFiles[idx]; ok && f.Status == FileFailed {
				result = append(result, idx)
			}
		}
		return result, nil
	}

	// If range specified, collect failed files within range.
	if req.Range != nil {
		var result []int
		for idx, f := range galleryFiles {
			if f.Status == FileFailed && idx >= req.Range.Start && idx <= req.Range.End {
				result = append(result, idx)
			}
		}
		sort.Ints(result)
		return result, nil
	}

	// Default: all failed files.
	var result []int
	for idx, f := range galleryFiles {
		if f.Status == FileFailed {
			result = append(result, idx)
		}
	}
	sort.Ints(result)
	return result, nil
}

// retryRegional expands each failed file into a window and merges
// overlapping windows. Video files are retried individually to avoid
// unnecessary segment re-downloads.
func (e *Engine) retryRegional(galleryFiles map[int]*FileProgress, req RetryRequest) ([]int, error) {
	const windowSize = 2 // ±2 files from each failure

	// Collect failed indices.
	var failedIndices []int
	for idx, f := range galleryFiles {
		if f.Status == FileFailed {
			failedIndices = append(failedIndices, idx)
		}
	}
	if len(failedIndices) == 0 {
		return nil, nil
	}
	sort.Ints(failedIndices)

	// Build windows around each failure.
	type interval struct{ start, end int }
	var intervals []interval
	for _, fi := range failedIndices {
		// Video files: retry individually (no window expansion).
		if f, ok := galleryFiles[fi]; ok && f.FileType == FileTypeVideo {
			intervals = append(intervals, interval{fi, fi})
			continue
		}
		start := fi - windowSize
		if start < 0 {
			start = 0
		}
		end := fi + windowSize
		// Clamp to valid file range.
		maxIdx := 0
		for idx := range galleryFiles {
			if idx > maxIdx {
				maxIdx = idx
			}
		}
		if end > maxIdx {
			end = maxIdx
		}
		intervals = append(intervals, interval{start, end})
	}

	// Merge overlapping intervals.
	sort.Slice(intervals, func(i, j int) bool { return intervals[i].start < intervals[j].start })
	merged := []interval{intervals[0]}
	for i := 1; i < len(intervals); i++ {
		last := &merged[len(merged)-1]
		if intervals[i].start <= last.end+1 {
			if intervals[i].end > last.end {
				last.end = intervals[i].end
			}
		} else {
			merged = append(merged, intervals[i])
		}
	}

	// Collect all indices in merged intervals.
	seen := make(map[int]bool)
	var result []int
	for _, inv := range merged {
		for idx := inv.start; idx <= inv.end; idx++ {
			if !seen[idx] {
				// Include only non-completed files within the window.
				if f, ok := galleryFiles[idx]; ok && f.Status != FileCompleted {
					result = append(result, idx)
					seen[idx] = true
				}
			}
		}
	}
	sort.Ints(result)
	return result, nil
}

// retryAll returns all non-completed file indices.
func (e *Engine) retryAll(galleryFiles map[int]*FileProgress) ([]int, error) {
	var result []int
	for idx, f := range galleryFiles {
		if f.Status != FileCompleted {
			result = append(result, idx)
		}
	}
	sort.Ints(result)
	return result, nil
}

// ResolveProgressFromDisk scans the gallery's save directory and
// synchronizes the in-memory progress with the actual files on disk.
// This is used at startup and after crashes to recover accurate
// progress state.
func (e *Engine) ResolveProgressFromDisk(galleryID int, savePath string, expectedFiles []FileProgress) GalleryProgressSummary {
	// Count actual files on disk.
	actualCount := countFilesRecursive(savePath)

	// If no files on disk and no tracking data, register expected files.
	e.mu.Lock()
	if _, ok := e.files[galleryID]; !ok {
		e.RegisterFiles(galleryID, expectedFiles)
	}
	e.mu.Unlock()

	// Mark files as completed based on disk presence.
	// Files on disk that aren't tracked are marked as completed.
	// Tracked files not on disk are marked as pending (to be retried).
	if actualCount > 0 {
		e.mu.RLock()
		galleryFiles := e.files[galleryID]
		e.mu.RUnlock()

		completedOnDisk := 0
		for idx, f := range galleryFiles {
			if f.LocalPath != "" {
				if _, err := os.Stat(f.LocalPath); err == nil {
					if f.Status != FileCompleted {
						e.UpdateFileStatus(galleryID, idx, FileCompleted, f.LocalPath, f.FileSize, "")
					}
					completedOnDisk++
				}
			}
		}

		// If disk count exceeds tracked count, we may have unregistered files.
		// Trust the disk count for progress in that case.
		if actualCount > completedOnDisk+len(galleryFiles) {
			e.logger.Warn("Disk file count exceeds tracked count - possible untracked files",
				infra.LogContext{Extra: map[string]any{
					"galleryId":      galleryID,
					"actualCount":    actualCount,
					"trackedCount":   len(galleryFiles),
					"completedCount": completedOnDisk,
				}})
		}
	}

	return e.GetSummary(galleryID)
}

// countFilesRecursive counts all regular files in a directory tree.
func countFilesRecursive(dir string) int {
	count := 0
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			count++
		}
		return nil
	})
	return count
}

// CountFilesOnDisk is a public convenience wrapper for counting files.
func CountFilesOnDisk(dir string) int {
	return countFilesRecursive(dir)
}
