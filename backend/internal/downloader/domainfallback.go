package downloader

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var fallbackLogger = infra.NewLogger("DownloadManager")

type DownloadOptions struct {
	Headers map[string]string
	Timeout time.Duration
	Atomic  bool
	Referer string
	// MultiThread enables Range-based parallel download when the server
	// supports it. When false (default), single-thread download is used.
	MultiThread bool
	// Concurrency controls the number of parallel chunk workers.
	// Clamped to 2-8 at runtime; default 4.
	Concurrency int
	// MaxSpeed limits aggregate download speed (bytes/sec) for a single
	// file across all workers. 0 means unlimited.
	MaxSpeed int64
	// MinFileSize is the threshold below which multi-thread download
	// is skipped (not worth the overhead). Default 1 MB.
	MinFileSize int64
}

// DownloadDefaults carries runtime download configuration from the
// orchestrator, avoiding a direct dependency on the config package.
type DownloadDefaults struct {
	MultiThread bool
	Concurrency int
	MaxSpeed    int64
	MinFileSize int64
	// GalleryImageConcurrent limits simultaneous image downloads
	// within a gallery batch. 0 falls back to a sensible default.
	GalleryImageConcurrent int
	// VideoMaxConcurrent limits simultaneous video downloads within
	// a gallery batch. 0 falls back to a sensible default.
	VideoMaxConcurrent int
	// TSegmentConcurrent limits concurrent TS segment downloads within
	// a single gallery-embedded M3U8 stream (ts_segment_concurrent).
	// 0 falls back to a sensible default.
	TSegmentConcurrent int
	// GPUTranscode enables hardware-accelerated TS→MP4 merge/transcode for
	// gallery-embedded videos. Mirrors the independent video pipeline's
	// gpu_transcode setting so the two channels stay consistent. When true
	// but no compatible GPU is present, the merge falls back to CPU.
	GPUTranscode bool
	// ForceGPUType overrides the auto-detected GPU encoder type ("" = auto).
	ForceGPUType string
}

// ApplyTo merges the defaults into an existing DownloadOptions,
// filling in multi-thread fields without overriding caller-set
// Headers, Timeout, Atomic, or Referer.
func (d DownloadDefaults) ApplyTo(opts *DownloadOptions) *DownloadOptions {
	if opts == nil {
		opts = &DownloadOptions{}
	}
	opts.MultiThread = d.MultiThread
	opts.Concurrency = d.Concurrency
	opts.MaxSpeed = d.MaxSpeed
	opts.MinFileSize = d.MinFileSize
	return opts
}

// DownloadResult reports the outcome of a file download attempt.
type DownloadResult struct {
	Success   bool
	FileSize  int64
	SavedPath string
	Error     error

	// ExpectedSize is the Content-Length the server declared for the
	// response, or 0 when the server sent none (chunked encoding). When > 0
	// it lets callers verify the transfer was complete instead of trusting a
	// merely-successful write: a connection dropped mid-body still yields a
	// non-zero FileSize, so Size()>0 alone cannot detect truncation.
	ExpectedSize int64
}

// DownloadFile fetches a file and stores it at filePath, applying stealth
// headers and writing through a temp file when opts.Atomic is set. When
// opts.MultiThread is set and the server supports Range requests, the body
// is fetched as parallel chunks; an unsupported Range capability, a size
// below opts.MinFileSize, or any chunk failure falls back to single-thread
// download with identical return semantics.
func DownloadFile(ctx context.Context, url, filePath string, opts *DownloadOptions) *DownloadResult {
	if ctx == nil {
		ctx = context.Background()
	}
	if opts == nil {
		opts = &DownloadOptions{}
	}

	// A file occupies one in-flight slot regardless of its internal
	// worker count, so the cap bounds aggregate HTTP pressure.
	release, err := AcquireGlobalDownloadCtx(ctx)
	if err != nil {
		return &DownloadResult{Success: false, Error: err}
	}
	defer release()

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	// Any failure inside the multi-thread path returns a nil result to
	// request the single-thread fallback.
	if opts.MultiThread {
		probe, err := probeRangeSupport(ctx, url, opts, timeout)
		if err == nil && probe.supportsRange && probe.totalSize > 0 {
			mtResult := downloadFileMultiThread(ctx, url, filePath, opts, probe.totalSize, probe.etag, probe.lastModified)
			if mtResult != nil {
				return mtResult
			}
		}
	}

	return downloadFileSingleThread(ctx, url, filePath, opts, timeout)
}

func downloadFileSingleThread(ctx context.Context, url, filePath string, opts *DownloadOptions, timeout time.Duration) *DownloadResult {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, opts.Referer)
	for k, v := range opts.Headers {
		headers.Set(k, v)
	}
	headers.Del("Accept-Encoding")

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return &DownloadResult{Success: false, Error: err}
	}
	req.Header = headers

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return &DownloadResult{Success: false, Error: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return &DownloadResult{Success: false, Error: fmt.Errorf("HTTP %d", resp.StatusCode)}
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return &DownloadResult{Success: false, Error: err}
	}

	writePath := filePath
	if opts.Atomic {
		writePath = filePath + ".tmp"
	}

	out, err := os.Create(writePath)
	if err != nil {
		return &DownloadResult{Success: false, Error: err}
	}

	// Count real throughput: network bytes off the response body, disk
	// bytes at the file writer (io.Copy reads before writing, so both
	// counters advance live during the transfer). The wrappers implement
	// neither ReaderFrom nor WriterTo, so CopyBuffer always goes through
	// the provided buffer instead of a bypass fast path.
	netR := &infra.CountingReader{R: resp.Body}
	diskW := &infra.CountingWriter{W: out}
	written, err := io.CopyBuffer(diskW, netR, make([]byte, 256*1024))
	out.Close()
	if err != nil {
		os.Remove(writePath)
		return &DownloadResult{Success: false, Error: err}
	}

	if opts.Atomic {
		if err := os.Rename(writePath, filePath); err != nil {
			os.Remove(writePath)
			return &DownloadResult{Success: false, Error: err}
		}
	}

	return &DownloadResult{
		Success:      true,
		FileSize:     written,
		SavedPath:    filePath,
		ExpectedSize: declaredSize(resp),
	}
}

// declaredSize returns the response's advertised body length, or 0 when the
// server omitted it. A negative Content-Length (legal for some responses) is
// normalized to 0 so callers treat it as "unknown" rather than as a mismatch.
func declaredSize(resp *http.Response) int64 {
	if resp == nil || resp.ContentLength <= 0 {
		return 0
	}
	return resp.ContentLength
}

// DownloadFileWithDomainFallback downloads a file, retrying against mirror
// domains when the original URL fails with a network error or non-200
// response. Every attempt reports its latency and outcome to the domain
// health tracker, so failover ranking adapts to observed conditions.
func DownloadFileWithDomainFallback(ctx context.Context, url, filePath string, opts *DownloadOptions) *DownloadResult {
	if ctx == nil {
		ctx = context.Background()
	}
	tracker := stealth.GetDomainHealthTracker()
	origin := ExtractDomain(url)

	started := time.Now()
	result := DownloadFile(ctx, url, filePath, opts)
	if result.Success {
		tracker.ReportOutcome(origin, time.Since(started), nil)
		return result
	}
	if ctx.Err() != nil {
		return result
	}
	tracker.ReportOutcome(origin, time.Since(started), result.Error)

	fallbackURLs := GenerateMirrorURLs(url)
	originalDomain := origin
	if ctx.Err() != nil {
		return result
	}

	// A slow or saturated mirror ranks below a fresher one without
	// requiring any configuration change.
	orderedDomains := orderDomainsByHealth(fallbackURLs)

	for _, fallbackURL := range orderedDomains {
		fbDomain := ExtractDomain(fallbackURL)
		if fbDomain == originalDomain {
			continue
		}
		fallbackLogger.Debug("Trying mirror domain for download",
			infra.LogContext{Extra: map[string]any{
				"original": originalDomain,
				"mirror":   fbDomain,
			}})

		mirrorStarted := time.Now()
		fallbackResult := DownloadFile(ctx, fallbackURL, filePath, opts)
		mirrorRtt := time.Since(mirrorStarted)
		if fallbackResult.Success {
			tracker.ReportOutcome(fbDomain, mirrorRtt, nil)
			return fallbackResult
		}
		tracker.ReportOutcome(fbDomain, mirrorRtt, fallbackResult.Error)
	}

	return result
}

func FetchText(ctx context.Context, url string, headers map[string]string) (string, error) {
	profile := stealth.RandomProfile()
	hdr := stealth.BuildStealthHeaders(profile, "")
	for k, v := range headers {
		hdr.Set(k, v)
	}
	hdr.Del("Accept-Encoding")

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header = hdr

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		// A media CDN answers 410 for two unrelated causes; the body is the
		// only signal separating an expired signed URL from a bot rejection,
		// so report which one it is instead of a bare status code.
		reason := stealth.ClassifyMediaRejection(resp.StatusCode, peekBody(resp.Body))
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, reason)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

// peekBody reads a bounded prefix of a response body for classification
// without consuming what the caller may still need.
func peekBody(r io.Reader) []byte {
	buf := make([]byte, 256)
	n, _ := io.ReadFull(r, buf)
	return buf[:n]
}

func FetchTextWithDomainFallback(ctx context.Context, url string, headers map[string]string) (string, error) {
	tracker := stealth.GetDomainHealthTracker()
	origin := ExtractDomain(url)

	started := time.Now()
	text, err := FetchText(ctx, url, headers)
	if err == nil {
		tracker.ReportOutcome(origin, time.Since(started), nil)
		return text, nil
	}
	tracker.ReportOutcome(origin, time.Since(started), err)

	fallbackURLs := GenerateMirrorURLs(url)
	originalDomain := origin

	var lastErr error = err

	orderedDomains := orderDomainsByHealth(fallbackURLs)

	for _, fallbackURL := range orderedDomains {
		fbDomain := ExtractDomain(fallbackURL)
		if fbDomain == originalDomain {
			continue
		}

		mirrorStarted := time.Now()
		text, err := FetchText(ctx, fallbackURL, headers)
		mirrorRtt := time.Since(mirrorStarted)
		if err == nil {
			tracker.ReportOutcome(fbDomain, mirrorRtt, nil)
			return text, nil
		}
		tracker.ReportOutcome(fbDomain, mirrorRtt, err)
		lastErr = err
	}

	return "", lastErr
}

func orderDomainsByHealth(urls []string) []string {
	// Keep the first URL per domain so the returned entries are
	// directly usable for requests.
	domainURLs := make(map[string]string)
	var domainList []string
	for _, u := range urls {
		d := ExtractDomain(u)
		if d == "" {
			continue
		}
		if _, exists := domainURLs[d]; !exists {
			domainURLs[d] = u
			domainList = append(domainList, d)
		}
	}

	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(domainList)

	result := make([]string, 0, len(orderedDomains))
	for _, d := range orderedDomains {
		if u, ok := domainURLs[d]; ok {
			result = append(result, u)
		}
	}
	return result
}

func GenerateMirrorURLs(rawURL string) []string {
	domain := ExtractDomain(rawURL)
	if domain == "" {
		return []string{rawURL}
	}

	mirrors := GetMirrorDomains(domain)
	if len(mirrors) == 0 {
		return []string{rawURL}
	}

	result := make([]string, 0, len(mirrors)+1)
	result = append(result, rawURL)
	for _, mirror := range mirrors {
		result = append(result, mirror+rawURL[len(domain):])
	}
	return result
}

func ExtractDomain(rawURL string) string {
	idx := strings.Index(rawURL, "://")
	if idx < 0 {
		return ""
	}
	rest := rawURL[idx+3:]
	slashIdx := strings.IndexByte(rest, '/')
	if slashIdx >= 0 {
		return rawURL[:idx+3+slashIdx]
	}
	return rawURL
}

var (
	mirrorOnce      sync.Once
	mirrorDomainMap map[string][]string
)

func buildMirrorDomainMap() {
	ds := sites.GetSiteDataStore()
	mirrorDomainMap = make(map[string][]string)
	for _, mod := range ds.GetAllModuleConfigs() {
		// The pool can contribute domains absent from the static config.
		domains := mod.Domains
		if pooled := stealth.DomainsForSite(mod.ID); len(pooled) > len(domains) {
			domains = pooled
		}
		for _, d := range domains {
			var mirrors []string
			for _, other := range domains {
				if other != d {
					mirrors = append(mirrors, other)
				}
			}
			if len(mirrors) > 0 {
				mirrorDomainMap[d] = mirrors
			}
		}
	}
}

// GetMirrorDomains returns the known mirror domains for a primary domain.
// Sources are the unified SiteDataStore and the dynamic domain pool, so a
// mirror learned at runtime becomes usable for failover without a restart.
func GetMirrorDomains(domain string) []string {
	mirrorOnce.Do(buildMirrorDomainMap)
	return mirrorDomainMap[domain]
}

// SanitizeFilename replaces characters that are rejected in filesystem
// paths with underscores, keeping the remainder readable for display.
func SanitizeFilename(name string) string {
	if name == "" {
		return "untitled"
	}
	replacer := strings.NewReplacer(
		"\\", "_", "/", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_",
		"|", "_", "\n", "_", "\r", "_", "\t", "_",
	)
	return strings.TrimSpace(replacer.Replace(name))
}
