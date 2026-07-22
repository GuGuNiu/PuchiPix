package sjs

import (
	"context"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var providerLogger = infra.NewLogger("SjsProvider")

// Provider implements GallerySiteProvider and SiteProvider for the
// SJS Discuz! forum, supporting multi-domain failover,
// cookie-based authentication, and multi-page thread traversal.
type Provider struct {
	dataStore      sites.SiteDataStore
	accountManager *sites.SiteAccountManager
}

// NewProvider creates an SJS provider with the given data store and
// account manager, loading site configuration from the unified
// SiteDataStore to eliminate hardcoded constants.
func NewProvider(dataStore sites.SiteDataStore, am *sites.SiteAccountManager) *Provider {
	initData(dataStore)
	return &Provider{dataStore: dataStore, accountManager: am}
}

func (p *Provider) SiteID() string { return "sjs" }

func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("sjs", rawURL)
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return ScrapeGalleryBrowser(ctx, pageURL, p.accountManager)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL, p.accountManager)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed, falling back to browser",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return ScrapeGalleryBrowser(ctx, pageURL, p.accountManager)
	}
	return result, nil
}

func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	cookieStr, _ := GetAuthCookieString(ctx, p.accountManager)
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(SiteDomains)

	encoded := url.QueryEscape(query)

	for _, domain := range orderedDomains {
		searchURL := domain + "/search.php?mod=forum&srchtxt=" + encoded + "&searchsubmit=yes"
		if page > 1 {
			searchURL = searchURL + "&page=" + intToStr(page)
		}

		html, err := fetchHTMLWithCookies(ctx, searchURL, cookieStr, domain+"/")
		if err != nil {
			providerLogger.Debug("Search fetch failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if doc.Find("li.nexwateritems").Length() == 0 && doc.Find("#threadlisttableid").Length() == 0 {
			continue
		}

		var entries []SearchEntry
		if doc.Find("li.nexwateritems").Length() > 0 {
			entries = ExtractSearchResults(doc)
		} else {
			entries = ExtractForumListResults(doc)
		}

		results := make([]sites.SiteSearchResult, 0, len(entries))
		for _, e := range entries {
			results = append(results, sites.SiteSearchResult{
				URL:      p.NormalizeURL(e.URL),
				Title:    e.Title,
				CoverURL: e.CoverURL,
				Date:     e.Date,
			})
		}

		providerLogger.Info("Search completed",
			infra.LogContext{Extra: map[string]any{
				"query":   query,
				"page":    page,
				"results": len(results),
				"domain":  domain,
			}})

		tracker.MarkHealthy(domain)
		return results, nil
	}

	return nil, nil
}

func (p *Provider) BuildSearchURL(keyword string) string {
	domain := stealth.GetDomainHealthTracker().GetBestDomain(SiteDomains)
	return domain + "/search.php?mod=forum&srchtxt=" + url.QueryEscape(keyword) + "&searchsubmit=yes"
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return CleanSjsTitle(rawTitle)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return sites.BlockCheckResult{Blocked: false}
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return NormalizeSjsUrl(rawURL)
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return IsListingPage(rawURL)
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	isNegative := n < 0
	if isNegative {
		n = -n
	}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if isNegative {
		return "-" + string(digits)
	}
	return string(digits)
}
