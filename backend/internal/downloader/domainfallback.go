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

// DownloadOptions configures file download behavior including custom
// headers, timeout, and atomic write semantics.
type DownloadOptions struct {
	Headers  map[string]string
	Timeout  time.Duration
	Atomic   bool
	Referer  string
}

// DownloadResult reports the outcome of a file download attempt.
type DownloadResult struct {
	Success  bool
	FileSize int64
	SavedPath string
	Error    error
}

// DownloadFile fetches a file from the given URL and saves it to filePath,
// applying stealth headers and supporting atomic writes via temp files.
func DownloadFile(ctx context.Context, url, filePath string, opts *DownloadOptions) *DownloadResult {
	if opts == nil {
		opts = &DownloadOptions{}
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, opts.Referer)
	for k, v := range opts.Headers {
		headers.Set(k, v)
	}

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

	written, err := io.Copy(out, resp.Body)
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
		Success:   true,
		FileSize:  written,
		SavedPath: filePath,
	}
}

// DownloadFileWithDomainFallback downloads a file, trying mirror domains
// if the original URL fails due to network errors or non-200 responses.
// Domain health tracking prioritizes domains that have been recently
// successful and deprioritizes rate-limited domains, enabling adaptive
// failover when primary domains become unavailable.
func DownloadFileWithDomainFallback(ctx context.Context, url, filePath string, opts *DownloadOptions) *DownloadResult {
	result := DownloadFile(ctx, url, filePath, opts)
	if result.Success {
		stealth.GetDomainHealthTracker().MarkHealthy(ExtractDomain(url))
		return result
	}
	stealth.GetDomainHealthTracker().MarkRateLimited(ExtractDomain(url))

	fallbackURLs := GenerateMirrorURLs(url)
	originalDomain := ExtractDomain(url)

	// Use health-aware domain ordering: healthy domains first (shuffled
	// for load distribution), then cooling domains by ascending cooldown.
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

		fallbackResult := DownloadFile(ctx, fallbackURL, filePath, opts)
		if fallbackResult.Success {
			stealth.GetDomainHealthTracker().MarkHealthy(fbDomain)
			return fallbackResult
		}
		stealth.GetDomainHealthTracker().MarkRateLimited(fbDomain)
	}

	return result
}

// FetchText fetches text content from a URL with stealth headers and
// a configurable timeout, returning the response body as a string.
func FetchText(ctx context.Context, url string, headers map[string]string) (string, error) {
	profile := stealth.RandomProfile()
	hdr := stealth.BuildStealthHeaders(profile, "")
	for k, v := range headers {
		hdr.Set(k, v)
	}

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
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

// FetchTextWithDomainFallback fetches text content, trying mirror
// domains when the original URL fails. Domain health tracking
// prioritizes healthy domains and deprioritizes rate-limited ones.
func FetchTextWithDomainFallback(ctx context.Context, url string, headers map[string]string) (string, error) {
	text, err := FetchText(ctx, url, headers)
	if err == nil {
		stealth.GetDomainHealthTracker().MarkHealthy(ExtractDomain(url))
		return text, nil
	}
	stealth.GetDomainHealthTracker().MarkRateLimited(ExtractDomain(url))

	fallbackURLs := GenerateMirrorURLs(url)
	originalDomain := ExtractDomain(url)

	var lastErr error = err

	orderedDomains := orderDomainsByHealth(fallbackURLs)

	for _, fallbackURL := range orderedDomains {
		fbDomain := ExtractDomain(fallbackURL)
		if fbDomain == originalDomain {
			continue
		}

		text, err := FetchText(ctx, fallbackURL, headers)
		if err == nil {
			stealth.GetDomainHealthTracker().MarkHealthy(fbDomain)
			return text, nil
		}
		stealth.GetDomainHealthTracker().MarkRateLimited(fbDomain)
		lastErr = err
	}

	return "", lastErr
}

// orderDomainsByHealth extracts the unique domain set from a list of
// mirror URLs and returns them ordered by health: healthy domains
// first (shuffled), then cooling domains by ascending cooldown.
func orderDomainsByHealth(urls []string) []string {
	// Build unique domain list preserving order for consistent results.
	seen := make(map[string]bool)
	var domains []string
	for _, u := range urls {
		d := ExtractDomain(u)
		if d != "" && !seen[d] {
			seen[d] = true
			domains = append(domains, u) // keep full URL for direct use
		}
	}

	tracker := stealth.GetDomainHealthTracker()
	domainURLs := make(map[string]string)
	var domainList []string
	for _, u := range domains {
		d := ExtractDomain(u)
		if _, exists := domainURLs[d]; !exists {
			domainURLs[d] = u
			domainList = append(domainList, d)
		}
	}

	orderedDomains := tracker.GetAllDomainsOrdered(domainList)

	result := make([]string, 0, len(orderedDomains))
	for _, d := range orderedDomains {
		if u, ok := domainURLs[d]; ok {
			result = append(result, u)
		}
	}
	return result
}

// GenerateMirrorURLs produces alternative URLs by replacing the domain
// portion with known mirror domains for the same site.
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

// ExtractDomain returns the scheme://host portion of a URL.
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

// GetMirrorDomains returns known mirror domains for a given primary
// domain, dynamically built from the unified SiteDataStore so that
// any site with multiple configured domains automatically supports
// mirror-based failover without hardcoded entries.
var (
	mirrorOnce     sync.Once
	mirrorDomainMap map[string][]string
)

func buildMirrorDomainMap() {
	ds := sites.GetSiteDataStore()
	mirrorDomainMap = make(map[string][]string)
	for _, mod := range ds.GetAllModuleConfigs() {
		for _, d := range mod.Domains {
			var mirrors []string
			for _, other := range mod.Domains {
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

func GetMirrorDomains(domain string) []string {
	mirrorOnce.Do(buildMirrorDomainMap)
	return mirrorDomainMap[domain]
}

// SanitizeFilename replaces characters unsafe for filesystem paths
// with underscores, preserving readability for display purposes.
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
