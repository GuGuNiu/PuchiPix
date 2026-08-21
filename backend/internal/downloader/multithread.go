package downloader

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"backend/internal/infra"
	"backend/internal/stealth"
)

var mtLogger = infra.NewLogger("MultiThreadDownload")

// rangeProbeResult holds metadata gathered from the initial
// Range: bytes=0-0 probe request.
type rangeProbeResult struct {
	supportsRange bool
	totalSize     int64
	finalURL      string
	etag          string
	lastModified  string
}

// chunkRange represents a non-overlapping closed interval [start, end].
type chunkRange struct {
	start int64
	end   int64
}

// probeRangeSupport sends a Range: bytes=0-0 request to check whether
// the server supports partial content (HTTP 206) and to collect the
// total content size, final redirect URL, and identity validators
// (ETag / Last-Modified).
func probeRangeSupport(ctx context.Context, url string, opts *DownloadOptions, timeout time.Duration) (*rangeProbeResult, error) {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, opts.Referer)
	for k, v := range opts.Headers {
		headers.Set(k, v)
	}
	// Prevent transparent compression — gzip would break offset writes.
	headers.Set("Accept-Encoding", "identity")
	headers.Set("Range", "bytes=0-0")

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("probe request: %w", err)
	}
	req.Header = headers

	client := newMultiThreadClient(timeout)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("probe request: %w", err)
	}
	defer resp.Body.Close()

	result := &rangeProbeResult{
		finalURL: resp.Request.URL.String(),
	}

	if resp.StatusCode != http.StatusPartialContent {
		// Server ignored Range and returned 200 — not an error,
		// but multi-thread is not usable.
		result.supportsRange = false
		return result, nil
	}

	result.supportsRange = true
	result.etag = resp.Header.Get("ETag")
	result.lastModified = resp.Header.Get("Last-Modified")

	cr := resp.Header.Get("Content-Range")
	if cr == "" {
		result.supportsRange = false
		return result, nil
	}

	// Content-Range format: bytes 0-0/12345
	total, ok := parseContentRangeTotal(cr)
	if !ok {
		result.supportsRange = false
		return result, nil
	}
	result.totalSize = total

	return result, nil
}

// parseContentRangeTotal extracts the total size from a Content-Range
// header value like "bytes 0-0/12345".
func parseContentRangeTotal(cr string) (int64, bool) {
	idx := strings.LastIndexByte(cr, '/')
	if idx < 0 || idx == len(cr)-1 {
		return 0, false
	}
	total, err := strconv.ParseInt(cr[idx+1:], 10, 64)
	if err != nil || total <= 0 {
		return 0, false
	}
	return total, true
}

// splitRanges divides totalSize into n non-overlapping closed intervals.
// The last chunk absorbs any remainder so that intervals are contiguous
// and cover the entire file.
func splitRanges(totalSize int64, n int) []chunkRange {
	if n < 2 {
		n = 2
	}
	chunkSize := totalSize / int64(n)
	if chunkSize == 0 {
		chunkSize = 1
	}
	var ranges []chunkRange
	var start int64 = 0
	for i := 0; i < n; i++ {
		end := start + chunkSize - 1
		if i == n-1 {
			end = totalSize - 1
		}
		if end > totalSize-1 {
			end = totalSize - 1
		}
		if start > end {
			break
		}
		ranges = append(ranges, chunkRange{start: start, end: end})
		start = end + 1
	}
	return ranges
}

// newMultiThreadClient creates an HTTP client with compression disabled
// so that Range offsets are not corrupted by transparent decompression.
func newMultiThreadClient(timeout time.Duration) *http.Client {
	transport := &http.Transport{
		DisableCompression: true,
		ForceAttemptHTTP2:  true,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}
}

// downloadFileMultiThread downloads a file using HTTP Range parallel
// requests. It creates a staging file, pre-allocates it to totalSize,
// spawns concurrent workers each writing to its own offset, and
// atomically renames the staging file to the final path on success.
//
// Preconditions: caller must have verified Range support via
// probeRangeSupport and passed valid totalSize/etag/lastModified.
func downloadFileMultiThread(ctx context.Context, url, filePath string, opts *DownloadOptions, totalSize int64, etag, lastModified string) *DownloadResult {
	concurrency := opts.Concurrency
	if concurrency < 2 {
		concurrency = 2
	}
	if concurrency > 8 {
		concurrency = 8
	}

	minFileSize := opts.MinFileSize
	if minFileSize <= 0 {
		minFileSize = 1 << 20 // 1 MB
	}
	if totalSize < minFileSize {
		return nil //nolint:nilnil // signals caller to fall back
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return &DownloadResult{Success: false, Error: err}
	}

	stagingPath, err := makeStagingPath(filePath)
	if err != nil {
		return &DownloadResult{Success: false, Error: err}
	}

	// Truncate to totalSize so WriteAt works at any offset.
	f, err := os.Create(stagingPath)
	if err != nil {
		return &DownloadResult{Success: false, Error: fmt.Errorf("create staging: %w", err)}
	}
	if err := f.Truncate(totalSize); err != nil {
		f.Close()
		os.Remove(stagingPath)
		return &DownloadResult{Success: false, Error: fmt.Errorf("truncate staging: %w", err)}
	}
	defer func() {
		f.Close()
	}()

	// Closing before remove avoids failure on Windows where os.Remove fails on locked files.
	cleanup := func() {
		f.Close()
		os.Remove(stagingPath)
	}

	ranges := splitRanges(totalSize, concurrency)
	rateLimiter := NewSharedRateLimiter(opts.MaxSpeed)
	client := newMultiThreadClient(0) // per-request timeout via context

	g, gctx := errgroup.WithContext(ctx)
	for _, r := range ranges {
		r := r
		g.Go(func() error {
			return downloadChunkWithRetry(gctx, client, url, f, r, opts, etag, lastModified, rateLimiter)
		})
	}

	if err := g.Wait(); err != nil {
		cleanup()
		return &DownloadResult{Success: false, Error: err}
	}

	fi, err := f.Stat()
	if err != nil {
		cleanup()
		return &DownloadResult{Success: false, Error: err}
	}
	if fi.Size() != totalSize {
		cleanup()
		return &DownloadResult{Success: false, Error: fmt.Errorf("staging size mismatch: got %d, want %d", fi.Size(), totalSize)}
	}
	f.Close()

	if err := os.Rename(stagingPath, filePath); err != nil {
		cleanup()
		return &DownloadResult{Success: false, Error: fmt.Errorf("rename staging: %w", err)}
	}

	return &DownloadResult{
		Success:   true,
		FileSize:  totalSize,
		SavedPath: filePath,
	}
}

// makeStagingPath generates a unique staging file path by appending
// a random suffix to the base name + ".mtmp".
func makeStagingPath(filePath string) (string, error) {
	rnd := make([]byte, 8)
	if _, err := rand.Read(rnd); err != nil {
		return "", err
	}
	suffix := hex.EncodeToString(rnd)
	dir := filepath.Dir(filePath)
	base := filepath.Base(filePath)
	return filepath.Join(dir, base+".mtmp."+suffix), nil
}

// downloadChunkWithRetry downloads a single chunk with exponential
// backoff retry (max 3 attempts). Only the failing chunk is retried;
// already-succeeded chunks are not re-downloaded.
func downloadChunkWithRetry(ctx context.Context, client *http.Client, url string, f *os.File, r chunkRange, opts *DownloadOptions, expectedETag, expectedLastModified string, rl *SharedRateLimiter) error {
	const maxRetries = 3
	baseDelay := 500 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(baseDelay << uint(attempt-1)):
			}
		}

		err := downloadChunk(ctx, client, url, f, r, opts, expectedETag, expectedLastModified, rl)
		if err == nil {
			return nil
		}
		lastErr = err
		mtLogger.Debug("chunk download retry",
			infra.LogContext{Extra: map[string]any{
				"start":   r.start,
				"end":     r.end,
				"attempt": attempt + 1,
				"error":   err.Error(),
			}})
	}
	return fmt.Errorf("chunk %d-%d after %d retries: %w", r.start, r.end, maxRetries, lastErr)
}

// downloadChunk performs a single Range request for one chunk and
// writes the response body to the staging file at the chunk's offset.
func downloadChunk(ctx context.Context, client *http.Client, url string, f *os.File, r chunkRange, opts *DownloadOptions, expectedETag, expectedLastModified string, rl *SharedRateLimiter) error {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, opts.Referer)
	for k, v := range opts.Headers {
		headers.Set(k, v)
	}
	headers.Set("Accept-Encoding", "identity")
	headers.Set("Range", fmt.Sprintf("bytes=%d-%d", r.start, r.end))

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header = headers

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if err := validateChunkResponse(resp, r, expectedETag, expectedLastModified); err != nil {
		return err
	}

	reader := newLimitedReader(resp.Body, rl, ctx)
	buf := make([]byte, 64*1024)
	offset := r.start
	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			if _, werr := f.WriteAt(buf[:n], offset); werr != nil {
				return werr
			}
			offset += int64(n)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	expected := r.end - r.start + 1
	written := offset - r.start
	if written != expected {
		return fmt.Errorf("chunk %d-%d byte count mismatch: got %d, want %d", r.start, r.end, written, expected)
	}

	return nil
}

// validateChunkResponse verifies that the server returned a valid 206
// response matching the requested range and that the resource identity
// (ETag / Last-Modified) has not changed since the initial probe.
func validateChunkResponse(resp *http.Response, r chunkRange, expectedETag, expectedLastModified string) error {
	if resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("expected 206, got %d", resp.StatusCode)
	}

	cr := resp.Header.Get("Content-Range")
	if cr == "" {
		return fmt.Errorf("missing Content-Range header")
	}

	// Content-Range format: bytes start-end/total
	expectedCR := fmt.Sprintf("bytes %d-%d/", r.start, r.end)
	if !strings.HasPrefix(cr, expectedCR) {
		return fmt.Errorf("Content-Range mismatch: got %q, expected prefix %q", cr, expectedCR)
	}

	// Verify resource identity — prevents mixed content if a CDN
	// serves a different version during domain fallback.
	if expectedETag != "" {
		gotETag := resp.Header.Get("ETag")
		if gotETag != "" && gotETag != expectedETag {
			return fmt.Errorf("ETag mismatch: got %q, expected %q", gotETag, expectedETag)
		}
	}
	if expectedLastModified != "" {
		gotLM := resp.Header.Get("Last-Modified")
		if gotLM != "" && gotLM != expectedLastModified {
			return fmt.Errorf("Last-Modified mismatch: got %q, expected %q", gotLM, expectedLastModified)
		}
	}

	return nil
}
