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

// Provider implements the GallerySiteProvider and SiteProvider interfaces for
// the 91porn.plus video streaming site.
//
// The module is video-typed but implements GallerySiteProvider because M3U8
// extraction goes through ScrapeGallery/ScrapeGalleryHTTP, and the TaskCreate
// pre-processor routes 91porn URLs to the video pipeline by module type.
//
// The M3U8 URL is embedded in Schema.org JSON-LD inside the server-rendered
// HTML, so a browser is only needed when the JSON-LD block is absent.
type Provider struct {
	dataStore  sites.SiteDataStore
	blocklist  sites.BlocklistChecker
	domains    []string
	baseURL    string
	domainPool *stealth.DomainPool
}

func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore: dataStore,
		blocklist: blocklist,
	}

	if mod, ok := dataStore.GetModuleConfig("91porn"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}

	publisherURL := dataStore.GetPublisherURL("91porn")
	p.domainPool = stealth.NewDomainPool("91porn", p.domains, publisherURL)
	stealth.RegisterDomainPool("91porn", p.domainPool)

	return p
}

func (p *Provider) SiteID() string { return "91porn" }

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

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return p.scrapeDetail(ctx, pageURL)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	if p.IsListingPage(pageURL) {
		return p.scrapeListing(ctx, pageURL)
	}
	return p.scrapeDetail(ctx, pageURL)
}

// ScrapeVideoDetail identifies the stream and metadata of one video page
// over plain HTTP, which is the path the video pipeline prefers over the
// universal browser sniffer.
func (p *Provider) ScrapeVideoDetail(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	detail, err := ScrapeDetailHTTP(ctx, pageURL)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed for video detail",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return nil, fmt.Errorf("detail page scrape failed: %w", err)
	}
	return detail.ToScrapeResult(pageURL), nil
}

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
		CoverURL:    detail.ThumbnailURL,
		PublishTime: detail.PublishDate,
		VideoCount:  1,
		Tags:        detail.Tags,
	}

	if detail.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: detail.M3U8URL},
		}
	}

	if detail.Author != "" {
		galleryResult.Protagonist = detail.Author
	}

	providerLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"m3u8Found": detail.M3U8URL != "",
			"title":     detail.Title,
			"author":    detail.Author,
			"views":     detail.Views,
			"tagsCount": len(detail.Tags),
		}})

	return galleryResult, nil
}

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

func (p *Provider) BuildSearchURL(keyword string) string {
	return p.baseURL + "/search/" + keyword
}

func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	suffixes := []string{
		" - 91Porn",
		" - 91短视频",
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
		result, err := p.blocklist.CheckUserRules(context.Background(), "91porn", fields)
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
	return rawURL
}

// GetDomains returns the merged domain list (static + dynamically discovered).
func (p *Provider) GetDomains() []string {
	if p.domainPool != nil {
		return p.domainPool.GetDomains()
	}
	return p.domains
}

func (p *Provider) IsListingPage(rawURL string) bool {
	if strings.Contains(rawURL, "/video/") {
		return false
	}

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

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	path := strings.Trim(parsed.Path, "/")
	return path == ""
}
