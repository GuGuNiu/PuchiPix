package taskprogress

import "time"

// FileStatus represents the download state of a single file within
// a gallery task pipeline.
type FileStatus string

const (
	FilePending     FileStatus = "pending"
	FileDownloading FileStatus = "downloading"
	FileCompleted   FileStatus = "completed"
	FileFailed      FileStatus = "failed"
	FileSkipped     FileStatus = "skipped"
)

// FileType distinguishes between image and video assets.
type FileType string

const (
	FileTypeImage FileType = "image"
	FileTypeVideo FileType = "video"
)

// FileProgress tracks the download state of a single file in a gallery.
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

// GalleryProgressSummary aggregates file-level progress into a
// single progress percentage and breakdown.
type GalleryProgressSummary struct {
	GalleryID       int     `json:"galleryId"`
	TotalFiles      int     `json:"totalFiles"`
	CompletedFiles  int     `json:"completedFiles"`
	FailedFiles     int     `json:"failedFiles"`
	PendingFiles    int     `json:"pendingFiles"`
	SkippedFiles    int     `json:"skippedFiles"`
	Progress        float64 `json:"progress"`         // 0-100
	PartialProgress float64 `json:"partialProgress"`  // including skipped
	ImageCount      int     `json:"imageCount"`
	VideoCount      int     `json:"videoCount"`
	Status          string  `json:"status"`            // aggregate status
}

// RetryRequest specifies which files to retry.
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

// RetryRange defines a contiguous range of file indices.
type RetryRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// RetryStrategy selects the retry behavior.
type RetryStrategy string

const (
	// RetryFailedOnly retries only files with FileFailed status.
	RetryFailedOnly RetryStrategy = "failed_only"
	// RetryRegional retries a contiguous range that covers the failed
	// files plus adjacent files that might share download dependencies.
	RetryRegional RetryStrategy = "regional"
	// RetryAll retries all files regardless of current status.
	RetryAll RetryStrategy = "all"
)

// RetryResult reports the outcome of a retry operation.
type RetryResult struct {
	GalleryID      int      `json:"galleryId"`
	RetriedCount   int      `json:"retriedCount"`
	SkippedCount   int      `json:"skippedCount"`
	FailedIndices  []int    `json:"failedIndices"`
	RetriedIndices []int    `json:"retriedIndices"`
	Message        string   `json:"message"`
}
