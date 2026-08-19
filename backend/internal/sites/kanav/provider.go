package kanav

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/sites/universal"
	"backend/internal/stealth"
)

var providerLogger = infra.NewLogger("KanavProvider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces
// for the KanAV video streaming site. Although KanAV is a video-type site
// (module.type == "video"), the provider implements GallerySiteProvider
// because it needs ScrapeGallery/ScrapeGalleryHTTP methods for M3U8 URL
// sniffing via the universal scraper. The TaskCreate handler's pre-processor
// checks the module type field to ensure KanAV URLs are routed to the video
// download pipeline, not the gallery pipeline.
type Provider struct {
	dataStore       sites.SiteDataStore
	blocklist       sites.BlocklistChecker
	domains         []string
	baseURL         string
	categoryConfigs []CategoryConfig
	domainPool      *stealth.DomainPool
}

// NewProvider creates a KanAV provider with the given data store
// and blocklist checker, pre-loading all site data from the unified
// configuration.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore:       dataStore,
		blocklist:       blocklist,
		categoryConfigs: CategoryConfigs,
	}

	if mod, ok := dataStore.GetModuleConfig("kanav"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}

	// Initialize shared domain pool for automatic load-balanced domain discovery
	publisherURL := dataStore.GetPublisherURL("kanav")
	p.domainPool = stealth.NewDomainPool("kanav", p.domains, publisherURL)
	stealth.RegisterDomainPool("kanav", p.domainPool)

	return p
}

// SiteID returns the unique identifier for this provider.
func (p *Provider) SiteID() string { return "kanav" }

// CanHandle checks if the given URL belongs to the KanAV site.
func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("kanav", rawURL)
}

// ScrapeGallery scrapes a video detail page using the browser-based
// scraper with M3U8 sniffing capabilities.
func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	// For video sites, we use the universal M3U8 scraper
	return p.scrapeWithUniversal(ctx, pageURL)
}

// scrapeWithUniversal uses the universal scraper for M3U8 detection.
func (p *Provider) scrapeWithUniversal(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	// Import universal scraper
	result, err := universal.ScrapePage(ctx, pageURL)
	if err != nil {
		providerLogger.Warn("Universal scrape failed, trying headful fallback",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		// Fallback to headful browser
		result, err = universal.ScrapePageHeadful(ctx, pageURL)
		if err != nil {
			return nil, fmt.Errorf("headful scrape also failed: %w", err)
		}
	}

	// Convert ScrapeResult to GalleryScrapeResult
	galleryResult := &sites.GalleryScrapeResult{
		SourceURL: pageURL,
		Title:     result.Title,
		Tags:      result.Tags,
		Category:  strings.Join(result.Categories, ", "),
		VideoCount: 1,
	}

	// Add M3U8 URL as video item.
	// Decode MacCMS-encoded URLs at the provider layer so that
	// gallery_videos.url always stores the actual HTTP(S) URL.
	// MacCMS encodes M3U8 URLs as base64(url_encode(actual_url)).
	if result.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: universal.DecodeMacCMSURL(result.M3U8URL)},
		}
	}

	// Add candidates if available
	if len(result.M3U8Candidates) > 0 {
		for _, cand := range result.M3U8Candidates {
			galleryResult.Videos = append(galleryResult.Videos, sites.GalleryVideoItem{
				URL: universal.DecodeMacCMSURL(cand.URL),
			})
		}
	}

	return galleryResult, nil
}

// ScrapeGalleryHTTP attempts to scrape via HTTP for listing pages.
// For KanAV detail pages, this will delegate to the browser scraper
// since M3U8 URLs require JavaScript execution.
func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	// Check if this is a listing page or detail page
	if p.IsListingPage(pageURL) {
		// For listing pages, use HTTP scraping
		return p.scrapeListingHTTP(ctx, pageURL)
	}

	// For detail pages, we need browser for M3U8
	providerLogger.Info("Detail page detected, delegating to browser scraper",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})
	return p.ScrapeGallery(ctx, pageURL)
}

// scrapeListingHTTP scrapes a listing page via HTTP.
func (p *Provider) scrapeListingHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeListingHTTP(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	// Convert listing result to gallery result format
	// This is used for batch enqueue from listing pages
	galleryResult := &sites.GalleryScrapeResult{
		SourceURL:  pageURL,
		Title:      fmt.Sprintf("KanAV Listing - %d videos", len(result.Videos)),
		VideoCount: len(result.Videos),
	}

	// Store video metadata in a custom field via description
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
	// Build search URL
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		searchURL = searchURL + "&page=" + fmt.Sprintf("%d", page)
	}

	// Scrape search results
	result, err := ScrapeListingHTTP(ctx, searchURL)
	if err != nil {
		return nil, err
	}

	// Convert to SiteSearchResult
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
func (p *Provider) BuildSearchURL(keyword string) string {
	encodedKeyword := url.QueryEscape(keyword)
	return p.baseURL + "/index.php/vod/search.html?wd=" + encodedKeyword + "&by=time_add"
}

// CleanTitle removes site-specific suffixes and prefixes from a title.
// Handles KanAV's combined suffix format: " - KanAV-免费高清中文AV在线看"
func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	// Remove KanAV combined suffix first (must be before individual suffixes)
	// Matches " - KanAV" followed by anything (including "-免费高清中文AV在线看")
	title = regexp.MustCompile(`\s*[-—丨]\s*KanAV.*$`).ReplaceAllString(title, "")

	// Remove common suffixes (individual cases)
	suffixes := []string{
		"[中文字幕]",
		"[高清]",
		" - 在线观看",
	}

	for _, suffix := range suffixes {
		title = strings.TrimSuffix(title, suffix)
	}

	// Clean up whitespace
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")

	return strings.TrimSpace(title)
}

// CheckContentBlocked checks if the content should be blocked based on
// title, category, or protagonist.
func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	// Use the blocklist checker if available
	if p.blocklist != nil {
		fields := map[string]string{
			"title":       title,
			"category":    category,
			"protagonist": protagonist,
		}
		result, err := p.blocklist.CheckUserRules(context.Background(), "kanav", fields)
		if err == nil && result.Blocked {
			return result
		}
	}

	return sites.BlockCheckResult{Blocked: false}
}

// NormalizeURL normalizes a KanAV URL to a canonical form.
func (p *Provider) NormalizeURL(rawURL string) string {
	// Ensure HTTPS
	if strings.HasPrefix(rawURL, "http://") {
		rawURL = "https://" + rawURL[7:]
	}

	// Normalize domain to primary domain (use pool for dynamic list)
	for _, domain := range p.GetDomains() {
		if strings.Contains(rawURL, domain) {
			// Already using a valid domain
			return rawURL
		}
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
func (p *Provider) IsListingPage(url string) bool {
	// Listing pages contain:
	// - /vod/type/id/
	// - /vod/show/by/
	// - /vod/search.html
	// - /page/
	listingPatterns := []string{
		"/vod/type/id/",
		"/vod/show/by/",
		"/vod/search",
		"/label/",
	}

	for _, pattern := range listingPatterns {
		if strings.Contains(url, pattern) {
			return true
		}
	}

	return false
}

// GetCategoryConfig returns the category configuration by ID.
func (p *Provider) GetCategoryConfig(categoryID int) (CategoryConfig, bool) {
	return GetCategoryByID(categoryID)
}

// GetAllCategories returns all available category configurations.
func (p *Provider) GetAllCategories() []CategoryConfig {
	return p.categoryConfigs
}
