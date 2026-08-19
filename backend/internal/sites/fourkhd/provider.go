package fourkhd

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/urlutil"
)

var providerLogger = infra.NewLogger("FourKHDProvider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces
// for the 4KHD gallery site.
type Provider struct {
	dataStore         sites.SiteDataStore
	blocklist         sites.BlocklistChecker
	domains           []string
	baseURL           string
	placeholder       string
	suffixPatterns    []*regexp.Regexp
	publisherPrefixes []string
	blockedKeywords   []string
	blockedCategories []string
	domainPool        *stealth.DomainPool
}

// NewProvider creates a 4KHD provider with the given data store
// and blocklist checker, pre-loading all site data from the unified
// configuration to eliminate runtime lookups in hot paths.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore: dataStore,
		blocklist: blocklist,
	}

	if mod, ok := dataStore.GetModuleConfig("fourkhd"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}
	p.placeholder = dataStore.GetPlaceholder("fourkhd")
	p.publisherPrefixes = dataStore.GetPublisherPrefixes("fourkhd")
	p.blockedKeywords = dataStore.GetBlockedKeywords("fourkhd")
	p.blockedCategories = dataStore.GetBlockedCategories("fourkhd")

	for _, patternStr := range dataStore.GetTitleSuffixPatterns("fourkhd") {
		if re, err := regexp.Compile(patternStr); err == nil {
			p.suffixPatterns = append(p.suffixPatterns, re)
		}
	}

	// Initialize shared domain pool for Automatic load-balanced domain discovery
	publisherURL := dataStore.GetPublisherURL("fourkhd")
	p.domainPool = stealth.NewDomainPool("fourkhd", p.domains, publisherURL)
	stealth.RegisterDomainPool("fourkhd", p.domainPool)

	return p
}

func (p *Provider) SiteID() string { return "fourkhd" }

func (p *Provider) CanHandle(rawURL string) bool {
	if p.dataStore.CanHandle("fourkhd", rawURL) {
		return true
	}
	// Also check dynamically discovered domains
	allDomains := p.GetDomains()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	for _, domain := range allDomains {
		d, err := url.Parse(domain)
		if err != nil {
			continue
		}
		targetHost := strings.ToLower(d.Hostname())
		if hostname == targetHost || strings.HasSuffix(hostname, "."+targetHost) {
			return true
		}
	}
	return false
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	// 4KHD uses Cloudflare cache HIT, so HTTP scraping is the primary path.
	// Browser fallback is not needed because:
	// 1. The Service Worker (scss.js) detects headless browsers and redirects to about:blank
	// 2. HTTP requests with proper headers always get full HTML from Cloudflare cache
	return ScrapeGalleryHTTP(ctx, pageURL, p)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL, p)
	if err != nil {
		if strings.Contains(err.Error(), "content blocked:") {
			providerLogger.Warn("Content blocked by blocklist, skipping fallback",
				infra.LogContext{Extra: map[string]any{
					"url":   pageURL,
					"error": err.Error(),
				}})
			return nil, err
		}
		providerLogger.Warn("HTTP scrape failed",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return nil, err
	}

	// Content quality check
	shouldFallback, reason := stealth.ShouldFallbackToBrowser(
		result.Title, result.ImageCount, result.VideoCount, result.PageCount)
	if shouldFallback {
		providerLogger.Info("HTTP scrape result suspicious, but browser fallback not available for 4KHD",
			infra.LogContext{Extra: map[string]any{
				"url":    pageURL,
				"reason": reason,
			}})
		// For 4KHD, we don't fall back to browser because the Service Worker
		// will redirect headless browsers to about:blank.
	}

	return result, nil
}

func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	allDomains := p.GetDomains()
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		searchURL = strings.TrimRight(searchURL, "/") + "/page/" + fmt.Sprintf("%d", page) + "/?s=" + query
	}

	domain := stealth.GetDomainHealthTracker().GetBestDomain(allDomains)
	tryURL := strings.Replace(searchURL, p.baseURL, domain, 1)

	result, err := fetchAndParseSearch(ctx, tryURL, domain)
	if err != nil || result.doc == nil {
		return nil, err
	}

	entries := ParseSearchResults(result.doc, searchURL)
	results := make([]sites.SiteSearchResult, 0, len(entries))
	for _, e := range entries {
		results = append(results, sites.SiteSearchResult{
			URL:      e.URL,
			Title:    e.Title,
			CoverURL: e.CoverURL,
			Date:     e.Date,
		})
	}
	return results, nil
}

func (p *Provider) BuildSearchURL(keyword string) string {
	domain := stealth.GetDomainHealthTracker().GetBestDomain(p.GetDomains())
	return domain + "/?s=" + url.QueryEscape(keyword)
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return cleanTitleImpl(rawTitle, p.suffixPatterns, p.publisherPrefixes)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return p.checkBlocked(title, category, protagonist)
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return urlutil.ReplaceDomain(rawURL, p.baseURL, p.GetDomains())
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/content/")
}

func (p *Provider) GetDomains() []string {
	if p.domainPool != nil {
		return p.domainPool.GetDomains()
	}
	return p.domains
}

func (p *Provider) GetDomainCacheInfo() (domainCount int, lastFetch time.Time, isExpired bool) {
	if p.domainPool != nil {
		return p.domainPool.GetCacheInfo()
	}
	return len(p.domains), time.Time{}, false
}

func (p *Provider) GetPlaceholder() string { return p.placeholder }

// ScrapeDeps implementation

func (p *Provider) ResolveURL(rawURL, domain string) string {
	if rawURL == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	if strings.HasPrefix(rawURL, "/") {
		base := domain
		if base == "" {
			base = p.baseURL
		}
		return strings.TrimRight(base, "/") + rawURL
	}
	return rawURL
}

func (p *Provider) ExtractProtagonist(title string, tags []string) string {
	return extractProtagonist(title)
}

func (p *Provider) ExtractDescription(title, protagonist string) string {
	return extractDescription(title, protagonist)
}

func (p *Provider) CheckBlockedAsync(ctx context.Context, title, category, protagonist string) (sites.BlockCheckResult, error) {
	defaultResult := p.checkBlocked(title, category, protagonist)
	if defaultResult.Blocked {
		return defaultResult, nil
	}

	if p.blocklist != nil {
		fields := map[string]string{
			"title":       title,
			"category":    category,
			"protagonist": protagonist,
		}
		return p.blocklist.CheckUserRules(ctx, "fourkhd", fields)
	}

	return sites.BlockCheckResult{Blocked: false}, nil
}

func (p *Provider) checkBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return sites.CheckBlockedDefault(
		title, category, protagonist,
		p.blockedKeywords, p.blockedCategories,
		p.dataStore.GetBlockedProtagonists("fourkhd"),
		p.dataStore.IsBlockedProtagonistsEnabled("fourkhd"),
	)
}

// cleanTitleImpl removes publisher prefixes and site suffix patterns.
func cleanTitleImpl(rawTitle string, suffixPatterns []*regexp.Regexp, prefixes []string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	// Remove [size-count] suffix
	title = titleSizePattern.ReplaceAllString(title, "")
	// Remove (size)(count) suffix
	title = regexp.MustCompile(`\(\d+(?:\.\d+)?(?:MB|GB)\)\(\d+photos\)$`).ReplaceAllString(title, "")
	// Remove site suffix
	title = regexp.MustCompile(`\s*[-–—]\s*4KHD\s*$`).ReplaceAllString(title, "")
	// Remove publisher prefixes
	for _, prefix := range prefixes {
		if strings.HasPrefix(title, prefix) {
			title = strings.TrimSpace(title[len(prefix):])
		}
	}
	// Remove configured suffix patterns
	for _, pattern := range suffixPatterns {
		title = pattern.ReplaceAllString(title, "")
	}
	return strings.TrimSpace(title)
}

// fetchAndParseSearch is a helper for search page fetching.
func fetchAndParseSearch(ctx context.Context, searchURL, domain string) (*fetchResult, error) {
	return fetchAndParse(ctx, searchURL, domain)
}
