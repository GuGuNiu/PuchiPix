package xvideos

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

var providerLogger = infra.NewLogger("XvideosProvider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces
// for the XVIDEOS.COM video streaming site.
//
// XVIDEOS embeds the HLS M3U8 URL and MP4 direct link directly in inline
// <script> tags via html5player API calls (setVideoHLS, setVideoUrlLow,
// setVideoUrlHigh). The primary scraping strategy is HTTP-first: a simple
// HTTP GET retrieves the page HTML, then regex patterns extract the video
// source URLs and metadata. No JavaScript execution or browser is needed.
//
// Token mechanism: The M3U8 and MP4 URLs contain an encrypted token and
// Unix timestamp that are server-generated on each page load. The token
// is valid for approximately 1 hour. The CDN allows cross-origin access
// (Access-Control-Allow-Origin: *), so no Referer or Cookie is required
// for downloading.
type Provider struct {
	dataStore  sites.SiteDataStore
	blocklist  sites.BlocklistChecker
	domains    []string
	baseURL    string
	domainPool *stealth.DomainPool
}

// NewProvider creates an XVIDEOS provider with the given data store
// and blocklist checker, pre-loading all site data from the unified
// configuration.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore: dataStore,
		blocklist: blocklist,
	}

	if mod, ok := dataStore.GetModuleConfig("xvideos"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}

	// Initialize shared domain pool for automatic load-balanced domain discovery.
	publisherURL := dataStore.GetPublisherURL("xvideos")
	p.domainPool = stealth.NewDomainPool("xvideos", p.domains, publisherURL)
	stealth.RegisterDomainPool("xvideos", p.domainPool)

	return p
}

// SiteID returns the unique identifier for this provider.
func (p *Provider) SiteID() string { return "xvideos" }

// CanHandle checks if the given URL belongs to the XVIDEOS site.
func (p *Provider) CanHandle(rawURL string) bool {
	if p.dataStore.CanHandle("xvideos", rawURL) {
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
// For XVIDEOS, the M3U8 URL is embedded in inline <script> tags and can
// be extracted without browser execution.
func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return p.scrapeDetail(ctx, pageURL)
}

// ScrapeGalleryHTTP attempts to scrape via HTTP for both listing and detail pages.
// For XVIDEOS, HTTP is the primary strategy since video sources are server-rendered.
func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	if p.IsListingPage(pageURL) {
		return p.scrapeListing(ctx, pageURL)
	}
	return p.scrapeDetail(ctx, pageURL)
}

// scrapeDetail scrapes a video detail page and returns a GalleryScrapeResult
// with the M3U8 URL and metadata extracted from inline scripts.
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
		CoverURL:    detail.ThumbnailURL,
		PublishTime: detail.PublishDate,
		VideoCount:  1,
		Tags:        detail.Tags,
	}

	// Add HLS M3U8 URL as the primary video source.
	if detail.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: detail.M3U8URL},
		}
	}

	// Also add MP4 direct link as a secondary source if available.
	if detail.MP4URL != "" {
		galleryResult.Videos = append(galleryResult.Videos, sites.GalleryVideoItem{
			URL: detail.MP4URL,
		})
	}

	// Set uploader as protagonist.
	if detail.Uploader != "" {
		galleryResult.Protagonist = detail.Uploader
	}

	providerLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":        pageURL,
			"m3u8Found":  detail.M3U8URL != "",
			"mp4Found":   detail.MP4URL != "",
			"title":      detail.Title,
			"uploader":   detail.Uploader,
			"views":      detail.Views,
			"tagsCount":  len(detail.Tags),
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
		Title:      fmt.Sprintf("XVIDEOS Listing - %d videos", len(result.Videos)),
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
		if strings.Contains(searchURL, "?") {
			searchURL = searchURL + "&p=" + fmt.Sprintf("%d", page)
		} else {
			searchURL = searchURL + "?p=" + fmt.Sprintf("%d", page)
		}
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
// XVIDEOS search URL format: /?k={keyword}
func (p *Provider) BuildSearchURL(keyword string) string {
	encoded := url.QueryEscape(keyword)
	return p.baseURL + "/?k=" + encoded
}

// CleanTitle removes site-specific suffixes and prefixes from a title.
func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	// Remove XVIDEOS suffix.
	suffixes := []string{
		" - XVIDEOS.COM",
		" - Xvideos",
		" - XV",
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
		result, err := p.blocklist.CheckUserRules(context.Background(), "xvideos", fields)
		if err == nil && result.Blocked {
			return result
		}
	}

	return sites.BlockCheckResult{Blocked: false}
}

// NormalizeURL normalizes an XVIDEOS URL to a canonical form.
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
	// Detail pages contain /video.{id}
	if strings.Contains(rawURL, "/video.") {
		return false
	}

	// Listing pages include:
	// - Homepage (no path or just /)
	// - /best/
	// - /hottest/
	// - /latest/
	// - /?k= (search)
	// - /tags/
	// - /channels/
	// - /models/
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	path := strings.Trim(parsed.Path, "/")

	// Empty path = homepage (listing).
	if path == "" {
		return true
	}

	// Check query string for search.
	if parsed.RawQuery != "" && strings.Contains(parsed.RawQuery, "k=") {
		return true
	}

	listingPatterns := []string{
		"best",
		"hottest",
		"latest",
		"tags",
		"channels",
		"models",
		"pornstars",
	}

	for _, pattern := range listingPatterns {
		if path == pattern || strings.HasPrefix(path, pattern+"/") {
			return true
		}
	}

	return false
}
