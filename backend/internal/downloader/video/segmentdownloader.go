package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/stealth"
)

// SegmentTask carries the data needed to download a single TS segment.
type SegmentTask struct {
	Segment M3U8Segment
	DestDir string
	TSID    string
	Referer string
}

// SegmentResult reports the outcome of a segment download attempt,
// including retry count and any terminal error.
type SegmentResult struct {
	Index    int
	TSID     string
	FilePath string
	Error    error
	Attempts int
}

const segmentBaseRetryDelay = time.Second

// DownloadSegment fetches a single TS segment with exponential backoff
// retry and domain fallback, skipping download when a valid file already
// exists on disk to support resume after interruption.
func DownloadSegment(ctx context.Context, task SegmentTask, maxRetries int) SegmentResult {
	filePath := filepath.Join(task.DestDir, fmt.Sprintf("%s.ts", task.TSID))

	// Resume check. This deliberately validates the cached file rather than
	// merely testing Size()>0: a segment truncated by an interrupted run, or
	// one that captured an error page served with HTTP 200, is non-zero and
	// would otherwise be accepted as a valid resume point forever. The
	// expected size is unknown here (no stored Content-Length), so only the
	// structural checks apply.
	if info, err := os.Stat(filePath); err == nil && info.Size() > 0 {
		if vErr := validateSegmentFile(filePath, 0); vErr == nil {
			return SegmentResult{
				Index:    task.Segment.Index,
				TSID:     task.TSID,
				FilePath: filePath,
				Attempts: 0,
			}
		} else {
			m3u8Logger.Warn("Cached segment failed validation, re-downloading",
				infra.LogContext{Extra: map[string]any{
					"tsid":  task.TSID,
					"index": task.Segment.Index,
					"error": vErr.Error(),
				}})
			os.Remove(filePath)
		}
	}

	var lastErr error
	attempts := 0

	for attempt := 0; attempt <= maxRetries; attempt++ {
		attempts++

		if attempt > 0 {
			delay := segmentBaseRetryDelay * time.Duration(1<<uint(attempt-1))
			select {
			case <-ctx.Done():
				return SegmentResult{
					Index:    task.Segment.Index,
					TSID:     task.TSID,
					FilePath: filePath,
					Error:    ctx.Err(),
					Attempts: attempts,
				}
			case <-time.After(delay):
			}
		}

		// The full browser header set is required by CDN bot rules:
		// without sec-ch-ua / Sec-Fetch-* the same URL that returns 200
		// for a browser is answered with 410 Gone.
		headers := stealth.CDNRequestHeaders(nil, task.Referer, stealth.FetchDestEmpty)
		headers["Connection"] = "keep-alive"

		result := downloader.DownloadFileWithDomainFallback(ctx, task.Segment.FullURI, filePath, &downloader.DownloadOptions{
			Headers: headers,
			Atomic:  true,
			Timeout: 60_000_000_000, // 60s per segment (same as gallery image downloads)
		})

		if result.Success {
			// Structural validation, not just a write-success test: compare
			// against the declared Content-Length when the server sent one and
			// check the TS structure, so a short or wrong-content body is
			// retried instead of being merged into the output.
			if vErr := validateSegmentFile(filePath, result.ExpectedSize); vErr == nil {
				return SegmentResult{
					Index:    task.Segment.Index,
					TSID:     task.TSID,
					FilePath: filePath,
					Attempts: attempts,
				}
			} else {
				lastErr = vErr
			}
		} else if result.Error != nil {
			lastErr = result.Error
		} else {
			lastErr = fmt.Errorf("download failed for %s", task.Segment.FullURI)
		}

		os.Remove(filePath)
		os.Remove(filePath + ".tmp")

		if attempt < maxRetries {
			m3u8Logger.Warn("Segment download failed, will retry",
				infra.LogContext{Extra: map[string]any{
					"tsid":    task.TSID,
					"attempt": attempts,
					"error":   lastErr.Error(),
				}})
		}
	}

	return SegmentResult{
		Index:    task.Segment.Index,
		TSID:     task.TSID,
		FilePath: filePath,
		Error:    lastErr,
		Attempts: attempts,
	}
}

// fnv1aHash computes the 32-bit FNV-1a hash of a string, producing
// a deterministic identifier for segment deduplication across retries.
func fnv1aHash(s string) uint32 {
	hash := uint32(0x811c9dc5)
	for i := 0; i < len(s); i++ {
		hash ^= uint32(s[i])
		hash *= 0x01000193
	}
	return hash
}

// GenerateTSID creates a unique identifier for a segment by hashing
// its URI and appending the zero-padded index, ensuring stable filenames
// across download retries and restarts.
func GenerateTSID(uri string, index int) string {
	hash := fnv1aHash(uri)
	return fmt.Sprintf("%08x_%05d", hash, index)
}
