package aimeizizi

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var providerLogger = infra.NewLogger("AimeiziziProvider")

// Provider implements the GallerySiteProvider and SiteProvider interfaces
// for the Aimeizizi (LoveCutes) gallery site.
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
}

// NewProvider creates an Aimeizizi provider with the given data store
// and blocklist checker, pre-loading all site data from the unified
// configuration to eliminate runtime lookups in hot paths.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	p := &Provider{
		dataStore: dataStore,
		blocklist: blocklist,
	}

	if mod, ok := dataStore.GetModuleConfig("aimeizizi"); ok {
		p.domains = mod.Domains
		p.baseURL = mod.BaseURL
	}
	p.placeholder = dataStore.GetPlaceholder("aimeizizi")
	p.publisherPrefixes = dataStore.GetPublisherPrefixes("aimeizizi")
	p.blockedKeywords = dataStore.GetBlockedKeywords("aimeizizi")
	p.blockedCategories = dataStore.GetBlockedCategories("aimeizizi")

	for _, patternStr := range dataStore.GetTitleSuffixPatterns("aimeizizi") {
		if re, err := regexp.Compile(patternStr); err == nil {
			p.suffixPatterns = append(p.suffixPatterns, re)
		}
	}

	return p
}

func (p *Provider) SiteID() string { return "aimeizizi" }

func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("aimeizizi", rawURL)
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return ScrapeGalleryBrowser(ctx, pageURL, p)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL, p)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed, no fallback configured",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return nil, err
	}

	shouldFallback, reason := stealth.ShouldFallbackToBrowser(
		result.Title, result.ImageCount, result.VideoCount, result.PageCount)
	if shouldFallback {
		providerLogger.Info("HTTP scrape result suspicious, falling back to browser",
			infra.LogContext{Extra: map[string]any{
				"url":    pageURL,
				"reason": reason,
			}})
		return ScrapeGalleryBrowser(ctx, pageURL, p)
	}

	return result, nil
}

func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		encoded := query
		searchURL = strings.TrimRight(searchURL, "/") + "/page/" + itoa(page) + "/?s=" + encoded
	}

	result, err := fetchAndParse(ctx, searchURL, stealth.GetDomainHealthTracker().GetBestDomain(p.domains))
	if err != nil {
		return nil, err
	}
	if result.doc == nil {
		return nil, nil
	}

	entries := ParseSearchResults(result.doc, searchURL, p.placeholder)
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
	domain := stealth.GetDomainHealthTracker().GetBestDomain(p.domains)
	return domain + "/?s=" + url.QueryEscape(keyword)
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return cleanTitleImpl(rawTitle, p.suffixPatterns, p.publisherPrefixes)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return p.checkBlocked(title, category, protagonist)
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return ReplaceDomain(rawURL, p.baseURL, p.domains)
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/article/")
}

// GetDomains returns the site's configured domain list for scraper use.
func (p *Provider) GetDomains() []string { return p.domains }

// GetPlaceholder returns the placeholder image fragment for scraper use.
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
	if title == "" {
		return ""
	}

	// Aimeizizi gallery titles typically follow the pattern:
	//   "ModelName – Description"  (en-dash)
	//   "ModelName — Description"  (em-dash)
	//   "ModelName - Description"  (hyphen)
	// The protagonist (cosplayer/model) name appears before the separator.
	separators := []string{" – ", " — ", " - ", " –", "—", "–"}
	for _, sep := range separators {
		if idx := strings.Index(title, sep); idx > 0 {
			candidate := strings.TrimSpace(title[:idx])
			// Reject candidates that are too long (likely not a name)
			// or too short (likely noise).
			if len(candidate) >= 2 && len(candidate) <= 50 {
				return candidate
			}
		}
	}

	return ""
}

func (p *Provider) ExtractDescription(title, protagonist string) string {
	if title == "" {
		return ""
	}
	if protagonist == "" {
		return title
	}
	desc := strings.ReplaceAll(title, protagonist, "")
	desc = strings.TrimLeft(desc, " \t-")
	return strings.TrimSpace(desc)
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
		return p.blocklist.CheckUserRules(ctx, "aimeizizi", fields)
	}

	return sites.BlockCheckResult{Blocked: false}, nil
}

func (p *Provider) checkBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return sites.CheckBlockedDefault(
		title, category, protagonist,
		p.blockedKeywords, p.blockedCategories,
		p.dataStore.GetBlockedProtagonists("aimeizizi"),
		p.dataStore.IsBlockedProtagonistsEnabled("aimeizizi"),
	)
}
