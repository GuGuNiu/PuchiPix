package stealth

import (
	"regexp"
	"sync"
	"time"

	"backend/internal/infra"
)

const (
	// domainCacheTTL defines how long the fetched domain list is cached.
	domainCacheTTL = 24 * time.Hour
)

// domainMatchPattern extracts the core site name from configured domains
// for filtering dynamically discovered domains. For example:
// - "www.lovecutes.com" -> "lovecutes"
// - "xx.knit.bid" -> "knit"
var domainMatchPattern = regexp.MustCompile(`(?:^|\.)([a-z0-9][a-z0-9\-]*)\.[a-z]{2,}(?:\.[a-z]{2,})?$`)

var poolLogger = infra.NewLogger("DynamicDomainPool")

// DomainPool manages dynamic domain discovery for a single site provider.
// It maintains a static domain list (from config) and optionally fetches
// additional domains from a publisher URL, caching the result.
type DomainPool struct {
	mu             sync.RWMutex
	siteID         string
	staticDomains  []string
	publisherURL   string
	cachedDomains  []string
	lastFetch      time.Time
	fetching       bool
	fetchCond      *sync.Cond
	scraper        *DomainScraper
}

// NewDomainPool creates a domain pool for a site.
// If publisherURL is empty, only static domains are used.
func NewDomainPool(siteID string, staticDomains []string, publisherURL string) *DomainPool {
	p := &DomainPool{
		siteID:        siteID,
		staticDomains: staticDomains,
		publisherURL:  publisherURL,
		scraper:       NewDomainScraper(),
	}
	p.fetchCond = sync.NewCond(&p.mu)
	return p
}

// GetDomains returns the merged domain list (static + dynamically fetched).
// If the cache has expired, it triggers a background refresh and returns
// the cached result immediately (or static domains if cache is empty).
func (p *DomainPool) GetDomains() []string {
	p.mu.RLock()
	cacheValid := time.Since(p.lastFetch) < domainCacheTTL && len(p.cachedDomains) > 0
	cached := make([]string, len(p.cachedDomains))
	copy(cached, p.cachedDomains)
	static := make([]string, len(p.staticDomains))
	copy(static, p.staticDomains)
	p.mu.RUnlock()

	if cacheValid {
		return p.mergeDomains(static, cached)
	}

	// Trigger background refresh if not already in progress
	go p.refreshDomains()

	// Return static domains merged with whatever cache we have (even if stale)
	if len(cached) > 0 {
		return p.mergeDomains(static, cached)
	}
	return static
}

// GetDomainsForceRefresh forces a synchronous refresh and returns the
// updated domain list. Useful for admin/manual trigger scenarios.
func (p *DomainPool) GetDomainsForceRefresh() []string {
	p.mu.RLock()
	publisherURL := p.publisherURL
	static := make([]string, len(p.staticDomains))
	copy(static, p.staticDomains)
	p.mu.RUnlock()

	if publisherURL == "" {
		return static
	}

	fetched := p.fetchPublisherDomains(publisherURL)
	p.mu.Lock()
	p.cachedDomains = fetched
	p.lastFetch = time.Now()
	p.mu.Unlock()

	return p.mergeDomains(static, fetched)
}

// refreshDomains performs a background domain list refresh.
func (p *DomainPool) refreshDomains() {
	p.mu.Lock()
	if p.fetching {
		// Another goroutine is already fetching; wait for it
		p.fetchCond.Wait()
		p.mu.Unlock()
		return
	}
	p.fetching = true
	publisherURL := p.publisherURL
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		p.fetching = false
		p.fetchCond.Broadcast()
		p.mu.Unlock()
	}()

	if publisherURL == "" {
		return
	}

	fetched := p.fetchPublisherDomains(publisherURL)

	p.mu.Lock()
	p.cachedDomains = fetched
	p.lastFetch = time.Now()
	p.mu.Unlock()

	poolLogger.Info("Domain list refreshed",
		infra.LogContext{Extra: map[string]any{
			"siteID":         p.siteID,
			"publisherURL":   publisherURL,
			"fetchedDomains": len(fetched),
		}})
}

// fetchPublisherDomains fetches the publisher page and extracts all
// valid domain URLs from it, filtering to only include domains that
// match known site domain patterns.
func (p *DomainPool) fetchPublisherDomains(publisherURL string) []string {
	result := p.scraper.FetchPublisherPage(publisherURL)
	if result.Error != nil {
		poolLogger.Warn("Failed to fetch publisher page",
			infra.LogContext{Extra: map[string]any{
				"siteID": p.siteID,
				"url":    publisherURL,
				"error":  result.Error.Error(),
			}})
		return nil
	}

	if result.StatusCode != 200 {
		poolLogger.Warn("Publisher page returned non-200",
			infra.LogContext{Extra: map[string]any{
				"siteID":      p.siteID,
				"url":         publisherURL,
				"statusCode":  result.StatusCode,
			}})
		return nil
	}

	allDomains := p.scraper.ExtractDomainsFromHTML(result.HTML)
	return p.filterSiteDomains(allDomains)
}

// filterSiteDomains filters discovered domains to only include those
// matching known site domain patterns (e.g., "lovecutes", "knit").
func (p *DomainPool) filterSiteDomains(domains []string) []string {
	// Extract core site names from static domains
	siteNames := make(map[string]bool)
	for _, d := range p.staticDomains {
		host := ExtractHostname(d)
		if host == "" {
			continue
		}
		// Extract core name: e.g., "www.lovecutes.com" -> "lovecutes"
		matches := domainMatchPattern.FindStringSubmatch(host)
		if len(matches) >= 2 {
			siteNames[matches[1]] = true
		}
	}

	// Filter discovered domains
	filtered := make([]string, 0, len(domains))
	for _, d := range domains {
		host := ExtractHostname(d)
		if host == "" {
			continue
		}
		matches := domainMatchPattern.FindStringSubmatch(host)
		if len(matches) >= 2 && siteNames[matches[1]] {
			filtered = append(filtered, d)
		}
	}
	return filtered
}

// mergeDomains combines static and dynamic domains, removing duplicates.
// Static domains always appear first for priority.
func (p *DomainPool) mergeDomains(static, dynamic []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(static)+len(dynamic))

	for _, d := range static {
		if !seen[d] {
			seen[d] = true
			result = append(result, d)
		}
	}
	for _, d := range dynamic {
		if !seen[d] {
			seen[d] = true
			result = append(result, d)
		}
	}
	return result
}

// GetCacheInfo returns metadata about the current cache state for diagnostics.
func (p *DomainPool) GetCacheInfo() (domainCount int, lastFetch time.Time, isExpired bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.cachedDomains), p.lastFetch, time.Since(p.lastFetch) >= domainCacheTTL
}

// SetPublisherURL updates the publisher URL at runtime.
func (p *DomainPool) SetPublisherURL(url string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.publisherURL = url
	// Reset cache to force refresh with new URL
	p.cachedDomains = nil
	p.lastFetch = time.Time{}
}

// SetStaticDomains updates the static domain list at runtime.
func (p *DomainPool) SetStaticDomains(domains []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.staticDomains = domains
}

// ==================== Global Pool Registry ====================

var (
	poolRegistryMu sync.RWMutex
	poolRegistry   = make(map[string]*DomainPool)
)

// RegisterDomainPool registers a domain pool for a site in the global registry.
// This allows other parts of the system to access the pool by site ID.
func RegisterDomainPool(siteID string, pool *DomainPool) {
	poolRegistryMu.Lock()
	defer poolRegistryMu.Unlock()
	poolRegistry[siteID] = pool
}

// GetRegisteredDomainPool returns the registered domain pool for a site.
// Returns nil if no pool is registered for the site.
func GetRegisteredDomainPool(siteID string) *DomainPool {
	poolRegistryMu.RLock()
	defer poolRegistryMu.RUnlock()
	return poolRegistry[siteID]
}

// GetRegisteredDomainDomains returns the merged domain list for a registered site.
// Falls back to static domains from the data store if no pool is registered.
func GetRegisteredDomainDomains(siteID string) []string {
	pool := GetRegisteredDomainPool(siteID)
	if pool != nil {
		return pool.GetDomains()
	}
	return nil
}
