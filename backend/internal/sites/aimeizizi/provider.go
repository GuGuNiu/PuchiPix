package aimeizizi

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"time"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/urlutil"
)

var _ = time.Time{}

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
	domainPool        *stealth.DomainPool
}

// NewProvider pre-loads all site data from the shared configuration so the
// scrape hot paths avoid per-call data store lookups.
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

	publisherURL := dataStore.GetPublisherURL("aimeizizi")
	p.domainPool = stealth.NewDomainPool("aimeizizi", p.domains, publisherURL)
	stealth.RegisterDomainPool("aimeizizi", p.domainPool)

	return p
}

func (p *Provider) SiteID() string { return "aimeizizi" }

func (p *Provider) CanHandle(rawURL string) bool {
	if p.dataStore.CanHandle("aimeizizi", rawURL) {
		return true
	}
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
	return ScrapeGalleryBrowser(ctx, pageURL, p)
}

func (p *Provider) ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	result, err := ScrapeGalleryHTTP(ctx, pageURL, p)
	if err != nil {
		// A blocklist rejection is deterministic, so a browser retry would
		// reach the same verdict.
		if strings.Contains(err.Error(), "content blocked:") {
			providerLogger.Warn("Content blocked by blocklist, skipping browser fallback",
				infra.LogContext{Extra: map[string]any{
					"url":   pageURL,
					"error": err.Error(),
				}})
			return nil, err
		}
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
	allDomains := p.GetDomains()
	searchURL := p.BuildSearchURL(query)
	if page > 1 {
		encoded := query
		searchURL = strings.TrimRight(searchURL, "/") + "/page/" + itoa(page) + "/?s=" + encoded
	}

	domain := stealth.GetDomainHealthTracker().GetBestDomain(allDomains)
	started := time.Now()
	result, err := fetchAndParse(ctx, searchURL, domain)
	// Search traffic hits a real mirror, so it feeds the same domain health
	// signals as the download path.
	stealth.GetDomainHealthTracker().ReportOutcome(domain, time.Since(started), err)
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
	domain := stealth.GetDomainHealthTracker().GetBestDomain(p.GetDomains())
	return domain + "/?s=" + url.QueryEscape(keyword)
}

func (p *Provider) CleanTitle(rawTitle string) string {
	return cleanTitleImpl(rawTitle, p.suffixPatterns, p.publisherPrefixes)
}

func (p *Provider) CheckContentBlocked(title, category, protagonist string) sites.BlockCheckResult {
	return p.checkBlocked(title, category, protagonist)
}

func (p *Provider) NormalizeURL(rawURL string) string {
	return urlutil.ReplaceDomain(rawURL, p.baseURL, p.GetDomains())
}

func (p *Provider) IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/article/")
}

func (p *Provider) GetDomains() []string {
	if p.domainPool != nil {
		return p.domainPool.GetDomains()
	}
	return p.domains
}

func (p *Provider) GetDomainCacheInfo() (domainCount int, lastFetch time.Time, isExpired bool) {
	if p.domainPool != nil {
		return p.domainPool.GetCacheInfo()
	}
	return len(p.domains), time.Time{}, false
}

func (p *Provider) GetPlaceholder() string { return p.placeholder }

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

	// The model name precedes an en-dash, em-dash, or hyphen separator.
	separators := []string{" – ", " — ", " - ", " –", "—", "–"}
	for _, sep := range separators {
		if idx := strings.Index(title, sep); idx > 0 {
			candidate := strings.TrimSpace(title[:idx])
			// Length bounds reject prose fragments on the long side and
			// separator noise on the short side.
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
