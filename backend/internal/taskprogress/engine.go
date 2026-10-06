package taskprogress

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// Engine tracks per-file progress for gallery tasks. Disk file count is
// authoritative for progress. Per-file status is persisted to the DB so
// retries resume from what is already on disk.
type Engine struct {
	mu     sync.RWMutex
	files  map[int]map[int]*FileProgress // galleryID -> fileIndex -> progress
	logger *infra.Logger
	// onProgress is an optional callback invoked when progress changes.
	onProgress func(galleryID int, summary GalleryProgressSummary)
	// phase tracks the download-phase state machine per gallery.
	phase map[int]DownloadPhase
	// db, when set, persists phase + per-file status for restart/retry
	// recovery via the gallery_file_progress table.
	db *db.Database
}

func NewEngine(logger *infra.Logger) *Engine {
	if logger == nil {
		logger = infra.NewLogger("TaskProgress")
	}
	return &Engine{
		files:  make(map[int]map[int]*FileProgress),
		phase:  make(map[int]DownloadPhase),
		logger: logger,
	}
}

// SetDatabase attaches the database used for checkpoint persistence.
// When nil, progress tracking remains purely in-memory (tests).
func (e *Engine) SetDatabase(database *db.Database) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.db = database
}

// SetOnProgress installs the callback invoked after every per-file status
// change with the fresh summary. Nil (the default) keeps gallery progress
// pull-only via GetSummary; wiring the callback gives the SSE bus its push
// path. The callback must be cheap and tolerate concurrent calls.
func (e *Engine) SetOnProgress(cb func(galleryID int, summary GalleryProgressSummary)) {
	e.mu.Lock()
	e.onProgress = cb
	e.mu.Unlock()
}

// RemoveGallery drops the in-memory files and phase for a gallery; without
// it the maps keep one entry per deleted gallery for the process lifetime.
func (e *Engine) RemoveGallery(galleryID int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.files, galleryID)
	delete(e.phase, galleryID)
}

const tableFileProgress = "gallery_file_progress"

// phaseRowFileIndex is the sentinel file_index value used for the
// gallery-level phase row, keeping it distinct from per-file rows
// (which use file_index >= 0). This lets both share the composite
// PRIMARY KEY (gallery_id, file_index) without collision.
const phaseRowFileIndex = -1

var validDownloadPhaseTransitions = map[DownloadPhase][]DownloadPhase{
	PhasePending:    {PhaseScanning, PhaseInProgress, PhaseFailed},
	PhaseScanning:   {PhaseInProgress, PhaseComplete, PhaseFailed},
	PhaseInProgress: {PhaseVerifying, PhaseComplete, PhaseFailed, PhaseScanning},
	PhaseVerifying:  {PhaseComplete, PhaseFailed, PhaseInProgress},
	PhaseComplete:   {},
	PhaseFailed:     {PhaseScanning, PhaseInProgress},
}

// SetPhase moves the gallery's download phase, rejecting transitions absent
// from validDownloadPhaseTransitions, and persists the new phase when a
// database is attached.
func (e *Engine) SetPhase(galleryID int, phase DownloadPhase) error {
	e.mu.Lock()
	current, exists := e.phase[galleryID]
	if !exists {
		current = PhasePending
	}
	allowed, ok := validDownloadPhaseTransitions[current]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("illegal download phase transition from %s", current)
	}
	legal := false
	for _, s := range allowed {
		if s == phase {
			legal = true
			break
		}
	}
	if !legal {
		e.mu.Unlock()
		return fmt.Errorf("illegal download phase transition: %s -> %s", current, phase)
	}
	e.phase[galleryID] = phase
	database := e.db
	e.mu.Unlock()

	if database != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := database.Exec(ctx,
			`INSERT INTO `+tableFileProgress+` (gallery_id, file_index, phase, updated_at)
			 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT (gallery_id, file_index) DO UPDATE SET phase = ?, updated_at = CURRENT_TIMESTAMP`,
			galleryID, phaseRowFileIndex, string(phase), string(phase))
		if err != nil {
			e.logger.Warn("Failed to persist download phase", "galleryId", galleryID, "error", err.Error())
		}
	}
	e.logger.Info("Download phase changed", "galleryId", galleryID, "phase", phase)
	return nil
}

// GetPhase reports PhasePending for a gallery with no recorded phase.
func (e *Engine) GetPhase(galleryID int) DownloadPhase {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if p, ok := e.phase[galleryID]; ok {
		return p
	}
	return PhasePending
}

func (e *Engine) CanTransitionPhase(from, to DownloadPhase) bool {
	allowed, ok := validDownloadPhaseTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// CanTransitionDownloadPhase is a lock-free validity check for callers that
// do not hold an Engine instance.
func CanTransitionDownloadPhase(from, to DownloadPhase) bool {
	allowed, ok := validDownloadPhaseTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// RegisterFiles is called once the scrape phase knows the expected file list.
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

	// The summary is snapshotted under the lock so the callback runs after
	// it has been released.
	summary := e.computeSummaryLocked(galleryID)
	cb := e.onProgress
	e.mu.Unlock()

	if cb != nil {
		cb(galleryID, summary)
	}
}

func (e *Engine) GetSummary(galleryID int) GalleryProgressSummary {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.computeSummaryLocked(galleryID)
}

// computeSummaryLocked must be called with at least a read lock held.
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
		// Skipped files count as done so the progress bar still reaches
		// 100% when files were intentionally skipped.
		done := summary.CompletedFiles + summary.SkippedFiles
		summary.Progress = math.Round(float64(done)/float64(summary.TotalFiles)*100*100) / 100
		// PartialProgress mirrors Progress and is retained for API compatibility.
		summary.PartialProgress = summary.Progress
	}

	summary.Status = computeAggregateStatus(summary)

	return summary
}

func computeAggregateStatus(s GalleryProgressSummary) string {
	if s.TotalFiles == 0 {
		return "pending"
	}
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

// retryFailedOnly returns failed file indices, narrowed to the request's
// FileIndices or Range when either is set.
func (e *Engine) retryFailedOnly(galleryFiles map[int]*FileProgress, req RetryRequest) ([]int, error) {
	if len(req.FileIndices) > 0 {
		var result []int
		for _, idx := range req.FileIndices {
			if f, ok := galleryFiles[idx]; ok && f.Status == FileFailed {
				result = append(result, idx)
			}
		}
		return result, nil
	}

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

	var result []int
	for idx, f := range galleryFiles {
		if f.Status == FileFailed {
			result = append(result, idx)
		}
	}
	sort.Ints(result)
	return result, nil
}

// retryRegional expands each failed file into a window and merges overlapping
// windows. Video files are retried individually to avoid re-downloading
// segments that already succeeded.
func (e *Engine) retryRegional(galleryFiles map[int]*FileProgress, req RetryRequest) ([]int, error) {
	const windowSize = 2

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

	type interval struct{ start, end int }
	var intervals []interval
	for _, fi := range failedIndices {
		if f, ok := galleryFiles[fi]; ok && f.FileType == FileTypeVideo {
			intervals = append(intervals, interval{fi, fi})
			continue
		}
		start := fi - windowSize
		if start < 0 {
			start = 0
		}
		end := fi + windowSize
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

	seen := make(map[int]bool)
	var result []int
	for _, inv := range merged {
		for idx := inv.start; idx <= inv.end; idx++ {
			if !seen[idx] {
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

func CountFilesOnDisk(dir string) int {
	return countFilesRecursive(dir)
}

// SaveProgress persists per-file status and phase so a later load can skip
// files that already completed.
func (e *Engine) SaveProgress(ctx context.Context, database *db.Database, galleryID int) error {
	if database == nil {
		return nil
	}
	e.mu.RLock()
	galleryFiles, ok := e.files[galleryID]
	phase := e.phase[galleryID]
	e.mu.RUnlock()
	if !ok || len(galleryFiles) == 0 {
		return nil
	}

	// The upsert keeps the previously stored local_path and file_size when
	// the new values are empty, so a partial save cannot erase checkpoints.
	for _, f := range galleryFiles {
		_, err := database.Exec(ctx,
			`INSERT INTO `+tableFileProgress+`
			 (gallery_id, file_index, file_type, file_url, local_path, file_size, status, error_msg, retry_count, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT (gallery_id, file_index) DO UPDATE SET
			   status = EXCLUDED.status,
			   local_path = COALESCE(EXCLUDED.local_path, `+tableFileProgress+`.local_path),
			   file_size = CASE WHEN EXCLUDED.file_size > 0 THEN EXCLUDED.file_size ELSE `+tableFileProgress+`.file_size END,
			   error_msg = EXCLUDED.error_msg,
			   retry_count = EXCLUDED.retry_count,
			   updated_at = CURRENT_TIMESTAMP`,
			galleryID, f.FileIndex, string(f.FileType), f.FileURL,
			f.LocalPath, f.FileSize, string(f.Status), f.ErrorMsg, f.RetryCount)
		if err != nil {
			e.logger.Warn("Failed to persist file progress", "galleryId", galleryID, "fileIndex", f.FileIndex, "error", err.Error())
		}
	}

	if phase != "" {
		_, _ = database.Exec(ctx,
			`INSERT INTO `+tableFileProgress+` (gallery_id, file_index, phase, updated_at)
			 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT (gallery_id, file_index) DO UPDATE SET phase = ?, updated_at = CURRENT_TIMESTAMP`,
			galleryID, phaseRowFileIndex, string(phase), string(phase))
	}

	e.logger.Info("Progress saved to DB", "galleryId", galleryID, "files", len(galleryFiles))
	return nil
}

// EnsureLoadedForRetry hydrates the file map from the checkpoint table first,
// because after a restart the map is empty and every fine-grained retry would
// fail with "gallery N not found in progress tracker". An already tracked
// gallery is left alone so in-flight statuses are not clobbered.
func (e *Engine) EnsureLoadedForRetry(ctx context.Context, database *db.Database, galleryID int) error {
	e.mu.RLock()
	tracked := len(e.files[galleryID]) > 0
	e.mu.RUnlock()
	if tracked {
		return nil
	}
	return e.LoadProgress(ctx, database, galleryID)
}

// ResetFileStatusForRetry marks the given file indices pending again so the
// summary reflects the queued re-download. Completed files are left untouched
// so an over-broad retry strategy cannot re-queue a successful download.
func (e *Engine) ResetFileStatusForRetry(galleryID int, fileIndices []int) int {
	e.mu.Lock()
	galleryFiles, ok := e.files[galleryID]
	if !ok {
		e.mu.Unlock()
		return 0
	}
	now := time.Now()
	reset := 0
	for _, idx := range fileIndices {
		if f, ok := galleryFiles[idx]; ok && f.Status != FileCompleted {
			f.Status = FilePending
			f.ErrorMsg = ""
			f.UpdatedAt = now
			reset++
		}
	}
	summary := e.computeSummaryLocked(galleryID)
	cb := e.onProgress
	e.mu.Unlock()

	if cb != nil {
		cb(galleryID, summary)
	}
	return reset
}

// LoadProgress restores per-file status and phase from the checkpoint table.
func (e *Engine) LoadProgress(ctx context.Context, database *db.Database, galleryID int) error {
	if database == nil {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	var phaseStr string
	err := database.QueryRow(ctx,
		`SELECT COALESCE(phase, '') FROM `+tableFileProgress+` WHERE gallery_id = ? AND file_index = ?`,
		galleryID, phaseRowFileIndex).Scan(&phaseStr)
	if err == nil && phaseStr != "" {
		e.phase[galleryID] = DownloadPhase(phaseStr)
	}

	rows, err := database.Query(ctx,
		`SELECT file_index, file_type, file_url, local_path, file_size, status, error_msg, retry_count
		 FROM `+tableFileProgress+` WHERE gallery_id = ? AND file_index >= 0 ORDER BY file_index`,
		galleryID)
	if err != nil {
		// Table may not exist yet (first run or migration not applied).
		return nil
	}
	defer rows.Close()

	if _, ok := e.files[galleryID]; !ok {
		e.files[galleryID] = make(map[int]*FileProgress)
	}
	now := time.Now()
	for rows.Next() {
		var f FileProgress
		var fileTypeStr, statusStr string
		if scanErr := rows.Scan(&f.FileIndex, &fileTypeStr, &f.FileURL, &f.LocalPath, &f.FileSize, &statusStr, &f.ErrorMsg, &f.RetryCount); scanErr != nil {
			continue
		}
		f.GalleryID = galleryID
		f.FileType = FileType(fileTypeStr)
		f.Status = FileStatus(statusStr)
		f.CreatedAt = now
		f.UpdatedAt = now
		e.files[galleryID][f.FileIndex] = &f
	}

	if len(e.files[galleryID]) > 0 {
		e.logger.Info("Progress loaded from DB", "galleryId", galleryID, "files", len(e.files[galleryID]), "phase", phaseStr)
	}
	return nil
}
