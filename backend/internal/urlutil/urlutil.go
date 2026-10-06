// Package urlutil provides URL normalization, signature extraction, and
// mirror-URL generation utilities for deduplication across mirror domains.
package urlutil

import (
	"net/url"
	"sort"
	"strings"
)

// CleanURL removes invisible characters (zero-width, BOM, newlines, tabs)
// and trims whitespace from a raw URL string. This handles user-paste
// artifacts that would cause exact-match dedup to miss duplicates.
func CleanURL(raw string) string {
	if raw == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		switch r {
		case '\u200B', '\u200C', '\u200D', '\uFEFF', // zero-width + BOM
			'\r', '\n', '\t': // newlines + tabs
			continue
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

// NormalizeURL standardizes a URL for exact-match deduplication:
//   - Lowercases the hostname (path stays case-sensitive)
//   - Upgrades http: to https:
//   - Removes the fragment (#hash)
//   - Strips trailing slashes (except root "/")
//   - Sorts query parameters alphabetically
func NormalizeURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return CleanURL(rawURL)
	}

	parsed.Host = strings.ToLower(parsed.Hostname())
	if parsed.Port() != "" {
		parsed.Host = parsed.Hostname() + ":" + parsed.Port()
	}

	if parsed.Scheme == "http" {
		parsed.Scheme = "https"
	}

	parsed.Fragment = ""

	if len(parsed.Path) > 1 {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}

	if parsed.RawQuery != "" {
		parsed.RawQuery = sortQueryParams(parsed.RawQuery)
	}

	return parsed.String()
}

// GetURLSignature extracts the domain-agnostic path signature of a URL:
// pathname + sorted query string. Two URLs with the same signature but
// different domains point to the same content (mirror sites).
func GetURLSignature(rawURL string) string {
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return CleanURL(rawURL)
	}

	path := parsed.Path
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}

	search := ""
	if parsed.RawQuery != "" {
		search = "?" + sortQueryParams(parsed.RawQuery)
	}

	return path + search
}

// MirrorURLInfo holds the normalized URL and all mirror-domain variants
// for a single source URL, enabling multi-domain dedup checks.
type MirrorURLInfo struct {
	Normalized string   // Canonical form produced by NormalizeURL
	Signature  string   // Domain-agnostic signature produced by GetURLSignature
	Mirrors    []string // All mirror-domain variants, including Normalized
}

// GenerateMirrorURLs replaces the hostname of rawURL with each mirror domain
// while keeping the path signature. Without mirror domains the result contains
// only the normalized URL.
func GenerateMirrorURLs(rawURL string, mirrorDomains []string) MirrorURLInfo {
	cleaned := CleanURL(rawURL)
	normalized := NormalizeURL(cleaned)
	signature := GetURLSignature(cleaned)

	if len(mirrorDomains) <= 1 {
		return MirrorURLInfo{
			Normalized: normalized,
			Signature:  signature,
			Mirrors:    []string{normalized},
		}
	}

	mirrors := make([]string, 0, len(mirrorDomains))
	seen := make(map[string]bool, len(mirrorDomains))

	for _, domain := range mirrorDomains {
		parsed, err := url.Parse(domain)
		if err != nil {
			continue
		}
		mirrorURL := parsed.Scheme + "://" + parsed.Hostname() + signature
		if !seen[mirrorURL] {
			seen[mirrorURL] = true
			mirrors = append(mirrors, mirrorURL)
		}
	}

	if !seen[normalized] {
		mirrors = append(mirrors, normalized)
	}

	return MirrorURLInfo{
		Normalized: normalized,
		Signature:  signature,
		Mirrors:    mirrors,
	}
}

// sortQueryParams parses a raw query string, sorts parameters by key
// (and value for multi-valued keys), and re-encodes them. This ensures
// that ?a=1&b=2 and ?b=2&a=1 produce the same normalized string.
func sortQueryParams(rawQuery string) string {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return rawQuery
	}

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for i, k := range keys {
		vs := values[k]
		sort.Strings(vs)
		for _, v := range vs {
			if b.Len() > 0 {
				b.WriteByte('&')
			}
			b.WriteString(url.QueryEscape(k))
			b.WriteByte('=')
			b.WriteString(url.QueryEscape(v))
		}
		_ = i
	}
	return b.String()
}

// ReplaceDomain rewrites the domain prefix of rawURL to baseDomain when it
// starts with one of the given domain prefixes, otherwise returns it unchanged.
func ReplaceDomain(rawURL, baseDomain string, domains []string) string {
	if rawURL == "" || baseDomain == "" {
		return rawURL
	}
	for _, domain := range domains {
		if strings.HasPrefix(rawURL, domain) {
			return baseDomain + rawURL[len(domain):]
		}
	}
	return rawURL
}

// IsM3U8URL checks whether a URL is likely an M3U8/HLS stream URL using
// multiple detection signals to avoid false negatives from non-standard
// extensions or embedded query parameters.
func IsM3U8URL(rawURL string) bool {
	lower := strings.ToLower(rawURL)

	if strings.HasSuffix(lower, ".m3u8") || strings.HasSuffix(lower, ".m3u") {
		return true
	}

	parsed, err := url.Parse(rawURL)
	if err == nil {
		pathLower := strings.ToLower(parsed.Path)
		for _, seg := range []string{"/m3u8/", "/hls/", "/stream/", "/playlist/"} {
			if strings.Contains(pathLower, seg) {
				return true
			}
		}
		queryLower := strings.ToLower(parsed.RawQuery)
		for _, key := range []string{"m3u8", "m3u", "hls", "playlist"} {
			if strings.Contains(queryLower, key) {
				return true
			}
		}
	}

	knownCDNPatterns := []string{
		".m3u8.", "hls.", "cdn", "11yun.space", "stream.",
	}
	for _, pattern := range knownCDNPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}

	return false
}

// ReplaceHost swaps the scheme and host of originalURL for newDomain, keeping
// path and query. URLs without a scheme are returned unchanged.
func ReplaceHost(originalURL, newDomain string) string {
	newDomain = strings.TrimPrefix(newDomain, "https://")
	newDomain = strings.TrimPrefix(newDomain, "http://")

	idx := strings.Index(originalURL, "://")
	if idx < 0 {
		return originalURL
	}
	rest := originalURL[idx+3:]
	slashIdx := strings.IndexByte(rest, '/')
	if slashIdx < 0 {
		return "https://" + newDomain
	}
	return "https://" + newDomain + rest[slashIdx:]
}
