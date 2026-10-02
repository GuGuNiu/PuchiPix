package pornhub

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

var providerLogger = infra.NewLogger("PornhubProvider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces for
// the PORNHUB.COM video streaming site.
//
// Video sources are server-rendered inside an inline flashvars JSON object
// (playerObjectList), so pages are parsed over plain HTTP without JavaScript
// execution.
//
// The M3U8 and MP4 URLs carry a session-bound token with a limited validity
// window, so a task should re-scrape the page when a URL turns out to be
// stale. The CDN accepts the embedded token without Referer or Cookie.
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

	if mod, ok := dataStore.GetModuleConfig("pornhub"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}

	publisherURL := dataStore.GetPublisherURL("pornhub")
	p.domainPool = stealth.NewDomainPool("pornhub", p.domains, publisherURL)
	stealth.RegisterDomainPool("pornhub", p.domainPool)

	return p
}

func (p *Provider) SiteID() string { return "pornhub" }

func (p *Provider) CanHandle(rawURL string) bool {
	if p.dataStore.CanHandle("pornhub", rawURL) {
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

// ScrapeVideoDetail identifies the stream and full metadata of one video page
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

	// A video may advertise MP4 only through the get_media endpoint, which
	// resolves to direct links. HLS-only videos answer with an empty list
	// and keep the HLS stream.
	if detail.M3U8URL == "" && detail.GetMediaURL != "" {
		if links, ok, err := ResolveGetMedia(ctx, detail.GetMediaURL, pageURL); err == nil && ok {
			detail.MP4Links = links
			detail.MP4URL = pickBestQuality(links)
		} else if err != nil {
			providerLogger.Warn("get_media resolution failed",
				infra.LogContext{Extra: map[string]any{
					"url":   pageURL,
					"error": err.Error(),
				}})
		}
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
		Description: detail.CastText(),
		CoverURL:    detail.ThumbnailURL,
		PublishTime: detail.PublishDate,
		VideoCount:  1,
		Tags:        detail.Tags,
		Category:    strings.Join(detail.Categories, ", "),
	}

	// Only the HLS stream goes into Videos: the gallery pipeline expects
	// one item per playable file, and appending the MP4 rendition as a
	// second item would break the expected-count check.
	if detail.M3U8URL != "" {
		galleryResult.Videos = []sites.GalleryVideoItem{
			{URL: detail.M3U8URL},
		}
	}

	if detail.Uploader != "" {
		galleryResult.Protagonist = detail.Uploader
	}

	providerLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"m3u8Found": detail.M3U8URL != "",
			"mp4Found":  detail.MP4URL != "",
			"title":     detail.Title,
			"uploader":  detail.Uploader,
			"views":     detail.Views,
			"tagsCount": len(detail.Tags),
			"catsCount": len(detail.Categories),
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
		Title:      fmt.Sprintf("PORNHUB Listing - %d videos", len(result.Videos)),
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
	encoded := url.QueryEscape(keyword)
	return p.baseURL + "/video/search?search=" + encoded
}

func (p *Provider) CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}

	title := strings.TrimSpace(rawTitle)

	suffixes := []string{
		" - Pornhub.com",
		" - Pornhub",
		" - PORNHUB.COM",
		" | Pornhub",
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
		result, err := p.blocklist.CheckUserRules(context.Background(), "pornhub", fields)
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
	if strings.Contains(rawURL, "viewkey=") || strings.Contains(rawURL, "/watch/") {
		return false
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	path := strings.Trim(parsed.Path, "/")

	if path == "" {
		return true
	}

	if parsed.RawQuery != "" && strings.Contains(parsed.RawQuery, "search=") {
		return true
	}

	listingPatterns := []string{
		"video",
		"categories",
		"category",
		"channels",
		"playlists",
		"gifs",
		"model",
		"pornstar",
		"user",
	}

	for _, pattern := range listingPatterns {
		if path == pattern || strings.HasPrefix(path, pattern+"/") {
			return true
		}
	}

	return false
}
