// Package urlutil provides URL normalization, signature extraction, and
// mirror-URL generation utilities for deduplication across mirror domains.
//
// pipeline.go implements the unified URL preprocessing pipeline that
// consolidates all URL-related preprocessing (cleaning, normalization,
// MacCMS decoding, site identification, page-type detection, task routing,
// and Referer injection) into a single entry point. This eliminates the
// historical pattern where URL preprocessing logic was scattered across
// the crawler layer, task loader layer, and downloader layer, causing
// repeated bugs (MacCMS encoding, CDN 403, misrouted tasks).
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

// RouteResult is the output of the URL preprocessing pipeline. It carries
// every piece of information the DAG factory and executors need to process
// a user-submitted URL, eliminating the need for callers to re-derive
// normalization, decoding, or domain-pool data from ad-hoc logic.
type RouteResult struct {
	// RawURL is the original user-submitted URL, cleaned of invisible
	// characters but otherwise unmodified. Useful for error messages
	// and debugging.
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
	// or unknown. This is the single field callers should check to
	// determine which DAG pipeline to create.
	Route TaskRoute

	// RefererDomains is the list of candidate Referer domains for CDN
	// anti-hotlink bypass. It includes the source page's domain and all
	// configured mirror domains for the site. Downloaders use these as
	// fallback Referers when a CDN returns 403.
	RefererDomains []string

	// Provider is the matched SiteProvider, if any. Callers that need
	// to invoke provider-specific methods (e.g. ScrapeGallery) can use
	// this directly instead of re-looking-up by URL.
	Provider sites.SiteProvider
}

// NormalizeAndRoute is the single entry point for the URL preprocessing
// pipeline. It takes a raw user-submitted URL and returns a fully
// resolved RouteResult containing all routing, normalization, and
// Referer-domain data needed by the DAG factory and executors.
//
// The pipeline stages are:
//  1. URL standardization (clean invisible chars, normalize)
//  2. M3U8 detection (determines video routing independent of site type)
//  3. Site module matching (find registered provider by URL)
//  4. Page-type identification (listing page → sniff, detail → gallery/video)
//  5. Task routing decision (gallery / video / sniff / unknown)
//  6. Referer-domain injection (source domain + mirror domains for CDN bypass)
//
// siteReg may be nil, in which case only M3U8 detection and URL normalization
// run — the result will have Route=RouteVideo (if M3U8) or RouteUnknown.
func NormalizeAndRoute(rawURL string, siteReg *sites.SiteRegistry) *RouteResult {
	result := &RouteResult{RawURL: rawURL}

	// Stage 1: URL standardization.
	cleaned := CleanURL(rawURL)
	normalized := NormalizeURL(cleaned)
	result.NormalizedURL = normalized

	// Stage 2: M3U8 detection. An M3U8 URL is always a video task,
	// regardless of which site module matched. This takes priority
	// over site-type-based routing because M3U8 URLs point to CDN
	// streams, not site pages.
	result.IsM3U8 = IsM3U8URL(cleaned)
	if result.IsM3U8 && siteReg == nil {
		result.Route = RouteVideo
		return result
	}

	// No site registry → cannot determine provider/module.
	if siteReg == nil {
		if result.IsM3U8 {
			result.Route = RouteVideo
		} else {
			result.Route = RouteUnknown
		}
		return result
	}

	// Stage 3: Site module matching. Find the registered provider
	// whose CanHandle matches this URL. Providers are checked in
	// registration order for deterministic results.
	provider, providerOk := siteReg.GetProviderByUrl(cleaned)
	if !providerOk {
		// No provider matched. If it's an M3U8 URL, route to video;
		// otherwise the URL is unrecognized.
		if result.IsM3U8 {
			result.Route = RouteVideo
		} else {
			result.Route = RouteUnknown
		}
		return result
	}

	result.Provider = provider
	result.SiteID = provider.SiteID()

	// Stage 4: Page-type identification. Check if the provider
	// recognizes this URL as a listing/search page. This check runs
	// BEFORE the photo/video type branching so video-type sites like
	// kanav can still route search pages to the sniff flow.
	// This fixes the historical bug where IsListingPage was nested
	// inside the siteType=="photo" branch, causing video sites'
	// listing pages to be misrouted as video downloads.
	if listProvider, ok := provider.(interface {
		IsListingPage(url string) bool
	}); ok && listProvider.IsListingPage(cleaned) {
		result.IsListingPage = true
		result.Route = RouteSniff
		result.RefererDomains = collectRefererDomains(cleaned, siteReg, result.SiteID)
		return result
	}

	// Stage 5: Task routing based on site module type.
	siteType := "photo" // default for legacy providers
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
		// Video-type site with a detail page → video download.
		result.Route = RouteVideo
	}

	// Stage 6: Referer-domain injection. Collect the source page's
	// domain and all configured mirror domains so downloaders have
	// a fallback pool for CDN anti-hotlink bypass.
	result.RefererDomains = collectRefererDomains(cleaned, siteReg, result.SiteID)

	return result
}

// collectRefererDomains builds the Referer domain pool for a URL. The
// pool includes the source page's own domain (extracted from the URL)
// and all configured mirror domains for the site. Downloaders use these
// as fallback Referers when a CDN returns 403 Forbidden.
//
// The source page's domain is always first in the list (highest priority),
// followed by mirror domains in their configured order.
func collectRefererDomains(pageURL string, siteReg *sites.SiteRegistry, siteID string) []string {
	var domains []string

	// Extract the source page's own domain.
	if parsed, err := url.Parse(pageURL); err == nil && parsed.Hostname() != "" {
		domains = append(domains, parsed.Hostname())
	}

	// Append configured mirror domains for the site, skipping duplicates.
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

// extractDomainHost extracts the hostname from a domain string that
// may be in "https://domain.com" or bare "domain.com" form.
func extractDomainHost(domain string) string {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return ""
	}
	// Strip scheme if present.
	if strings.HasPrefix(domain, "https://") {
		domain = strings.TrimPrefix(domain, "https://")
	} else if strings.HasPrefix(domain, "http://") {
		domain = strings.TrimPrefix(domain, "http://")
	}
	// Strip path if present.
	if slashIdx := strings.IndexByte(domain, '/'); slashIdx >= 0 {
		domain = domain[:slashIdx]
	}
	// Strip port if present.
	if colonIdx := strings.IndexByte(domain, ':'); colonIdx >= 0 {
		domain = domain[:colonIdx]
	}
	return strings.ToLower(domain)
}

// containsString reports whether the slice contains the target string.
func containsString(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
