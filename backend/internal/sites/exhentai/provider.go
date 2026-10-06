package exhentai

import (
	"context"
	"net/url"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
)

var providerLogger = infra.NewLogger("ExhentaiProvider")

// Provider implements GallerySiteProvider and SiteProvider for the
// E-Hentai / ExHentai gallery sites, supporting both HTTP and
// browser-based scraping with cookie authentication.
type Provider struct {
	dataStore sites.SiteDataStore
}

func NewProvider(dataStore sites.SiteDataStore) *Provider {
	initData(dataStore)
	return &Provider{dataStore: dataStore}
}

func (p *Provider) SiteID() string { return "exhentai" }

func (p *Provider) CanHandle(rawURL string) bool {
	return p.dataStore.CanHandle("exhentai", rawURL)
}

func (p *Provider) ScrapeGallery(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	return ScrapeGalleryBrowser(ctx, pageURL)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL)
	if err != nil {
		providerLogger.Warn("HTTP scrape failed, falling back to browser",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return ScrapeGalleryBrowser(ctx, pageURL)
	}
	return result, nil
}

func (p *Provider) Search(ctx context.Context, query string, page int) ([]sites.SiteSearchResult, error) {
	cookies := GetExhentaiCookies()
	cookieStr := ""
	if cookies != nil {
		cookieStr = cookies.AsCookieString()
	}

	candidateURLs := GetAdaptiveSearchURLs(query)
	if page > 1 {
		for i := range candidateURLs {
			candidateURLs[i] = candidateURLs[i] + "&page=" + strconv.Itoa(page-1)
		}
	}

	for _, tryURL := range candidateURLs {
		html, err := fetchHTML(ctx, tryURL, cookieStr)
		if err != nil {
			providerLogger.Debug("Search fetch failed",
				infra.LogContext{Extra: map[string]any{
					"url":   tryURL,
					"error": err.Error(),
				}})
			continue
		}

		if isSadPanda(html) {
			continue
		}

		doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if doc.Find("table.itg").Length() == 0 {
			continue
		}

		entries := ExtractSearchResults(doc)
		results := make([]sites.SiteSearchResult, 0, len(entries))
		for _, e := range entries {
			results = append(results, sites.SiteSearchResult{
				URL:      e.URL,
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
			}})

		return results, nil
	}

	return nil, nil
}

func (p *Provider) BuildSearchURL(keyword string) string {
	params := url.Values{}
	params.Set("f_search", keyword)
	params.Set("advsearch", "1")
	params.Set("f_srdd", "0")
	params.Set("f_cats", "0")
	return BaseEURL + "/?" + params.Encode()
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return CleanExhentaiTitle(rawTitle)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return sites.BlockCheckResult{Blocked: false}
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return NormalizeToEhentai(rawURL)
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return IsExhentaiListingPage(rawURL)
}
