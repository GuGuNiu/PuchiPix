package stealth

import (
	"sync"
	"time"

	"backend/internal/infra"
)

const (
	defaultMaxPerDomain     = 4
	defaultProbeThreshold   = 12
	defaultProbeConcurrency = 4
	defaultProbeTimeout     = 5 * time.Second
	defaultProbeWindow      = 10 * time.Second
	defaultMinSiteCapacity  = 8
	defaultMaxSiteCapacity  = 32
	defaultMinSiteRate      = 5.0
	defaultMaxSiteRate      = 20.0
)

// DomainAdmissionConfig tunes the per-domain admission gate.
type DomainAdmissionConfig struct {
	// MaxPerDomain caps concurrent DAG nodes admitted onto one domain.
	MaxPerDomain int
	// ProbeThreshold is the number of admissions within ProbeWindow that
	// triggers a health probe of the site's whole domain list.
	ProbeThreshold int
	// ProbeConcurrency bounds simultaneous probe requests.
	ProbeConcurrency int
	// ProbeTimeout bounds a single probe request.
	ProbeTimeout time.Duration
	// ProbeWindow is the sliding window ProbeThreshold is measured over.
	ProbeWindow time.Duration
	// MinSiteCapacity, MaxSiteCapacity and MinSiteRate, MaxSiteRate bound the
	// per-site token bucket, whose size scales with the number of available
	// domains. The floors matter: this bucket exists to stop one site
	// consuming the whole global budget, so it must never be the tighter of
	// the two limits. Sizing it below the global controller's own rate would
	// turn it into a throughput ceiling.
	MinSiteCapacity int
	MaxSiteCapacity int
	MinSiteRate     float64
	MaxSiteRate     float64
}

func DefaultDomainAdmissionConfig() DomainAdmissionConfig {
	return DomainAdmissionConfig{
		MaxPerDomain:     defaultMaxPerDomain,
		ProbeThreshold:   defaultProbeThreshold,
		ProbeConcurrency: defaultProbeConcurrency,
		ProbeTimeout:     defaultProbeTimeout,
		ProbeWindow:      defaultProbeWindow,
		MinSiteCapacity:  defaultMinSiteCapacity,
		MaxSiteCapacity:  defaultMaxSiteCapacity,
		MinSiteRate:      defaultMinSiteRate,
		MaxSiteRate:      defaultMaxSiteRate,
	}
}

// siteTokenBucket is a per-site admission budget. Sizing it by domain count
// keeps a wide mirror pool from being throttled as hard as a single-domain
// site, and stops one site from consuming the whole global budget.
type siteTokenBucket struct {
	mu       sync.Mutex
	tokens   float64
	capacity float64
	rate     float64
	last     time.Time
}

func newSiteTokenBucket(domains int, minCap, maxCap int, minRate, maxRate float64) *siteTokenBucket {
	capacity := float64(2 * domains)
	if capacity < float64(minCap) {
		capacity = float64(minCap)
	}
	if capacity > float64(maxCap) {
		capacity = float64(maxCap)
	}
	rate := float64(domains)
	if rate < minRate {
		rate = minRate
	}
	if rate > maxRate {
		rate = maxRate
	}
	return &siteTokenBucket{
		tokens:   capacity,
		capacity: capacity,
		rate:     rate,
		last:     time.Now(),
	}
}

func (b *siteTokenBucket) tryAcquire(now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	if elapsed := now.Sub(b.last); elapsed > 0 {
		b.tokens += elapsed.Seconds() * b.rate
		if b.tokens > b.capacity {
			b.tokens = b.capacity
		}
		b.last = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (b *siteTokenBucket) release() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.tokens < b.capacity {
		b.tokens++
	}
}

func (b *siteTokenBucket) level() float64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.capacity <= 0 {
		return 0
	}
	return b.tokens / b.capacity
}

// siteAdmissionState tracks one site's reservations and burst window.
type siteAdmissionState struct {
	// mu guards reserved and window. The bucket carries its own lock because
	// it is read on the hot admission path independently of the maps.
	mu     sync.Mutex
	bucket *siteTokenBucket
	// reserved counts admitted-but-not-yet-released nodes per domain, keyed
	// by normalized host. Kept separate from the tracker's per-request
	// in-flight count: one node fans out into many HTTP requests, so the two
	// granularities must not share a counter.
	reserved map[string]int
	window   []time.Time
	probing  bool
}

// DomainAdmissionController gates DAG node admission on per-domain capacity.
//
// It is the domain-scoped counterpart to the global FlowController token
// bucket: the flow controller limits how fast work enters the factory, this
// limits how much of that work lands on any single domain. Rejection is
// non-blocking and leaves the node QUEUED, matching the existing flow
// controller contract, so the auto-reactivation ticker re-picks the node and
// the fresh pick naturally lands on a different domain.
type DomainAdmissionController struct {
	mu       sync.Mutex
	cfg      DomainAdmissionConfig
	sites    map[string]*siteAdmissionState
	tracker  *DomainHealthTracker
	prober   *DomainProber
	admitted int64
	rejected int64
	forced   int64
	logger   *infra.Logger
}

// NewDomainAdmissionController creates the controller. Passing the zero
// config uses DefaultDomainAdmissionConfig.
func NewDomainAdmissionController(cfg DomainAdmissionConfig) *DomainAdmissionController {
	if cfg.MaxPerDomain <= 0 {
		cfg = DefaultDomainAdmissionConfig()
	}
	c := &DomainAdmissionController{
		cfg:     cfg,
		sites:   make(map[string]*siteAdmissionState),
		tracker: GetDomainHealthTracker(),
		logger:  infra.NewLogger("DomainAdmission"),
	}
	c.prober = NewDomainProber(ProbeConfig{
		Concurrency: cfg.ProbeConcurrency,
		Timeout:     cfg.ProbeTimeout,
	})
	return c
}

// Configure applies a new configuration. The load reference on the health
// tracker is kept in step with the per-domain cap so routing scores and
// admission limits agree on what "saturated" means.
func (c *DomainAdmissionController) Configure(cfg DomainAdmissionConfig) {
	if cfg.MaxPerDomain <= 0 {
		return
	}
	c.mu.Lock()
	c.cfg = cfg
	c.mu.Unlock()

	c.tracker.SetLoadReference(cfg.MaxPerDomain)
	c.prober.Configure(ProbeConfig{Concurrency: cfg.ProbeConcurrency, Timeout: cfg.ProbeTimeout})
}

var (
	admissionOnce sync.Once
	admissionInst *DomainAdmissionController
)

// GetDomainAdmissionController returns the shared admission controller, for
// diagnostics endpoints that need to read its counters without holding a
// direct reference.
func GetDomainAdmissionController() *DomainAdmissionController {
	admissionOnce.Do(func() {
		admissionInst = NewDomainAdmissionController(DefaultDomainAdmissionConfig())
	})
	return admissionInst
}

// TryAdmit reserves capacity on one of the site's domains. It returns the
// chosen domain and true when the node may proceed, or an empty domain and
// false when admission was denied. An unknown site or a site with no domains
// is always admitted, since there is nothing to balance against.
//
// The returned domain is the reservation's identity: callers must pass the
// same value to Release once the node finishes.
func (c *DomainAdmissionController) TryAdmit(siteID string) (string, bool) {
	if siteID == "" {
		return "", true
	}

	domains := DomainsForSite(siteID)
	if len(domains) == 0 {
		return "", true
	}

	state := c.stateFor(siteID, len(domains))
	now := time.Now()

	if !state.bucket.tryAcquire(now) {
		c.mu.Lock()
		c.rejected++
		c.mu.Unlock()
		return "", false
	}

	chosen, forced := c.reserve(state, domains)
	if chosen == "" {
		state.bucket.release()
		c.mu.Lock()
		c.rejected++
		c.mu.Unlock()
		c.logger.Debug("Domain admission denied, node stays queued",
			infra.LogContext{Extra: map[string]any{
				"siteId":  siteID,
				"domains": len(domains),
			}})
		return "", false
	}

	c.mu.Lock()
	c.admitted++
	if forced {
		c.forced++
	}
	c.mu.Unlock()

	c.maybeProbe(state, siteID, domains, now)
	return chosen, true
}

// Release returns a reservation taken by TryAdmit.
func (c *DomainAdmissionController) Release(siteID, domain string) {
	if siteID == "" || domain == "" {
		return
	}
	key := NormalizeDomainKey(domain)
	if key == "" {
		return
	}

	c.mu.Lock()
	state, ok := c.sites[siteID]
	c.mu.Unlock()
	if !ok {
		return
	}

	state.bucket.release()
	c.tracker.DecInflight(domain)

	state.mu.Lock()
	if state.reserved[key] > 0 {
		state.reserved[key]--
	}
	state.mu.Unlock()
}

// Stats reports admission counters and the per-site domain reservation
// breakdown, for diagnostics.
func (c *DomainAdmissionController) Stats() map[string]any {
	c.mu.Lock()
	cfg := c.cfg
	admitted := c.admitted
	rejected := c.rejected
	forced := c.forced
	sites := make(map[string]*siteAdmissionState, len(c.sites))
	for k, v := range c.sites {
		sites[k] = v
	}
	c.mu.Unlock()

	perSite := make(map[string]any, len(sites))
	for siteID, state := range sites {
		state.mu.Lock()
		reserved := make(map[string]int, len(state.reserved))
		total := 0
		for k, v := range state.reserved {
			if v > 0 {
				reserved[k] = v
				total += v
			}
		}
		state.mu.Unlock()
		perSite[siteID] = map[string]any{
			"reservedTotal":    total,
			"reservedByDomain": reserved,
			"tokenLevel":       round4(state.bucket.level()),
		}
	}

	return map[string]any{
		"maxPerDomain":   cfg.MaxPerDomain,
		"admittedTotal":  admitted,
		"rejectedTotal":  rejected,
		"forcedTotal":    forced,
		"probeThreshold": cfg.ProbeThreshold,
		"sites":          perSite,
	}
}

// Load reports the highest reservation ratio across all sites and domains,
// normalized to 0..1 for backpressure sampling.
func (c *DomainAdmissionController) Load() float64 {
	c.mu.Lock()
	cfg := c.cfg
	sites := make(map[string]*siteAdmissionState, len(c.sites))
	for k, v := range c.sites {
		sites[k] = v
	}
	c.mu.Unlock()

	if cfg.MaxPerDomain <= 0 {
		return 0
	}

	worst := 0
	for _, state := range sites {
		state.mu.Lock()
		for _, v := range state.reserved {
			if v > worst {
				worst = v
			}
		}
		state.mu.Unlock()
	}
	ratio := float64(worst) / float64(cfg.MaxPerDomain)
	if ratio > 1 {
		ratio = 1
	}
	return ratio
}

// stateFor returns the per-site state, creating it sized to the site's
// current domain count on first use.
func (c *DomainAdmissionController) stateFor(siteID string, domainCount int) *siteAdmissionState {
	c.mu.Lock()
	defer c.mu.Unlock()

	if state, ok := c.sites[siteID]; ok {
		return state
	}
	state := &siteAdmissionState{
		bucket:   newSiteTokenBucket(domainCount, c.cfg.MinSiteCapacity, c.cfg.MaxSiteCapacity, c.cfg.MinSiteRate, c.cfg.MaxSiteRate),
		reserved: make(map[string]int),
	}
	c.sites[siteID] = state
	return state
}

// reserve picks a domain with spare capacity and registers the load so the
// health score reflects it. When every domain is saturated it falls back to
// the least-loaded one instead of refusing: the global flow controller and the
// slot pool already bound total concurrency, so denying here would starve a
// site whose pool is narrower than its slot allocation. The returned bool
// reports whether the fallback was used.
func (c *DomainAdmissionController) reserve(state *siteAdmissionState, domains []string) (string, bool) {
	state.mu.Lock()
	defer state.mu.Unlock()

	for _, d := range c.tracker.GetAllDomainsOrdered(domains) {
		key := NormalizeDomainKey(d)
		if key == "" {
			continue
		}
		if state.reserved[key] >= c.cfg.MaxPerDomain {
			continue
		}
		// TryIncInflight also rejects a cooling domain and a half-open domain
		// whose single probe is already outstanding, so both constraints are
		// enforced by one call.
		if !c.tracker.TryIncInflight(d) {
			continue
		}
		state.reserved[key]++
		return d, false
	}

	best := ""
	bestKey := ""
	bestReserved := 0
	for _, d := range domains {
		key := NormalizeDomainKey(d)
		if key == "" {
			continue
		}
		if best == "" || state.reserved[key] < bestReserved {
			best, bestKey, bestReserved = d, key, state.reserved[key]
		}
	}
	if best == "" {
		return "", false
	}
	state.reserved[bestKey]++
	c.tracker.ForceIncInflight(best)
	c.logger.Warn("All domains at capacity, admitting on least loaded domain",
		infra.LogContext{Extra: map[string]any{
			"domain":       best,
			"reserved":     bestReserved,
			"maxPerDomain": c.cfg.MaxPerDomain,
		}})
	return best, true
}

// maybeProbe fires a health probe of the site's domains once admissions in
// the sliding window cross the threshold, so a large batch does not allocate
// every node before any domain has been measured.
func (c *DomainAdmissionController) maybeProbe(state *siteAdmissionState, siteID string, domains []string, now time.Time) {
	c.mu.Lock()
	threshold := c.cfg.ProbeThreshold
	window := c.cfg.ProbeWindow
	c.mu.Unlock()

	if threshold <= 0 {
		return
	}

	state.mu.Lock()
	cutoff := now.Add(-window)
	kept := state.window[:0]
	for _, at := range state.window {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	state.window = append(kept, now)
	fire := len(state.window) >= threshold && !state.probing
	if fire {
		state.probing = true
	}
	state.mu.Unlock()

	if !fire {
		return
	}

	c.prober.Probe(siteID, domains, func() {
		state.mu.Lock()
		state.probing = false
		state.mu.Unlock()
	})
}
