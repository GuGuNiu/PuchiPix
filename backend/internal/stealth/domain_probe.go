package stealth

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"backend/internal/infra"
)

// ProbeConfig tunes the domain health prober.
type ProbeConfig struct {
	// Concurrency bounds simultaneous probe requests across all sites.
	Concurrency int
	// Timeout bounds a single probe request.
	Timeout time.Duration
}

// DomainProber measures whether a site's domains are reachable and how fast
// they answer, so a large batch can allocate across a known-good pool instead
// of discovering dead mirrors one failed task at a time.
//
// A probe treats any HTTP response as a success: a 403 or 500 still proves the
// host is reachable, and reachability plus latency is what routing needs. Only
// dial failures, TLS errors and timeouts count as failures.
type DomainProber struct {
	mu      sync.Mutex
	cfg     ProbeConfig
	sem     chan struct{}
	running map[string]bool
	client  *http.Client
	tracker *DomainHealthTracker
	logger  *infra.Logger
}

func NewDomainProber(cfg ProbeConfig) *DomainProber {
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = defaultProbeConcurrency
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultProbeTimeout
	}

	return &DomainProber{
		cfg:     cfg,
		sem:     make(chan struct{}, cfg.Concurrency),
		running: make(map[string]bool),
		client: &http.Client{
			Timeout: cfg.Timeout,
			// Probes only need to know the host answered; following
			// redirects would pull in a different domain's latency.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		tracker: GetDomainHealthTracker(),
		logger:  infra.NewLogger("DomainProbe"),
	}
}

// Configure applies new limits. An in-flight probe batch keeps the limits it
// started with.
func (p *DomainProber) Configure(cfg ProbeConfig) {
	if cfg.Concurrency > 0 {
		p.mu.Lock()
		p.cfg.Concurrency = cfg.Concurrency
		p.sem = make(chan struct{}, cfg.Concurrency)
		p.mu.Unlock()
	}
	if cfg.Timeout > 0 {
		p.mu.Lock()
		p.cfg.Timeout = cfg.Timeout
		p.client.Timeout = cfg.Timeout
		p.mu.Unlock()
	}
}

// Probe measures every supplied domain concurrently and folds the results into
// the shared health tracker. It is a no-op when a probe for the same site is
// already running. onDone runs after the batch completes, whether or not it
// observed anything.
func (p *DomainProber) Probe(siteID string, domains []string, onDone func()) {
	if len(domains) == 0 {
		if onDone != nil {
			onDone()
		}
		return
	}

	p.mu.Lock()
	if p.running[siteID] {
		p.mu.Unlock()
		if onDone != nil {
			onDone()
		}
		return
	}
	p.running[siteID] = true
	timeout := p.cfg.Timeout
	concurrency := p.cfg.Concurrency
	p.mu.Unlock()

	targets := make([]string, len(domains))
	copy(targets, domains)

	go func() {
		defer func() {
			p.mu.Lock()
			delete(p.running, siteID)
			p.mu.Unlock()
			if onDone != nil {
				onDone()
			}
		}()

		// A dedicated semaphore per batch: the shared one would let a probe
		// for one site occupy every slot and starve the others.
		sem := make(chan struct{}, concurrency)

		var wg sync.WaitGroup
		for _, d := range targets {
			wg.Add(1)
			go func(domain string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				p.probeOne(domain, timeout)
			}(d)
		}
		wg.Wait()

		p.logger.Info("Domain health probe completed",
			infra.LogContext{Extra: map[string]any{
				"siteId":  siteID,
				"domains": len(targets),
			}})
	}()
}

func (p *DomainProber) probeOne(domain string, timeout time.Duration) {
	target := domain
	if target == "" {
		return
	}
	// Configured entries are bare hosts for some sites and full origins for
	// others; the tracker needs one of them, the request needs the other.
	if !strings.Contains(target, "://") {
		target = "https://" + target
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	profile := RandomProfile()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		p.tracker.ReportOutcome(domain, 0, err)
		return
	}
	req.Header = BuildStealthHeaders(profile, "")
	req.Header.Del("Accept-Encoding")

	start := time.Now()
	resp, err := p.client.Do(req)
	rtt := time.Since(start)
	if err != nil {
		p.tracker.ReportOutcome(domain, rtt, err)
		p.logger.Warn("Domain probe failed",
			infra.LogContext{Extra: map[string]any{
				"domain": NormalizeDomainKey(domain),
				"rttMs":  rtt.Milliseconds(),
				"error":  err.Error(),
			}})
		return
	}
	// Draining is unnecessary for a reachability check, but the connection
	// must be released before the body is closed for reuse.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()

	p.tracker.ReportOutcome(domain, rtt, nil)
	p.logger.Debug("Domain probe succeeded",
		infra.LogContext{Extra: map[string]any{
			"domain":     NormalizeDomainKey(domain),
			"rttMs":      rtt.Milliseconds(),
			"statusCode": resp.StatusCode,
		}})
}

// ProbeSiteDomains measures a site's domains on demand, outside the
// admission-triggered path. Used by diagnostics and manual refresh.
func ProbeSiteDomains(siteID string) []DomainHealthSnapshot {
	domains := DomainsForSite(siteID)
	if len(domains) == 0 {
		return nil
	}

	prober := GetDomainProber()
	prober.Probe(siteID, domains, nil)
	return GetDomainHealthTracker().Snapshot()
}

var (
	proberOnce sync.Once
	proberInst *DomainProber
)

func GetDomainProber() *DomainProber {
	proberOnce.Do(func() {
		proberInst = NewDomainProber(ProbeConfig{})
	})
	return proberInst
}
