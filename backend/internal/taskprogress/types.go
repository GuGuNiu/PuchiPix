package taskprogress

import "time"

type FileStatus string

const (
	FilePending     FileStatus = "pending"
	FileDownloading FileStatus = "downloading"
	FileCompleted   FileStatus = "completed"
	FileFailed      FileStatus = "failed"
	FileSkipped     FileStatus = "skipped"
)

type FileType string

const (
	FileTypeImage FileType = "image"
	FileTypeVideo FileType = "video"
)

type FileProgress struct {
	GalleryID  int        `json:"galleryId"`
	FileIndex  int        `json:"fileIndex"`
	FileType   FileType   `json:"fileType"`
	FileURL    string     `json:"fileUrl"`
	LocalPath  string     `json:"localPath,omitempty"`
	FileSize   int64      `json:"fileSize"`
	Status     FileStatus `json:"status"`
	ErrorMsg   string     `json:"errorMsg,omitempty"`
	RetryCount int        `json:"retryCount"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type GalleryProgressSummary struct {
	GalleryID       int     `json:"galleryId"`
	TotalFiles      int     `json:"totalFiles"`
	CompletedFiles  int     `json:"completedFiles"`
	FailedFiles     int     `json:"failedFiles"`
	PendingFiles    int     `json:"pendingFiles"`
	SkippedFiles    int     `json:"skippedFiles"`
	Progress        float64 `json:"progress"`
	PartialProgress float64 `json:"partialProgress"`
	ImageCount      int     `json:"imageCount"`
	VideoCount      int     `json:"videoCount"`
	Status          string  `json:"status"`
}

type RetryRequest struct {
	// FileIndices specifies individual files to retry. When empty and
	// Range is nil, retries all failed files.
	FileIndices []int `json:"fileIndices,omitempty"`
	// Range specifies a contiguous range of file indices to retry.
	// Both start and end are inclusive.
	Range *RetryRange `json:"range,omitempty"`
	// Strategy overrides the default retry strategy.
	Strategy RetryStrategy `json:"strategy,omitempty"`
}

type RetryRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type RetryStrategy string

const (
	RetryFailedOnly RetryStrategy = "failed_only"
	// Regional retries a contiguous range covering the failed files plus
	// adjacent files that might share download dependencies.
	RetryRegional RetryStrategy = "regional"
	RetryAll      RetryStrategy = "all"
)

// DownloadPhase tracks the sub-state of a gallery's download phase so a retry
// can resume from a checkpoint. A retry re-enters PhaseScanning to look for
// files already on disk, and may jump straight to PhaseComplete when every
// file is present.
type DownloadPhase string

const (
	PhasePending    DownloadPhase = "phase_pending"
	PhaseScanning   DownloadPhase = "phase_scanning"
	PhaseInProgress DownloadPhase = "phase_in_progress"
	PhaseVerifying  DownloadPhase = "phase_verifying"
	PhaseComplete   DownloadPhase = "phase_complete"
	PhaseFailed     DownloadPhase = "phase_failed"
)

type RetryResult struct {
	GalleryID      int    `json:"galleryId"`
	RetriedCount   int    `json:"retriedCount"`
	SkippedCount   int    `json:"skippedCount"`
	FailedIndices  []int  `json:"failedIndices"`
	RetriedIndices []int  `json:"retriedIndices"`
	Message        string `json:"message"`
}
