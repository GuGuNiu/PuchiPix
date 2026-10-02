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

// Provider implements the GallerySiteProvider and SiteProvider interfaces for
// the KanAV video streaming site.
//
// KanAV is a video-type module but implements GallerySiteProvider because the
// video download pipeline reaches M3U8 URLs through the universal scraper.
// The TaskCreate pre-processor routes KanAV URLs to the video pipeline by
// checking the module type field.
type Provider struct {
	dataStore       sites.SiteDataStore
	blocklist       sites.BlocklistChecker
	domains         []string
	baseURL         string
	categoryConfigs []CategoryConfig
	domainPool      *stealth.DomainPool
}

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

	publisherURL := dataStore.GetPublisherURL("kanav")
	p.domainPool = stealth.NewDomainPool("kanav", p.domains, publisherURL)
	stealth.RegisterDomainPool("kanav", p.domainPool)

	return p
}

func (p *Provider) SiteID() string { return "kanav" }

func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("kanav", rawURL)
}

// ScrapeGallery scrapes a video detail page with the browser-based universal
// scraper, which sniffs M3U8 URLs.
func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return p.scrapeWithUniversal(ctx, pageURL)
}

func (p *Provider) scrapeWithUniversal(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := universal.ScrapePage(ctx, pageURL)
	if err != nil {
		providerLogger.Warn("Universal scrape failed, trying headful fallback",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		result, err = universal.ScrapePageHeadful(ctx, pageURL)
		if err != nil {
			return nil, fmt.Errorf("headful scrape also failed: %w", err)
		}
	}

	galleryResult := &sites.GalleryScrapeResult{
		SourceURL:  pageURL,
		Title:      result.Title,
		Tags:       result.Tags,
		Category:   strings.Join(result.Categories, ", "),
		VideoCount: 1,
	}

	// MacCMS templates publish M3U8 URLs as base64(url_encode(actual_url)).
	// Decoding at the provider layer keeps gallery_videos.url an actual HTTP(S) URL.
	if result.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: universal.DecodeMacCMSURL(result.M3U8URL)},
		}
	}

	if len(result.M3U8Candidates) > 0 {
		for _, cand := range result.M3U8Candidates {
			galleryResult.Videos = append(galleryResult.Videos, sites.GalleryVideoItem{
				URL: universal.DecodeMacCMSURL(cand.URL),
			})
		}
	}

	return galleryResult, nil
}

// ScrapeGalleryHTTP attempts to scrape via HTTP for listing pages. Detail
// pages delegate to the browser scraper because M3U8 URLs require JavaScript
// execution.
func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	if p.IsListingPage(pageURL) {
		return p.scrapeListingHTTP(ctx, pageURL)
	}

	providerLogger.Info("Detail page detected, delegating to browser scraper",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})
	return p.ScrapeGallery(ctx, pageURL)
}

func (p *Provider) scrapeListingHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeListingHTTP(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	galleryResult := &sites.GalleryScrapeResult{
		SourceURL:  pageURL,
		Title:      fmt.Sprintf("KanAV Listing - %d videos", len(result.Videos)),
		VideoCount: len(result.Videos),
	}

	// Listing page URLs are packed into Description so the task pipeline can
	// enqueue the whole listing in one batch
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

func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		searchURL = searchURL + "&page=" + fmt.Sprintf("%d", page)
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

func (p *Provider) BuildSearchURL(keyword string) string {
	encodedKeyword := url.QueryEscape(keyword)
	return p.baseURL + "/index.php/vod/search.html?wd=" + encodedKeyword + "&by=time_add"
}

// CleanTitle removes the site branding appended after the title, e.g. a
// " - KanAV" separator followed by a localized tagline, plus the standalone
// quality badges the themes add.
func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	// The branding regex is greedy, so it must run before the fixed suffixes
	// or it would strip a trailing badge together with the branding text
	title = regexp.MustCompile(`\s*[-—丨]\s*KanAV.*$`).ReplaceAllString(title, "")

	suffixes := []string{
		"[中文字幕]",
		"[高清]",
		" - 在线观看",
	}

	for _, suffix := range suffixes {
		title = strings.TrimSuffix(title, suffix)
	}

	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")

	return strings.TrimSpace(title)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
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

func (p *Provider) NormalizeURL(rawURL string) string {
	if strings.HasPrefix(rawURL, "http://") {
		rawURL = "https://" + rawURL[7:]
	}

	for _, domain := range p.GetDomains() {
		if strings.Contains(rawURL, domain) {
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

func (p *Provider) IsListingPage(url string) bool {
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

func (p *Provider) GetCategoryConfig(categoryID int) (CategoryConfig, bool) {
	return GetCategoryByID(categoryID)
}

func (p *Provider) GetAllCategories() []CategoryConfig {
	return p.categoryConfigs
}
