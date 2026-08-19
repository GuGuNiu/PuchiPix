package stealth

import (
	"math/rand"
	"sync"
	"time"

	"backend/internal/infra"
)

const defaultCooldown = 5 * time.Minute

// DomainHealthTracker tracks rate-limit status for domains, enabling
// prioritized domain selection and cooldown-based failover.
type DomainHealthTracker struct {
	mu            sync.RWMutex
	rateLimitedAt map[string]time.Time
	cooldown      time.Duration
	logger        *infra.Logger
}

// NewDomainHealthTracker creates a tracker with the default 5-minute cooldown.
func NewDomainHealthTracker() *DomainHealthTracker {
	return &DomainHealthTracker{
		rateLimitedAt: make(map[string]time.Time),
		cooldown:      defaultCooldown,
		logger:        infra.NewLogger("DomainHealth"),
	}
}

// MarkRateLimited records that a domain has been rate-limited, starting
// its cooldown period.
func (t *DomainHealthTracker) MarkRateLimited(domain string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rateLimitedAt[domain] = time.Now()
	t.logger.Warn("Domain marked as rate-limited",
		infra.LogContext{Extra: map[string]any{
			"domain":   domain,
			"cooldown": t.cooldown.Seconds(),
		}})
}

// MarkHealthy removes a domain's rate-limit record, restoring it to
// full priority in domain selection.
func (t *DomainHealthTracker) MarkHealthy(domain string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.rateLimitedAt, domain)
}

// GetAllDomainsOrdered returns domains sorted by health: healthy domains
// first (shuffled), then cooling domains by ascending remaining cooldown.
func (t *DomainHealthTracker) GetAllDomainsOrdered(domains []string) []string {
	t.mu.RLock()
	defer t.mu.RUnlock()

	var healthy []string
	var cooling []struct {
		domain    string
		remaining time.Duration
	}

	for _, d := range domains {
		limitedAt, ok := t.rateLimitedAt[d]
		if !ok || time.Since(limitedAt) >= t.cooldown {
			healthy = append(healthy, d)
		} else {
			remaining := t.cooldown - time.Since(limitedAt)
			cooling = append(cooling, struct {
				domain    string
				remaining time.Duration
			}{d, remaining})
		}
	}

	shuffled := ShuffleDomains(healthy)

	for i := 0; i < len(cooling)-1; i++ {
		for j := i + 1; j < len(cooling); j++ {
			if cooling[j].remaining < cooling[i].remaining {
				cooling[i], cooling[j] = cooling[j], cooling[i]
			}
		}
	}

	result := make([]string, 0, len(domains))
	result = append(result, shuffled...)
	for _, c := range cooling {
		result = append(result, c.domain)
	}
	return result
}

// GetBestDomain returns the highest-priority domain, falling back to the
// first input if none are healthy.
func (t *DomainHealthTracker) GetBestDomain(domains []string) string {
	ordered := t.GetAllDomainsOrdered(domains)
	if len(ordered) > 0 {
		return ordered[0]
	}
	if len(domains) > 0 {
		return domains[0]
	}
	return ""
}

// ShuffleDomains rotates the slice from a random start index, providing
// a deterministic-but-varied attempt order per call.
func ShuffleDomains(domains []string) []string {
	if len(domains) <= 1 {
		return append([]string{}, domains...)
	}
	startIdx := rand.Intn(len(domains))
	return append(append([]string{}, domains[startIdx:]...), domains[:startIdx]...)
}

var (
	trackerOnce sync.Once
	trackerInst *DomainHealthTracker
)

// GetDomainHealthTracker returns the shared singleton tracker.
func GetDomainHealthTracker() *DomainHealthTracker {
	trackerOnce.Do(func() {
		trackerInst = NewDomainHealthTracker()
	})
	return trackerInst
}
