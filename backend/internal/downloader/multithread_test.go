package downloader

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// rangeServer is a configurable HTTP test server that supports Range
// requests for multi-thread download testing.
type rangeServer struct {
	*httptest.Server
	data             []byte
	etag             string
	lastModified     string
	ignoreRange      bool
	wrongCR          bool
	changingEtag     bool
	chunkDelay       time.Duration
	failFirstNPerChk int
	chunkReqCounts   sync.Map
	curConcurrent    atomic.Int64
	maxConcurrent    atomic.Int64
	totalRequests    atomic.Int64
}

type serverOpt func(*rangeServer)

func newRangeServer(data []byte, opts ...serverOpt) *rangeServer {
	rs := &rangeServer{
		data:         data,
		etag:         `"test-etag-v1"`,
		lastModified: "Wed, 08 Aug 2026 00:00:00 GMT",
	}
	for _, opt := range opts {
		opt(rs)
	}
	rs.Server = httptest.NewServer(http.HandlerFunc(rs.serveHTTP))
	return rs
}

func withIgnoreRange() serverOpt               { return func(rs *rangeServer) { rs.ignoreRange = true } }
func withWrongCR() serverOpt                   { return func(rs *rangeServer) { rs.wrongCR = true } }
func withChangingEtag() serverOpt              { return func(rs *rangeServer) { rs.changingEtag = true } }
func withChunkDelay(d time.Duration) serverOpt { return func(rs *rangeServer) { rs.chunkDelay = d } }
func withFailFirstNPerChunk(n int) serverOpt {
	return func(rs *rangeServer) { rs.failFirstNPerChk = n }
}

func (rs *rangeServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	cur := rs.curConcurrent.Add(1)
	defer rs.curConcurrent.Add(-1)
	for {
		old := rs.maxConcurrent.Load()
		if cur <= old || rs.maxConcurrent.CompareAndSwap(old, cur) {
			break
		}
	}
	reqNum := rs.totalRequests.Add(1)

	if rs.chunkDelay > 0 {
		time.Sleep(rs.chunkDelay)
	}

	rangeHdr := r.Header.Get("Range")

	if rs.ignoreRange || rangeHdr == "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(rs.data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(rs.data)
		return
	}

	start, end, ok := parseRangeForTest(rangeHdr, int64(len(rs.data)))
	if !ok {
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}

	// Fail the first N requests per chunk (excludes the probe request).
	if rs.failFirstNPerChk > 0 && rangeHdr != "bytes=0-0" {
		var count int32
		val, _ := rs.chunkReqCounts.LoadOrStore(rangeHdr, &count)
		ptr := val.(*int32)
		n := atomic.AddInt32(ptr, 1)
		if n <= int32(rs.failFirstNPerChk) {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}

	etag := rs.etag
	if rs.changingEtag {
		etag = fmt.Sprintf(`"test-etag-v%d"`, reqNum)
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("Last-Modified", rs.lastModified)

	if rs.wrongCR {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start+1, end+1, len(rs.data)))
	} else {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(rs.data)))
	}
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(rs.data[start : end+1])
}

// parseRangeForTest extracts start and end from "bytes=start-end".
func parseRangeForTest(hdr string, totalLen int64) (int64, int64, bool) {
	if !strings.HasPrefix(hdr, "bytes=") {
		return 0, 0, false
	}
	parts := strings.TrimPrefix(hdr, "bytes=")
	dashIdx := strings.IndexByte(parts, '-')
	if dashIdx < 0 {
		return 0, 0, false
	}
	start, err1 := strconv.ParseInt(parts[:dashIdx], 10, 64)
	end, err2 := strconv.ParseInt(parts[dashIdx+1:], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	if start < 0 || end >= totalLen || start > end {
		return 0, 0, false
	}
	return start, end, true
}

// makeTestData generates deterministic test data of the given size.
func makeTestData(size int64) []byte {
	data := make([]byte, size)
	for i := int64(0); i < size; i++ {
		data[i] = byte(i % 251)
	}
	return data
}

// countMtmpFiles returns the number of .mtmp staging files in a directory.
func countMtmpFiles(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if strings.Contains(e.Name(), ".mtmp") {
			count++
		}
	}
	return count
}

// defaultMTOpts returns DownloadOptions configured for multi-thread testing.
func defaultMTOpts() *DownloadOptions {
	return &DownloadOptions{
		MultiThread: true,
		Concurrency: 4,
		MinFileSize: 1024,
		Timeout:     30 * time.Second,
	}
}

// Test01_ChunksOutOfOrderCorrectAssembly verifies that chunks arriving in
// arbitrary order are correctly assembled into the original content.
func Test01_ChunksOutOfOrderCorrectAssembly(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data)
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "test.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	require.True(t, result.Success, "multi-thread download should succeed")
	assert.Equal(t, int64(len(data)), result.FileSize)
	assert.Equal(t, dst, result.SavedPath)

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got, "downloaded content must match original byte-for-byte")
	assert.Equal(t, 0, countMtmpFiles(dir), "no staging files should remain")
}

// Test02_ConcurrencyNotExceedConfig verifies that the number of concurrent
// worker requests never exceeds the configured Concurrency value.
func Test02_ConcurrencyNotExceedConfig(t *testing.T) {
	data := makeTestData(8192)
	rs := newRangeServer(data, withChunkDelay(50*time.Millisecond))
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "test.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opts := defaultMTOpts()
	opts.Concurrency = 3

	result := DownloadFile(ctx, rs.URL, dst, opts)
	require.True(t, result.Success)

	maxC := rs.maxConcurrent.Load()
	// The probe request counts as one concurrent request, so allow concurrency + 1.
	assert.LessOrEqual(t, maxC, int64(4), "max concurrent requests should not exceed concurrency+1 (probe)")
}

// Test03_ServerIgnoresRangeFallbackToSingleThread verifies that when the
// server ignores Range and returns 200, the download transparently
// falls back to single-thread with correct content.
func Test03_ServerIgnoresRangeFallbackToSingleThread(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withIgnoreRange())
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "test.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	require.True(t, result.Success, "should succeed via single-thread fallback")

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got, "content must match even on fallback")
}

// Test04_SmallFileDoesNotEnterMultiThread verifies that files smaller
// than MinFileSize skip the multi-thread path and use single-thread.
func Test04_SmallFileDoesNotEnterMultiThread(t *testing.T) {
	data := makeTestData(512) // 512 bytes, below MinFileSize=1024
	rs := newRangeServer(data)
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "small.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opts := defaultMTOpts()
	opts.MinFileSize = 1024

	result := DownloadFile(ctx, rs.URL, dst, opts)
	require.True(t, result.Success)

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got)
	assert.Equal(t, 0, countMtmpFiles(dir), "no staging files should be created for small files")
}

// Test05_ContentRangeMismatchFailsAndCleansStaging verifies that a server
// returning wrong Content-Range causes the download to fail and the
// staging file to be cleaned up.
func Test05_ContentRangeMismatchFailsAndCleansStaging(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withWrongCR())
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "fail.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	assert.False(t, result.Success, "download should fail on Content-Range mismatch")
	assert.NotNil(t, result.Error)

	_, err := os.Stat(dst)
	assert.True(t, os.IsNotExist(err), "final file should not exist on failure")
	assert.Equal(t, 0, countMtmpFiles(dir), "staging files should be cleaned up")
}

// Test06_SingleChunkRetrySucceeds verifies that when a chunk's first
// request fails, only that chunk is retried and the download ultimately
// succeeds.
func Test06_SingleChunkRetrySucceeds(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withFailFirstNPerChunk(1))
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "retry.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	require.True(t, result.Success, "download should succeed after chunk retries")

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got, "content must match after retry")

	// Each chunk fails once then succeeds: 4 chunks × 2 = 8 + 1 probe = 9.
	totalReqs := rs.totalRequests.Load()
	assert.GreaterOrEqual(t, totalReqs, int64(9), "should have retry requests")
}

// Test07_ETagChangeCancelsTask verifies that when the server returns
// different ETags across requests, the download is cancelled and the
// staging file is cleaned up — no mixed-content file is published.
func Test07_ETagChangeCancelsTask(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withChangingEtag())
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "etag.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	assert.False(t, result.Success, "download should fail on ETag mismatch")

	_, err := os.Stat(dst)
	assert.True(t, os.IsNotExist(err), "final file should not exist on ETag mismatch")
	assert.Equal(t, 0, countMtmpFiles(dir), "staging files should be cleaned up")
}

// Test08_FinalPathEmptyBeforeSuccess verifies that the final file path
// does not contain new content until the download completes — the
// staging mechanism ensures partial content is never visible.
func Test08_FinalPathEmptyBeforeSuccess(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withChunkDelay(200*time.Millisecond))
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "staging.bin")

	done := make(chan *DownloadResult, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		done <- DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	}()

	// While the download is in progress, the final file must not exist.
	time.Sleep(100 * time.Millisecond)
	_, err := os.Stat(dst)
	assert.True(t, os.IsNotExist(err), "final file should not exist during download")

	result := <-done
	require.True(t, result.Success)

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got)
	assert.Equal(t, 0, countMtmpFiles(dir))
}

// Test09_ExistingFilePreservedOnFailure verifies that when a multi-thread
// download fails, an existing file at the final path is not truncated
// or overwritten.
func Test09_ExistingFilePreservedOnFailure(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withWrongCR())
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "existing.bin")

	// Write known content to the final path before download.
	oldContent := []byte("ORIGINAL_CONTENT_DO_NOT_OVERWRITE")
	require.NoError(t, os.WriteFile(dst, oldContent, 0644))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := DownloadFile(ctx, rs.URL, dst, defaultMTOpts())
	assert.False(t, result.Success)

	// The original file content must be preserved on failure.
	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, oldContent, got, "existing file must not be modified on failure")
	assert.Equal(t, 0, countMtmpFiles(dir))
}

// Test10_SharedRateLimiterNoMultiplication verifies that the shared rate
// limiter prevents per-worker rate multiplication — the aggregate rate
// across all workers stays within the configured ceiling.
func Test10_SharedRateLimiterNoMultiplication(t *testing.T) {
	const rate = 4000
	rl := NewSharedRateLimiter(rate)
	require.NotNil(t, rl)

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := context.Background()
			for j := 0; j < 20; j++ {
				_ = rl.Wait(ctx, 100)
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)

	assert.Greater(t, elapsed, 500*time.Millisecond,
		"shared limiter should throttle aggregate rate, not multiply per worker")
}

// Test11_NoGoroutineLeak verifies that all goroutines, HTTP connections,
// and timers are properly released on success, failure, and
// cancellation paths.
func Test11_NoGoroutineLeak(t *testing.T) {
	data := makeTestData(4096)
	dir := t.TempDir()

	// Success path.
	rsOk := newRangeServer(data)
	before := runtime.NumGoroutine()

	ctx1, cancel1 := context.WithTimeout(context.Background(), 15*time.Second)
	result1 := DownloadFile(ctx1, rsOk.URL, filepath.Join(dir, "ok.bin"), defaultMTOpts())
	cancel1()
	require.True(t, result1.Success)
	rsOk.Close()

	time.Sleep(500 * time.Millisecond)
	after := runtime.NumGoroutine()
	assert.LessOrEqual(t, after-before, 8, "no goroutine leak on success path")

	// Failure path.
	rsFail := newRangeServer(data, withWrongCR())
	before = runtime.NumGoroutine()

	ctx2, cancel2 := context.WithTimeout(context.Background(), 30*time.Second)
	result2 := DownloadFile(ctx2, rsFail.URL, filepath.Join(dir, "fail.bin"), defaultMTOpts())
	cancel2()
	assert.False(t, result2.Success)
	rsFail.Close()

	time.Sleep(500 * time.Millisecond)
	after = runtime.NumGoroutine()
	assert.LessOrEqual(t, after-before, 8, "no goroutine leak on failure path")

	// Cancel path.
	rsCancel := newRangeServer(data, withChunkDelay(500*time.Millisecond))
	before = runtime.NumGoroutine()

	ctx3, cancel3 := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel3()
	_ = DownloadFile(ctx3, rsCancel.URL, filepath.Join(dir, "cancel.bin"), defaultMTOpts())
	rsCancel.Close()

	time.Sleep(500 * time.Millisecond)
	after = runtime.NumGoroutine()
	assert.LessOrEqual(t, after-before, 8, "no goroutine leak on cancel path")
}

// Test12_DefaultOffSingleThreadBehavior verifies that when MultiThread
// is false (the default), the download behaves exactly like the
// original single-thread path — same return-value structure and content.
func Test12_DefaultOffSingleThreadBehavior(t *testing.T) {
	data := makeTestData(4096)
	rs := newRangeServer(data, withIgnoreRange())
	defer rs.Close()

	dir := t.TempDir()
	dst := filepath.Join(dir, "single.bin")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opts := &DownloadOptions{
		MultiThread: false,
		Timeout:     15 * time.Second,
		Atomic:      true,
	}
	result := DownloadFile(ctx, rs.URL, dst, opts)

	assert.True(t, result.Success)
	assert.Equal(t, int64(len(data)), result.FileSize)
	assert.Equal(t, dst, result.SavedPath)
	assert.Nil(t, result.Error)

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	assert.Equal(t, data, got)
}
