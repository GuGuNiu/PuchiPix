package universal

import (
	"context"

	"backend/internal/sites"
)

// Provider implements video-page scraping for arbitrary URLs, acting as
// the fallback when no site-specific provider matches the input URL.
// It focuses on M3U8 sniffing rather than gallery image extraction.
type Provider struct{}

// NewProvider creates a Universal provider instance.
func NewProvider() *Provider {
	return &Provider{}
}

func (p *Provider) SiteID() string { return "universal" }

func (p *Provider) CanHandle(_ string) bool {
	return false
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapePage(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	return &sites.GalleryScrapeResult{
		SourceURL:  result.PageURL,
		Title:      result.Title,
		Tags:       result.Tags,
		Videos:     m3u8ToVideoItems(result),
		PageCount:  1,
		VideoCount: 1,
	}, nil
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return p.ScrapeGallery(ctx, pageURL)
}

func (p *Provider) Search(_ context.Context, _ string, _ int) ([]sites.SiteSearchResult, error) {
	return nil, nil
}

func (p *Provider) BuildSearchURL(keyword string) string {
	return keyword
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return CleanTitle(rawTitle)
}

func (p *Provider) CheckContentBlocked(_, _, _ string) sites.BlockCheckResult {
	return sites.BlockCheckResult{Blocked: false}
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return rawURL
}

func (p *Provider) IsListingPage(_ string) bool {
	return false
}

// ScrapePage delegates to the M3U8 sniffing scraper, returning a
// ScrapeResult suitable for creating video download tasks.
func (p *Provider) ScrapePage(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	return ScrapePage(ctx, pageURL)
}

func m3u8ToVideoItems(result *sites.ScrapeResult) []sites.GalleryVideoItem {
	if result.M3U8URL == "" {
		return nil
	}
	return []sites.GalleryVideoItem{{URL: result.M3U8URL}}
}
