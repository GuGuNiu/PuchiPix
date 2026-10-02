package stealth

import (
	"math/rand"
	"regexp"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/sites"
)

const (
	domainCacheTTL = 24 * time.Hour
	// domainRetryInterval throttles retries after a publisher fetch
	// failure. Without it a persistently unreachable publisher turns every
	// GetDomains call into a fresh outbound request.
	domainRetryInterval = 15 * time.Minute
)

// domainMatchPattern extracts the core site name (e.g. "lovecutes" from
// "www.lovecutes.com") for filtering dynamically discovered domains.
var domainMatchPattern = regexp.MustCompile(`(?:^|\.)([a-z0-9][a-z0-9\-]*)\.[a-z]{2,}(?:\.[a-z]{2,})?$`)

var poolLogger = infra.NewLogger("DynamicDomainPool")

// DomainPool manages domain availability for a single site: the configured
// static list, domains discovered from the site's publisher page, and the
// shared health scoring that ranks them.
type DomainPool struct {
	mu            sync.RWMutex
	siteID        string
	staticDomains []string
	publisherURL  string
	cachedDomains []string
	lastFetch     time.Time
	lastAttempt   time.Time
	fetching      bool
	fetchCond     *sync.Cond
	scraper       *DomainScraper
	healthTracker *DomainHealthTracker
}

// NewDomainPool creates a domain pool for a site. An empty publisherURL
// means only the static domains are ever used. The pool shares the process
// wide DomainHealthTracker so scoring reflects every pipeline that touches
// the domain, not just this one.
func NewDomainPool(siteID string, staticDomains []string, publisherURL string) *DomainPool {
	own := make([]string, len(staticDomains))
	copy(own, staticDomains)

	p := &DomainPool{
		siteID:        siteID,
		staticDomains: own,
		publisherURL:  publisherURL,
		scraper:       NewDomainScraper(),
		healthTracker: GetDomainHealthTracker(),
	}
	p.fetchCond = sync.NewCond(&p.mu)
	return p
}

// GetDomains returns the site's available domains ranked by current health.
// When the publisher cache is stale the refresh runs in the background and
// the stale (or static) list is returned immediately, so no caller ever
// blocks on network I/O.
func (p *DomainPool) GetDomains() []string {
	p.mu.RLock()
	cached := make([]string, len(p.cachedDomains))
	copy(cached, p.cachedDomains)
	static := make([]string, len(p.staticDomains))
	copy(static, p.staticDomains)
	stale := time.Since(p.lastFetch) >= domainCacheTTL
	p.mu.RUnlock()

	if stale {
		go p.refreshDomains()
	}

	return p.healthTracker.GetAllDomainsOrdered(p.mergeDomains(static, cached))
}

// OrderDomains ranks a caller-supplied domain list using the same scoring as
// GetDomains.
func (p *DomainPool) OrderDomains(domains []string) []string {
	return p.healthTracker.GetAllDomainsOrdered(domains)
}

// PickDomain chooses one domain from a candidate list, preferring entries
// that are not cooling and are not already at their concurrency cap. exclude
// lets a caller skip a domain it has just tried.
func (p *DomainPool) PickDomain(domains []string, exclude string) string {
	return PickDomain(domains, exclude)
}

// GetNextDomain returns a domain chosen from the site's own pool using the
// two-candidate heuristic. It is a convenience wrapper over PickDomain for
// callers that hold a pool but no explicit candidate list.
func (p *DomainPool) GetNextDomain() string {
	return p.PickDomain(p.GetDomains(), "")
}

// GetBestDomain returns the highest-scoring domain in the site's pool, or an
// empty string when the pool has no domains.
func (p *DomainPool) GetBestDomain() string {
	return p.healthTracker.GetBestDomain(p.GetDomains())
}

// GetDomainsForceRefresh performs a synchronous publisher fetch and returns
// the refreshed list. A failed fetch keeps the previously discovered domains
// rather than discarding them.
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
	p.storeFetched(fetched)

	return p.healthTracker.GetAllDomainsOrdered(p.mergeDomains(static, fetched))
}

func (p *DomainPool) GetCacheInfo() (domainCount int, lastFetch time.Time, isExpired bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.cachedDomains), p.lastFetch, time.Since(p.lastFetch) >= domainCacheTTL
}

// SetPublisherURL repoints the pool at a different publisher page and drops
// the discovered list so the new source is fetched.
func (p *DomainPool) SetPublisherURL(url string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.publisherURL = url
	p.cachedDomains = nil
	p.lastFetch = time.Time{}
}

// SetStaticDomains replaces the configured domain list. The slice is copied so
// later mutation by the caller cannot race with reads.
func (p *DomainPool) SetStaticDomains(domains []string) {
	own := make([]string, len(domains))
	copy(own, domains)

	p.mu.Lock()
	defer p.mu.Unlock()
	p.staticDomains = own
}

func (p *DomainPool) SiteID() string {
	return p.siteID
}

// refreshDomains performs a background publisher refresh, collapsing
// concurrent callers onto a single in-flight fetch.
func (p *DomainPool) refreshDomains() {
	p.mu.Lock()
	if p.fetching {
		p.fetchCond.Wait()
		p.mu.Unlock()
		return
	}
	// Rate limit retries so an unreachable publisher does not turn every
	// GetDomains call into a fresh outbound request.
	if !p.lastAttempt.IsZero() && time.Since(p.lastAttempt) < domainRetryInterval {
		p.mu.Unlock()
		return
	}
	p.fetching = true
	p.lastAttempt = time.Now()
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
	p.storeFetched(fetched)

	poolLogger.Info("Domain list refreshed",
		infra.LogContext{Extra: map[string]any{
			"siteID":         p.siteID,
			"publisherURL":   publisherURL,
			"fetchedDomains": len(fetched),
		}})
}

// storeFetched commits a publisher fetch result. An empty result keeps the
// previous list: treating a transient publisher outage as "the site has no
// other domains" would collapse the pool to the static entries alone.
func (p *DomainPool) storeFetched(fetched []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(fetched) > 0 {
		p.cachedDomains = fetched
	}
	p.lastFetch = time.Now()
}

// fetchPublisherDomains fetches the publisher page and extracts the site
// domains from it. It returns nil when the fetch fails or the page carries no
// matching domains.
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
				"siteID":     p.siteID,
				"url":        publisherURL,
				"statusCode": result.StatusCode,
			}})
		return nil
	}

	return p.filterSiteDomains(p.scraper.ExtractDomainsFromHTML(result.HTML))
}

// filterSiteDomains keeps only discovered domains whose core name matches one
// already configured for the site, so publisher pages that link to unrelated
// destinations (messaging apps, CDNs) do not pollute the pool.
func (p *DomainPool) filterSiteDomains(domains []string) []string {
	siteNames := make(map[string]bool)
	for _, d := range p.staticDomains {
		host := ExtractHostname(d)
		if host == "" {
			continue
		}
		if matches := domainMatchPattern.FindStringSubmatch(host); len(matches) >= 2 {
			siteNames[matches[1]] = true
		}
	}

	filtered := make([]string, 0, len(domains))
	for _, d := range domains {
		host := ExtractHostname(d)
		if host == "" {
			continue
		}
		if matches := domainMatchPattern.FindStringSubmatch(host); len(matches) >= 2 && siteNames[matches[1]] {
			filtered = append(filtered, d)
		}
	}
	return filtered
}

// mergeDomains combines the static and discovered lists, dropping duplicates
// while keeping configured entries ahead of discovered ones. The ranking step
// that follows reorders by health, so this ordering only decides ties.
func (p *DomainPool) mergeDomains(static, dynamic []string) []string {
	seen := make(map[string]bool, len(static)+len(dynamic))
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

var (
	poolRegistryMu sync.RWMutex
	poolRegistry   = make(map[string]*DomainPool)
)

// RegisterDomainPool registers a domain pool for a site in the global
// registry, replacing any previous registration.
func RegisterDomainPool(siteID string, pool *DomainPool) {
	poolRegistryMu.Lock()
	defer poolRegistryMu.Unlock()
	poolRegistry[siteID] = pool
}

// GetRegisteredDomainPool returns the registered pool for a site, or nil.
func GetRegisteredDomainPool(siteID string) *DomainPool {
	poolRegistryMu.RLock()
	defer poolRegistryMu.RUnlock()
	return poolRegistry[siteID]
}

// GetAllRegisteredDomainPools returns every registered pool, keyed by site ID.
// Exposed for diagnostics so a single call can enumerate domain health across
// all sites.
func GetAllRegisteredDomainPools() map[string]*DomainPool {
	poolRegistryMu.RLock()
	defer poolRegistryMu.RUnlock()

	out := make(map[string]*DomainPool, len(poolRegistry))
	for k, v := range poolRegistry {
		out[k] = v
	}
	return out
}

// DomainsForSite returns the ranked, health-aware domain list for a site,
// creating a pool on first use for sites whose provider does not register one.
// This is the single entry point call sites should use: it covers pooled sites
// (which gain publisher discovery), unpooled sites (which still gain scoring),
// and unknown sites (which fall back to whatever configuration exists).
func DomainsForSite(siteID string) []string {
	if siteID == "" {
		return nil
	}
	if pool := ensureDomainPool(siteID); pool != nil {
		return pool.GetDomains()
	}
	return nil
}

// ensureDomainPool returns the site's pool, building one from configuration
// when the provider did not register it, so unpooled sites still get health
// scoring.
func ensureDomainPool(siteID string) *DomainPool {
	if pool := GetRegisteredDomainPool(siteID); pool != nil {
		return pool
	}

	ds := sites.GetSiteDataStore()
	mod, ok := ds.GetModuleConfig(siteID)
	if !ok || len(mod.Domains) == 0 {
		return nil
	}

	pool := NewDomainPool(siteID, mod.Domains, ds.GetPublisherURL(siteID))
	RegisterDomainPool(siteID, pool)
	poolLogger.Debug("Registered domain pool from configuration",
		infra.LogContext{Extra: map[string]any{
			"siteID":  siteID,
			"domains": len(mod.Domains),
		}})
	return pool
}

// RankDomains orders an arbitrary domain list by current health. It lets
// callers that hold a raw configuration list (rather than a pool) share the
// same scoring and load signals as pooled sites.
func RankDomains(domains []string) []string {
	return GetDomainHealthTracker().GetAllDomainsOrdered(domains)
}

// PickDomain chooses one domain from a raw list using the two-candidate
// heuristic, skipping any domain named in exclude. It only reads health
// state, so calling it never changes a domain's counters.
func PickDomain(domains []string, exclude string) string {
	if len(domains) == 0 {
		return ""
	}
	if len(domains) == 1 {
		return domains[0]
	}

	tracker := GetDomainHealthTracker()
	excludeKey := NormalizeDomainKey(exclude)

	best := ""
	bestScore := -1.0
	// Two candidates is enough to route around an outlier while staying
	// O(1) per request; scoring the whole list would allocate on every
	// image of every gallery.
	for attempt := 0; attempt < 2; attempt++ {
		candidate := domains[rand.Intn(len(domains))]
		if NormalizeDomainKey(candidate) == excludeKey {
			continue
		}
		if score := tracker.ScoreOf(candidate); score > bestScore {
			best, bestScore = candidate, score
		}
	}

	if best != "" {
		return best
	}

	ordered := tracker.GetAllDomainsOrdered(domains)
	for _, d := range ordered {
		if NormalizeDomainKey(d) != excludeKey {
			return d
		}
	}
	return ordered[0]
}
