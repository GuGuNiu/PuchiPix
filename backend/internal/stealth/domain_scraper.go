package stealth

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// domainFetchTimeout is the HTTP timeout for fetching publisher pages.
const domainFetchTimeout = 30 * time.Second

// urlPattern matches http(s) URLs in text content.
var urlPattern = regexp.MustCompile(`https?://[^\s<>"']+`)

// DomainScraper provides shared HTML fetching and URL extraction utilities
// for dynamic domain discovery across all site providers.
type DomainScraper struct{}

// NewDomainScraper creates a DomainScraper instance.
func NewDomainScraper() *DomainScraper {
	return &DomainScraper{}
}

// FetchResult holds the result of fetching a publisher page.
type FetchResult struct {
	HTML        string
	StatusCode int
	Error       error
}

// FetchPublisherPage fetches a publisher page using stealth headers
// to mimic a real browser.
func (s *DomainScraper) FetchPublisherPage(publisherURL string) FetchResult {
	return s.FetchPublisherPageWithTimeout(publisherURL, domainFetchTimeout)
}

// FetchPublisherPageWithTimeout fetches a publisher page with a custom timeout.
func (s *DomainScraper) FetchPublisherPageWithTimeout(publisherURL string, timeout time.Duration) FetchResult {
	client := NewStealthClient(timeout)

	req, err := http.NewRequest("GET", publisherURL, nil)
	if err != nil {
		return FetchResult{Error: err}
	}

	profile := RandomProfile()
	headers := BuildStealthHeaders(profile, publisherURL)
	req.Header = headers
	// Remove Accept-Encoding so the HTTP transport can use gzip (which Go
	// supports) instead of zstd/br (which Go doesn't support natively).
	req.Header.Del("Accept-Encoding")

	resp, err := client.Do(req)
	if err != nil {
		return FetchResult{Error: err}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return FetchResult{StatusCode: resp.StatusCode, Error: err}
	}

	return FetchResult{
		HTML:        string(body),
		StatusCode: resp.StatusCode,
	}
}

// ExtractDomainsFromHTML parses HTML content and extracts all unique
// domain base URLs (scheme + host) from anchor href attributes and
// plain text URLs.
func (s *DomainScraper) ExtractDomainsFromHTML(html string) []string {
	domainSet := make(map[string]bool)

	// Parse HTML to extract href attributes from anchor tags
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err == nil {
		doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
			href, exists := s.Attr("href")
			if !exists || href == "" {
				return
			}
			if domain := NormalizeAndExtractDomain(href); domain != "" {
				domainSet[domain] = true
			}
		})
	}

	// Also extract URLs from plain text (catches URLs not in anchor tags)
	textMatches := urlPattern.FindAllString(html, -1)
	for _, match := range textMatches {
		if domain := NormalizeAndExtractDomain(match); domain != "" {
			domainSet[domain] = true
		}
	}

	// Convert set to slice
	domains := make([]string, 0, len(domainSet))
	for domain := range domainSet {
		domains = append(domains, domain)
	}
	return domains
}

// NormalizeAndExtractDomain extracts the scheme+host portion of a URL
// and normalizes it (lowercase host, removes default ports).
// Returns empty string for non-http(s) URLs or invalid URLs.
func NormalizeAndExtractDomain(rawURL string) string {
	if rawURL == "" {
		return ""
	}

	// Skip relative URLs, javascript:, mailto:, tel:, etc.
	lower := strings.ToLower(strings.TrimSpace(rawURL))
	if strings.HasPrefix(lower, "javascript:") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") ||
		strings.HasPrefix(lower, "#") ||
		strings.HasPrefix(lower, "/") {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return ""
	}

	return parsed.Scheme + "://" + host
}

// ExtractHostname extracts the hostname from a URL string.
func ExtractHostname(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}
