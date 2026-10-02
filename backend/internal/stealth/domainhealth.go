package stealth

import (
	"errors"
	"math"
	"math/rand"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"backend/internal/infra"
)

const (
	defaultCooldown = 5 * time.Minute
	maxCooldown     = 40 * time.Minute
	// maxCooldownTier caps the exponential escalation. Tier 0 is the base
	// cooldown, so the sequence is 5m / 10m / 20m / 40m and then flat.
	maxCooldownTier = 3

	// EWMA smoothing factors. Low values react slowly and suppress
	// single-request noise; high values oscillate on every blip.
	latencySmoothing = 0.3
	errorSmoothing   = 0.3

	// latencyReference is the round-trip time at which the latency
	// component of the score falls to 0.5.
	latencyReference = 2 * time.Second

	// defaultLoadReference matches the default per-domain concurrency cap
	// so the load component reads 0.5 at saturation. The admission
	// controller updates it when the configured cap differs.
	defaultLoadReference = 4
	loadPenaltyWeight    = 0.6

	// scoreJitter breaks near-ties randomly. Without it every task would
	// rank identical domains identically and repeatedly pick the same one.
	scoreJitter = 0.05

	// halfOpenScoreFactor demotes a domain whose cooldown just expired so
	// it is tried after fully healthy domains but before cooling ones.
	halfOpenScoreFactor = 0.25

	sweepInterval = 5 * time.Minute
)

// errRateLimited is the synthetic failure recorded by MarkRateLimited, so
// callers that only know "this domain refused us" still feed the error-rate
// EWMA without inventing an error value at each site.
var errRateLimited = errors.New("domain rate limited")

// ErrEmptyResponse marks a reply that arrived intact but carried no content.
// It is exported because several scraping paths need to distinguish "the host
// refused or was unreachable" from "the host answered with nothing usable",
// and the health score should reflect that difference.
var ErrEmptyResponse = errors.New("response contained no usable content")

// domainHealth holds the live quality signals for one domain. All fields are
// guarded by DomainHealthTracker.mu.
type domainHealth struct {
	ewmaLatency   time.Duration
	ewmaErrorRate float64
	consecFail    int
	cooldownTier  int
	inflight      int
	totalRequests int64
	totalFailures int64
	cooldownUntil time.Time
	lastSeen      time.Time
}

// coolingRemaining reports how long the domain stays unusable. Zero means
// the cooldown has expired (or was never entered) and the domain is eligible
// again.
func (h *domainHealth) coolingRemaining(now time.Time) time.Duration {
	if h.cooldownUntil.IsZero() || !now.Before(h.cooldownUntil) {
		return 0
	}
	return h.cooldownUntil.Sub(now)
}

// halfOpen reports whether the domain served a failure recently but has since
// served its cooldown. Such a domain gets exactly one probe request before
// the rest of the pool, so a persistent block is detected without keeping the
// domain out of rotation indefinitely.
func (h *domainHealth) halfOpen(now time.Time) bool {
	return h.consecFail > 0 && h.coolingRemaining(now) == 0
}

type DomainHealthState string

const (
	StateHealthy  DomainHealthState = "healthy"
	StateHalfOpen DomainHealthState = "half_open"
	StateCooling  DomainHealthState = "cooling"
)

// DomainHealthSnapshot is a point-in-time reading of one domain.
type DomainHealthSnapshot struct {
	Domain              string            `json:"domain"`
	State               DomainHealthState `json:"state"`
	Score               float64           `json:"score"`
	AvgLatencyMs        int64             `json:"avgLatencyMs"`
	ErrorRate           float64           `json:"errorRate"`
	Inflight            int               `json:"inflight"`
	ConsecutiveFailures int               `json:"consecutiveFailures"`
	CooldownTier        int               `json:"cooldownTier"`
	CooldownRemainingMs int64             `json:"cooldownRemainingMs"`
	TotalRequests       int64             `json:"totalRequests"`
	TotalFailures       int64             `json:"totalFailures"`
	LastSeen            time.Time         `json:"lastSeen"`
}

// DomainHealthTracker scores domains on observed latency, error rate and
// current load, and applies escalating cooldowns so selection adapts to
// degradation instead of only to hard failure.
//
// MarkRateLimited and MarkHealthy remain the primary entry points for
// existing callers; ReportOutcome is the richer form that additionally
// folds in round-trip time.
type DomainHealthTracker struct {
	mu        sync.RWMutex
	domains   map[string]*domainHealth
	cooldown  time.Duration
	loadRef   int
	lastSweep time.Time
	logger    *infra.Logger
}

// NewDomainHealthTracker creates a tracker with the default 5-minute base
// cooldown.
func NewDomainHealthTracker() *DomainHealthTracker {
	return &DomainHealthTracker{
		domains:  make(map[string]*domainHealth),
		cooldown: defaultCooldown,
		loadRef:  defaultLoadReference,
		logger:   infra.NewLogger("DomainHealth"),
	}
}

// SetCooldown changes the base cooldown that escalation multiplies.
func (t *DomainHealthTracker) SetCooldown(d time.Duration) {
	if d <= 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cooldown = d
}

// SetLoadReference sets the in-flight count at which the load component of
// the score reaches 0.5. Callers align it with the per-domain concurrency
// cap so load and admission agree on what "busy" means.
func (t *DomainHealthTracker) SetLoadReference(n int) {
	if n <= 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadRef = n
}

func (t *DomainHealthTracker) LoadReference() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.loadRef
}

func (t *DomainHealthTracker) CooldownBase() time.Duration {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.cooldown
}

// NormalizeDomainKey reduces a domain or full URL to a canonical host key so
// the scrape layer (which passes configured domain strings) and the download
// layer (which passes scheme://host prefixes) share one health record per
// host.
func NormalizeDomainKey(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return ""
	}
	return strings.TrimPrefix(host, "www.")
}

// ReportOutcome records one request against a domain. A nil error clears the
// failure streak and folds the round-trip time into the latency EWMA; a
// non-nil error advances the error-rate EWMA and (re)starts the cooldown at
// the tier matching the current failure streak.
func (t *DomainHealthTracker) ReportOutcome(domain string, rtt time.Duration, err error) {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return
	}

	now := time.Now()

	t.mu.Lock()
	h := t.recordLocked(key, now)
	t.maybeSweepLocked(now)

	if rtt > 0 {
		h.ewmaLatency = ewmaDuration(h.ewmaLatency, rtt, latencySmoothing)
	}

	if err == nil {
		h.consecFail = 0
		h.cooldownTier = 0
		h.cooldownUntil = time.Time{}
		h.ewmaErrorRate *= 1 - errorSmoothing
		t.mu.Unlock()
		return
	}

	h.totalFailures++
	h.consecFail++
	h.ewmaErrorRate = h.ewmaErrorRate*(1-errorSmoothing) + errorSmoothing
	// Escalate after computing the window so a first failure still costs the
	// documented base cooldown rather than double it.
	h.cooldownUntil = now.Add(t.escalateLocked(h.cooldownTier))
	if h.cooldownTier < maxCooldownTier {
		h.cooldownTier++
	}
	// Snapshot the log fields before releasing the lock.
	cooldown := h.cooldownUntil.Sub(now)
	tier := h.cooldownTier
	errorRate := h.ewmaErrorRate
	score := t.scoreLocked(h, now)
	t.mu.Unlock()

	t.logger.Warn("Domain marked as rate-limited",
		infra.LogContext{Extra: map[string]any{
			"domain":          key,
			"cooldownSeconds": cooldown.Seconds(),
			"tier":            tier,
			"errorRate":       errorRate,
			"score":           score,
		}})
}

// MarkRateLimited records a failure without a latency sample. Use it when the
// caller knows the domain refused the request but not how long it took.
func (t *DomainHealthTracker) MarkRateLimited(domain string) {
	t.ReportOutcome(domain, 0, errRateLimited)
}

// MarkHealthy records a success without a latency sample. A prior failure
// streak and any active cooldown are cleared, but the EWMA history is kept so
// a domain that was merely slow does not look pristine after one lucky hit.
func (t *DomainHealthTracker) MarkHealthy(domain string) {
	t.ReportOutcome(domain, 0, nil)
}

// TryIncInflight registers one unit of load against a domain and reports
// whether the domain may take it. It returns false while the domain is
// cooling, and while a half-open domain already has its single probe
// outstanding, so a caller can skip a domain without blocking.
//
// In-flight load is the number of tasks currently assigned to the domain, not
// the number of HTTP requests: one task fans out into many requests, and the
// routing decision is made per task, so the coarser measure is the one that
// matches it.
func (t *DomainHealthTracker) TryIncInflight(domain string) bool {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return false
	}

	now := time.Now()

	t.mu.Lock()
	defer t.mu.Unlock()

	h := t.recordLocked(key, now)
	if h.coolingRemaining(now) > 0 {
		return false
	}
	if h.halfOpen(now) && h.inflight > 0 {
		return false
	}
	h.inflight++
	return true
}

// ForceIncInflight registers load regardless of cooling state. The admission
// gate uses it when every domain is at capacity: total concurrency is already
// bounded by the slot pool and the global token bucket, so refusing here would
// stall a site whose mirror pool is narrower than its slot allocation.
func (t *DomainHealthTracker) ForceIncInflight(domain string) {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return
	}

	now := time.Now()

	t.mu.Lock()
	defer t.mu.Unlock()

	t.recordLocked(key, now).inflight++
}

// DecInflight returns one unit of load previously registered by
// TryIncInflight or ForceIncInflight.
func (t *DomainHealthTracker) DecInflight(domain string) {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if h, ok := t.domains[key]; ok && h.inflight > 0 {
		h.inflight--
	}
}

func (t *DomainHealthTracker) Inflight(domain string) int {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return 0
	}

	t.mu.RLock()
	defer t.mu.RUnlock()

	if h, ok := t.domains[key]; ok {
		return h.inflight
	}
	return 0
}

// ScoreOf returns the current 0..1 ranking score for a domain. A domain that
// has never been observed scores the maximum, so newly configured entries are
// tried before degraded known ones.
func (t *DomainHealthTracker) ScoreOf(domain string) float64 {
	key := NormalizeDomainKey(domain)
	if key == "" {
		return 0
	}

	now := time.Now()

	t.mu.RLock()
	defer t.mu.RUnlock()

	h, ok := t.domains[key]
	if !ok {
		return 1
	}
	return t.scoreLocked(h, now)
}

// GetAllDomainsOrdered ranks domains by current score, highest first, with
// cooling domains placed last ordered by how soon they recover. Scores within
// scoreJitter of each other are ordered randomly so concurrent tasks spread
// across comparable mirrors instead of converging on the same one.
//
// The returned strings are the caller's originals; normalization is used only
// for lookup.
func (t *DomainHealthTracker) GetAllDomainsOrdered(domains []string) []string {
	if len(domains) <= 1 {
		return append([]string{}, domains...)
	}

	now := time.Now()
	ranked := make([]scoredDomain, 0, len(domains))

	t.mu.RLock()
	for i, d := range domains {
		key := NormalizeDomainKey(d)
		r := scoredDomain{original: d, index: i}
		if h, ok := t.domains[key]; ok {
			r.score = t.scoreLocked(h, now)
			if remaining := h.coolingRemaining(now); remaining > 0 {
				r.cooling = true
				r.remaining = remaining
			} else if h.halfOpen(now) {
				r.score *= halfOpenScoreFactor
			}
		} else {
			// Never observed: assume fully healthy at the maximum score so a
			// freshly added domain is tried before a degraded known one.
			r.score = 1
		}
		// Jitter is drawn once per domain rather than inside the comparator,
		// which must be a consistent ordering relation for the sort to
		// produce a well-defined result.
		r.rank = r.score + (rand.Float64()-0.5)*scoreJitter
		ranked = append(ranked, r)
	}
	t.mu.RUnlock()

	sort.SliceStable(ranked, func(i, j int) bool {
		a, b := ranked[i], ranked[j]
		if a.cooling != b.cooling {
			return !a.cooling
		}
		if a.cooling {
			// Closest to recovery first, so a domain that just started
			// cooling is preferred over one that entered long ago.
			if a.remaining != b.remaining {
				return a.remaining < b.remaining
			}
			return a.index < b.index
		}
		return a.rank > b.rank
	})

	out := make([]string, 0, len(ranked))
	for _, r := range ranked {
		out = append(out, r.original)
	}
	return out
}

// GetBestDomain returns the highest-scoring domain, or an empty string when
// no domains are supplied. Domains of near-equal score are interchangeable, so
// this is the best available choice rather than a strictly optimal one.
func (t *DomainHealthTracker) GetBestDomain(domains []string) string {
	ordered := t.GetAllDomainsOrdered(domains)
	if len(ordered) > 0 {
		return ordered[0]
	}
	return ""
}

// Snapshot returns a reading for every domain the tracker has observed,
// ordered by score. Domains that only ever succeeded are included so
// diagnostics can distinguish "healthy" from "never tried".
func (t *DomainHealthTracker) Snapshot() []DomainHealthSnapshot {
	now := time.Now()

	t.mu.RLock()
	out := make([]DomainHealthSnapshot, 0, len(t.domains))
	for key, h := range t.domains {
		remaining := h.coolingRemaining(now)
		state := StateHealthy
		switch {
		case remaining > 0:
			state = StateCooling
		case h.halfOpen(now):
			state = StateHalfOpen
		}
		out = append(out, DomainHealthSnapshot{
			Domain:              key,
			State:               state,
			Score:               round4(t.scoreLocked(h, now)),
			AvgLatencyMs:        h.ewmaLatency.Milliseconds(),
			ErrorRate:           round4(h.ewmaErrorRate),
			Inflight:            h.inflight,
			ConsecutiveFailures: h.consecFail,
			CooldownTier:        h.cooldownTier,
			CooldownRemainingMs: remaining.Milliseconds(),
			TotalRequests:       h.totalRequests,
			TotalFailures:       h.totalFailures,
			LastSeen:            h.lastSeen,
		})
	}
	t.mu.RUnlock()

	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Domain < out[j].Domain
	})
	return out
}

// Reset clears all recorded state. Intended for tests and manual recovery
// from a poisoned tracker.
func (t *DomainHealthTracker) Reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.domains = make(map[string]*domainHealth)
	t.lastSweep = time.Time{}
}

// recordLocked returns the record for key, creating it on first sight.
// Callers must hold t.mu.
func (t *DomainHealthTracker) recordLocked(key string, now time.Time) *domainHealth {
	h, ok := t.domains[key]
	if !ok {
		h = &domainHealth{}
		t.domains[key] = h
	}
	h.totalRequests++
	h.lastSeen = now
	return h
}

// maybeSweepLocked drops records untouched long enough that they no longer
// describe any live condition. Without this the map only ever grows, because
// a cooled domain is ignored on read but never removed.
// Callers must hold t.mu.
func (t *DomainHealthTracker) maybeSweepLocked(now time.Time) {
	if now.Sub(t.lastSweep) < sweepInterval {
		return
	}
	t.lastSweep = now
	for key, h := range t.domains {
		if h.inflight == 0 && h.consecFail == 0 && now.Sub(h.lastSeen) > sweepInterval {
			delete(t.domains, key)
		}
	}
}

// escalateLocked returns the cooldown for a failure tier, doubling per tier up
// to maxCooldown. A random fraction is added so a pool that failed together
// does not retry together on the same tick.
// Callers must hold t.mu.
func (t *DomainHealthTracker) escalateLocked(tier int) time.Duration {
	d := t.cooldown << tier
	if d > maxCooldown || d <= 0 {
		d = maxCooldown
	}
	return d + time.Duration(rand.Int63n(int64(d/5)+1))
}

// scoreLocked combines reliability, speed and current load into a 0..1
// ranking signal. Multiplicative composition means any single collapsing
// factor dominates, which matches how a domain actually fails: a fast domain
// that refuses requests is worse than a slow one that works.
// Callers must hold t.mu.
func (t *DomainHealthTracker) scoreLocked(h *domainHealth, now time.Time) float64 {
	reliability := 1 - h.ewmaErrorRate
	if reliability < 0 {
		reliability = 0
	}

	speed := 1 / (1 + float64(h.ewmaLatency)/float64(latencyReference))
	if h.ewmaLatency <= 0 {
		speed = 1
	}

	load := 1 / (1 + loadPenaltyWeight*float64(h.inflight)/float64(t.loadRef))

	score := reliability * speed * load
	if remaining := h.coolingRemaining(now); remaining > 0 {
		// A cooling domain ranks below every healthy one regardless of how
		// good its history looks.
		score *= float64(remaining) / float64(remaining+t.cooldown)
	}
	return math.Min(math.Max(score, 0), 1)
}

// scoredDomain carries a caller's original domain string alongside its
// derived ranking inputs.
type scoredDomain struct {
	original  string
	score     float64
	rank      float64
	cooling   bool
	remaining time.Duration
	index     int
}

func ewmaDuration(current, sample time.Duration, alpha float64) time.Duration {
	if current <= 0 {
		return sample
	}
	return time.Duration(float64(current)*(1-alpha) + float64(sample)*alpha)
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}

var (
	trackerOnce sync.Once
	trackerInst *DomainHealthTracker
)

func GetDomainHealthTracker() *DomainHealthTracker {
	trackerOnce.Do(func() {
		trackerInst = NewDomainHealthTracker()
	})
	return trackerInst
}
