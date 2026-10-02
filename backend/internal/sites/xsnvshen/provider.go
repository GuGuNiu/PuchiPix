package xsnvshen

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var providerLogger = infra.NewLogger("XsnvshenProvider")

// Provider implements GallerySiteProvider and SiteProvider for the
// Xsnvshen gallery site, handling the site's age verification interstitial
// and falling back to a browser when HTTP scraping yields no content.
type Provider struct {
	dataStore sites.SiteDataStore
	blocklist sites.BlocklistChecker
}

// NewProvider creates a provider backed by the shared data store, which also
// initializes the package-level site configuration.
func NewProvider(dataStore sites.SiteDataStore, blocklist sites.BlocklistChecker) *Provider {
	initData(dataStore)
	return &Provider{dataStore: dataStore, blocklist: blocklist}
}

func (p *Provider) SiteID() string { return "xsnvshen" }

func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("xsnvshen", rawURL)
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return ScrapeGalleryBrowser(ctx, pageURL, p)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL, p)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed, falling back to browser",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return ScrapeGalleryBrowser(ctx, pageURL, p)
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
	encoded := url.QueryEscape(query)
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(SiteDomains)

	domain := orderedDomains[0]
	searchURL := domain + "/search/" + encoded
	if page > 1 {
		searchURL = searchURL + "/" + fmt.Sprintf("%d", page)
	}

	started := time.Now()
	result, _, err := fetchHTMLRaw(ctx, searchURL, domain)
	tracker.ReportOutcome(domain, time.Since(started), err)
	if err != nil {
		providerLogger.Warn("Search fetch failed",
			infra.LogContext{Extra: map[string]any{
				"url":   searchURL,
				"error": err.Error(),
			}})
		return nil, err
	}

	doc, err := parseHTML(result)
	if err != nil {
		return nil, err
	}

	if IsAgeVerificationPage(doc) {
		if !performAgeVerification(ctx, domain) {
			return nil, fmt.Errorf("age verification failed during search")
		}
		retryStarted := time.Now()
		result, _, err = fetchHTMLRaw(ctx, searchURL, domain)
		tracker.ReportOutcome(domain, time.Since(retryStarted), err)
		if err != nil {
			return nil, err
		}
		doc, err = parseHTML(result)
		if err != nil {
			return nil, err
		}
	}

	entries := ParseSearchResults(doc, searchURL)
	results := make([]sites.SiteSearchResult, 0, len(entries))
	for _, e := range entries {
		blockCheck, err := p.CheckBlockedAsync(ctx, e.Title, "", "")
		if err != nil {
			continue
		}
		if blockCheck.Blocked {
			providerLogger.Info("Blocked search result",
				infra.LogContext{Extra: map[string]any{
					"title":  truncate(e.Title, 50),
					"reason": blockCheck.Reason,
				}})
			continue
		}
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
	domain := stealth.GetDomainHealthTracker().GetBestDomain(SiteDomains)
	return domain + "/search/" + url.QueryEscape(keyword)
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return CleanTitle(rawTitle)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return p.checkBlocked(title, category, protagonist)
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return NormalizeURL(rawURL)
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return IsListingPage(rawURL)
}

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
			base = SiteDomains[0]
		}
		return strings.TrimRight(base, "/") + rawURL
	}
	return rawURL
}

func (p *Provider) ExtractProtagonist(title string, tags []string) string {
	return ""
}

func (p *Provider) ExtractDescription(title, protagonist string) string {
	return CleanDescription(title, protagonist)
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
		return p.blocklist.CheckUserRules(ctx, "xsnvshen", fields)
	}

	return sites.BlockCheckResult{Blocked: false}, nil
}

func (p *Provider) checkBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return sites.CheckBlockedDefault(
		title, category, protagonist,
		BlockedTitleKeywords, BlockedCategories, BlockedProtagonists,
		BlockedProtagonistsEnabled,
	)
}

func parseHTML(html string) (*goquery.Document, error) {
	return goquery.NewDocumentFromReader(strings.NewReader(html))
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}
