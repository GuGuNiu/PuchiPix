package api

import (
	"net/http"
	"sort"
	"time"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var domainsLogger = infra.NewLogger("DomainHealth")

// DomainPoolStatus reports one site's domain pool.
type DomainPoolStatus struct {
	SiteID          string   `json:"siteId"`
	Registered      bool     `json:"registered"`
	PublisherURL    string   `json:"publisherUrl"`
	DiscoveredCount int      `json:"discoveredCount"`
	LastFetch       string   `json:"lastFetch,omitempty"`
	CacheExpired    bool     `json:"cacheExpired"`
	Domains         []string `json:"domains"`
}

// Domains returns the health score of every observed domain together with each
// site's pool state, so routing behaviour can be explained after the fact
// rather than inferred from logs.
func (h *Handlers) Domains(w http.ResponseWriter, r *http.Request) {
	tracker := stealth.GetDomainHealthTracker()
	pools := stealth.GetAllRegisteredDomainPools()

	snapshots := tracker.Snapshot()
	byDomain := make(map[string]stealth.DomainHealthSnapshot, len(snapshots))
	for _, s := range snapshots {
		byDomain[s.Domain] = s
	}

	// Report every configured site, not just those with a registered pool, so
	// a site that has never served a request is visible as such.
	ds := sites.GetSiteDataStore()
	siteIDs := make([]string, 0, len(ds.GetAllModuleConfigs()))
	configured := make(map[string]bool)
	for _, mod := range ds.GetAllModuleConfigs() {
		if mod.ID == "universal" {
			continue
		}
		siteIDs = append(siteIDs, mod.ID)
		configured[mod.ID] = true
	}
	for siteID := range pools {
		if !configured[siteID] {
			siteIDs = append(siteIDs, siteID)
		}
	}
	sort.Strings(siteIDs)

	poolStatuses := make([]DomainPoolStatus, 0, len(siteIDs))
	for _, siteID := range siteIDs {
		status := DomainPoolStatus{SiteID: siteID, Domains: []string{}}
		domains := stealth.DomainsForSite(siteID)
		status.Domains = domains
		if pool, ok := pools[siteID]; ok {
			status.Registered = true
			count, lastFetch, expired := pool.GetCacheInfo()
			status.DiscoveredCount = count
			status.CacheExpired = expired
			if !lastFetch.IsZero() {
				status.LastFetch = lastFetch.UTC().Format(time.RFC3339)
			}
		}
		poolStatuses = append(poolStatuses, status)
	}

	admission := map[string]any(nil)
	if gate := stealth.GetDomainAdmissionController(); gate != nil {
		admission = gate.Stats()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"domains":         snapshots,
		"pools":           poolStatuses,
		"admission":       admission,
		"cooldownBaseSec": tracker.CooldownBase().Seconds(),
		"loadReference":   tracker.LoadReference(),
		"sampledAt":       time.Now().UTC().Format(time.RFC3339),
	})
}

// DomainProbe triggers an on-demand health probe of one site's domains. It
// returns immediately; the probe runs in the background and its effect is
// visible on GET /api/domains.
func (h *Handlers) DomainProbe(w http.ResponseWriter, r *http.Request) {
	siteID := r.URL.Query().Get("siteId")
	if siteID == "" {
		writeError(w, http.StatusBadRequest, "siteId query parameter is required")
		return
	}

	domains := stealth.DomainsForSite(siteID)
	if len(domains) == 0 {
		writeError(w, http.StatusNotFound, "no domains configured for site: "+siteID)
		return
	}

	stealth.GetDomainProber().Probe(siteID, domains, nil)
	domainsLogger.Info("Manual domain probe requested",
		infra.LogContext{Extra: map[string]any{
			"siteId":  siteID,
			"domains": len(domains),
		}})

	writeJSON(w, http.StatusAccepted, map[string]any{
		"siteId":  siteID,
		"domains": len(domains),
		"status":  "probe started",
	})
}
