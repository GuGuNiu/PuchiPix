package urlutil

import (
	"net/url"
	"strings"

	"backend/internal/sites"
)

// TaskRoute identifies which DAG pipeline should handle a given URL.
type TaskRoute string

const (
	RouteGallery TaskRoute = "gallery"
	RouteVideo   TaskRoute = "video"
	RouteSniff   TaskRoute = "sniff"
	RouteUnknown TaskRoute = "unknown"
)

// RouteResult is the output of the URL preprocessing pipeline, carrying the
// normalization, decoding, routing, and domain-pool data the DAG factory and
// executors need for a user-submitted URL.
type RouteResult struct {
	// RawURL is the original user-submitted URL, cleaned of invisible
	// characters but otherwise unmodified.
	RawURL string

	// NormalizedURL is the canonical form used for deduplication and
	// DB storage: lowercased host, https scheme, sorted query, no
	// fragment, no trailing slashes.
	NormalizedURL string

	// IsM3U8 reports whether the URL (after cleaning) looks like an
	// M3U8/HLS stream URL. When true, the task is always routed to
	// the video pipeline regardless of site module type.
	IsM3U8 bool

	// SiteID is the matched site module's ID (e.g. "kanav", "aimeizizi").
	// Empty when no registered provider matched the URL.
	SiteID string

	// SiteType is the matched site module's type field ("photo" or "video").
	// Defaults to "photo" for legacy providers without a module config.
	SiteType string

	// IsListingPage reports whether the URL points to a search/listing
	// page (as opposed to a detail page). When true, the task should
	// be routed to the sniff pipeline for listing-page capture.
	IsListingPage bool

	// Route is the final task routing decision: gallery, video, sniff,
	// or unknown.
	Route TaskRoute

	// RefererDomains is the list of candidate Referer domains for CDN
	// anti-hotlink bypass. It includes the source page's domain and all
	// configured mirror domains for the site. Downloaders use these as
	// fallback Referers when a CDN returns 403.
	RefererDomains []string

	// Provider is the matched SiteProvider, if any.
	Provider sites.SiteProvider
}

// NormalizeAndRoute is the single entry point for the URL preprocessing
// pipeline. It takes a raw user-submitted URL and returns a fully
// resolved RouteResult containing all routing, normalization, and
// Referer-domain data needed by the DAG factory and executors.
//
// siteReg may be nil, in which case only M3U8 detection and URL normalization
// run — the result will have Route=RouteVideo (if M3U8) or RouteUnknown.
func NormalizeAndRoute(rawURL string, siteReg *sites.SiteRegistry) *RouteResult {
	result := &RouteResult{RawURL: rawURL}

	cleaned := CleanURL(rawURL)
	normalized := NormalizeURL(cleaned)
	result.NormalizedURL = normalized

	// M3U8 URLs route to video regardless of the matched site type because
	// they point at CDN streams rather than site pages.
	result.IsM3U8 = IsM3U8URL(cleaned)
	if result.IsM3U8 && siteReg == nil {
		result.Route = RouteVideo
		return result
	}

	if siteReg == nil {
		if result.IsM3U8 {
			result.Route = RouteVideo
		} else {
			result.Route = RouteUnknown
		}
		return result
	}

	// Providers are checked in registration order for deterministic results.
	provider, providerOk := siteReg.GetProviderByUrl(cleaned)
	if !providerOk {
		if result.IsM3U8 {
			result.Route = RouteVideo
		} else {
			result.Route = RouteUnknown
		}
		return result
	}

	result.Provider = provider
	result.SiteID = provider.SiteID()

	// The listing-page check runs before the photo/video branching so that
	// video-type sites can still route their search pages to the sniff flow.
	if listProvider, ok := provider.(interface {
		IsListingPage(url string) bool
	}); ok && listProvider.IsListingPage(cleaned) {
		result.IsListingPage = true
		result.Route = RouteSniff
		result.RefererDomains = collectRefererDomains(cleaned, siteReg, result.SiteID)
		return result
	}

	siteType := "photo"
	if mod, modOk := siteReg.GetModule(provider.SiteID()); modOk && mod.Type != "" {
		siteType = mod.Type
	}
	result.SiteType = siteType

	if siteType == "photo" {
		if _, isGallery := provider.(sites.GallerySiteProvider); isGallery {
			result.Route = RouteGallery
		} else {
			result.Route = RouteUnknown
		}
	} else {
		result.Route = RouteVideo
	}

	result.RefererDomains = collectRefererDomains(cleaned, siteReg, result.SiteID)

	return result
}

// collectRefererDomains builds the Referer fallback pool: the source page's
// own domain first, then the site's configured mirror domains in order.
func collectRefererDomains(pageURL string, siteReg *sites.SiteRegistry, siteID string) []string {
	var domains []string

	if parsed, err := url.Parse(pageURL); err == nil && parsed.Hostname() != "" {
		domains = append(domains, parsed.Hostname())
	}

	if siteReg != nil && siteID != "" {
		if mod, ok := siteReg.GetModule(siteID); ok {
			for _, d := range mod.Domains {
				host := extractDomainHost(d)
				if host == "" || containsString(domains, host) {
					continue
				}
				domains = append(domains, host)
			}
		}
	}

	return domains
}

// extractDomainHost normalizes a domain entry that may carry a scheme, a path,
// and a port, returning only the lowercase hostname.
func extractDomainHost(domain string) string {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return ""
	}
	if strings.HasPrefix(domain, "https://") {
		domain = strings.TrimPrefix(domain, "https://")
	} else if strings.HasPrefix(domain, "http://") {
		domain = strings.TrimPrefix(domain, "http://")
	}
	if slashIdx := strings.IndexByte(domain, '/'); slashIdx >= 0 {
		domain = domain[:slashIdx]
	}
	if colonIdx := strings.IndexByte(domain, ':'); colonIdx >= 0 {
		domain = domain[:colonIdx]
	}
	return strings.ToLower(domain)
}

func containsString(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
