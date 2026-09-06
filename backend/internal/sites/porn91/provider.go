package porn91

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var providerLogger = infra.NewLogger("Porn91Provider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces
// for the 91porn.plus video streaming site. Although it is a video-type site
// (module.type == "video"), the provider implements GallerySiteProvider
// because it needs ScrapeGallery/ScrapeGalleryHTTP methods for M3U8 URL
// extraction. The TaskCreate handler's pre-processor checks the module type
// field to ensure 91porn URLs are routed to the video download pipeline.
//
// Key difference from KanAV: 91porn.plus embeds the M3U8 URL directly in
// Schema.org JSON-LD structured data within the HTML, so the primary scraping
// strategy is HTTP-first (no browser needed). Browser fallback is used only
// when the JSON-LD is absent or the page requires JavaScript rendering.
type Provider struct {
	dataStore  sites.SiteDataStore
	blocklist  sites.BlocklistChecker
	domains    []string
	baseURL    string
	domainPool *stealth.DomainPool
}

// NewProvider creates a 91porn.plus provider with the given data store
// and blocklist checker, pre-loading all site data from the unified
// configuration.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore: dataStore,
		blocklist: blocklist,
	}

	if mod, ok := dataStore.GetModuleConfig("91porn"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}

	// Initialize shared domain pool for automatic load-balanced domain discovery.
	publisherURL := dataStore.GetPublisherURL("91porn")
	p.domainPool = stealth.NewDomainPool("91porn", p.domains, publisherURL)
	stealth.RegisterDomainPool("91porn", p.domainPool)

	return p
}

// SiteID returns the unique identifier for this provider.
func (p *Provider) SiteID() string { return "91porn" }

// CanHandle checks if the given URL belongs to the 91porn.plus site.
func (p *Provider) CanHandle(rawURL string) bool {
	if p.dataStore.CanHandle("91porn", rawURL) {
		return true
	}
	// Also check dynamically discovered domains.
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

// ScrapeGallery scrapes a video detail page using HTTP-first strategy.
// For 91porn.plus, the M3U8 URL is embedded in JSON-LD structured data
// and can be extracted without browser execution.
func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return p.scrapeDetail(ctx, pageURL)
}

// ScrapeGalleryHTTP attempts to scrape via HTTP for both listing and detail pages.
// For 91porn.plus, HTTP is the primary strategy since JSON-LD is server-rendered.
func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	if p.IsListingPage(pageURL) {
		return p.scrapeListing(ctx, pageURL)
	}
	return p.scrapeDetail(ctx, pageURL)
}

// scrapeDetail scrapes a video detail page and returns a GalleryScrapeResult
// with the M3U8 URL and metadata extracted from JSON-LD.
func (p *Provider) scrapeDetail(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	detail, err := ScrapeDetailHTTP(ctx, pageURL)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed for detail page",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return nil, fmt.Errorf("detail page scrape failed: %w", err)
	}

	galleryResult := &sites.GalleryScrapeResult{
		SourceURL:   pageURL,
		Title:       detail.Title,
		Description: detail.Description,
		CoverURL:   detail.ThumbnailURL,
		PublishTime: detail.PublishDate,
		VideoCount:  1,
	}

	// Add M3U8 URL as video item.
	if detail.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: detail.M3U8URL},
		}
	}

	providerLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"m3u8Found": detail.M3U8URL != "",
			"title":     detail.Title,
			"author":    detail.Author,
			"views":     detail.Views,
		}})

	return galleryResult, nil
}

// scrapeListing scrapes a listing page and returns video URLs for batch enqueue.
func (p *Provider) scrapeListing(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeListingHTTP(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	galleryResult := &sites.GalleryScrapeResult{
		SourceURL:  pageURL,
		Title:      fmt.Sprintf("91Porn Listing - %d videos", len(result.Videos)),
		VideoCount: len(result.Videos),
	}

	// Store video page URLs in description for batch enqueue.
	var videoURLs []string
	for _, v := range result.Videos {
		videoURLs = append(videoURLs, v.PageURL)
	}
	galleryResult.Description = strings.Join(videoURLs, "\n")

	return galleryResult, nil
}

// ScrapeListing scrapes a listing page and returns structured video metadata.
// This is an extension to the standard SiteProvider interface for video sites.
func (p *Provider) ScrapeListing(ctx context.Context, listingURL string) (*ListingPageResult, error) {
	return ScrapeListingHTTP(ctx, listingURL)
}

// Search performs a site-wide search for videos.
func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		searchURL = fmt.Sprintf("%s/%d", searchURL, page)
	}

	result, err := ScrapeListingHTTP(ctx, searchURL)
	if err != nil {
		return nil, err
	}

	var searchResults []sites.SiteSearchResult
	for _, v := range result.Videos {
		searchResults = append(searchResults, sites.SiteSearchResult{
			URL:      v.PageURL,
			Title:    v.Title,
			CoverURL: v.ThumbnailURL,
			Date:     v.PublishDate,
		})
	}

	return searchResults, nil
}

// BuildSearchURL constructs a search URL for the given keyword.
// 91porn.plus search URL format: /search/{keyword}
func (p *Provider) BuildSearchURL(keyword string) string {
	return p.baseURL + "/search/" + keyword
}

// CleanTitle removes site-specific suffixes and prefixes from a title.
func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	// Remove 91Porn suffix.
	suffixes := []string{
		" - 91Porn",
		" - 91短视频",
		" - 在线观看",
	}

	for _, suffix := range suffixes {
		title = strings.TrimSuffix(title, suffix)
	}

	// Clean up whitespace.
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")

	return strings.TrimSpace(title)
}

// CheckContentBlocked checks if the content should be blocked based on
// title, category, or protagonist.
func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	if p.blocklist != nil {
		fields := map[string]string{
			"title":       title,
			"category":    category,
			"protagonist": protagonist,
		}
		result, err := p.blocklist.CheckUserRules(context.Background(), "91porn", fields)
		if err == nil && result.Blocked {
			return result
		}
	}

	return sites.BlockCheckResult{Blocked: false}
}

// NormalizeURL normalizes a 91porn.plus URL to a canonical form.
func (p *Provider) NormalizeURL(rawURL string) string {
	// Ensure HTTPS.
	if strings.HasPrefix(rawURL, "http://") {
		rawURL = "https://" + rawURL[7:]
	}
	return rawURL
}

// GetDomains returns the merged domain list (static + dynamically discovered).
func (p *Provider) GetDomains() []string {
	if p.domainPool != nil {
		return p.domainPool.GetDomains()
	}
	return p.domains
}

// IsListingPage checks if the URL is a listing page (category/sort/search)
// rather than a detail page.
func (p *Provider) IsListingPage(rawURL string) bool {
	// Detail pages contain /video/{id}
	if strings.Contains(rawURL, "/video/") {
		return false
	}

	// Listing pages contain:
	// - /category/
	// - /search/
	// - /tag/
	// - homepage (no path or just /)
	listingPatterns := []string{
		"/category/",
		"/search/",
		"/tag/",
		"/top/",
		"/latest",
		"/hottest",
	}

	for _, pattern := range listingPatterns {
		if strings.Contains(rawURL, pattern) {
			return true
		}
	}

	// Homepage check.
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	path := strings.Trim(parsed.Path, "/")
	return path == ""
}
