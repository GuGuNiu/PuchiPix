// Package urlutil provides URL normalization, signature extraction, and
// mirror-URL generation utilities for deduplication across mirror domains.
//
// This package ports the TypeScript implementation from
// src/lib/utils/url-normalizer.ts (commit 55d77c6) to Go, preserving
// the three-tier dedup strategy: exact → mirror → path-signature.
package urlutil

import (
	"net/url"
	"sort"
	"strings"
	"unicode"
)

// CleanURL removes invisible characters (zero-width, BOM, newlines, tabs)
// and trims whitespace from a raw URL string. This handles user-paste
// artifacts that would cause exact-match dedup to miss duplicates.
//
// Ported from TS: src/lib/utils/url-normalizer.ts → cleanUrl()
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
//
// Ported from TS: src/lib/utils/url-normalizer.ts → normalizeUrl()
func NormalizeURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return CleanURL(rawURL)
	}

	// Lowercase hostname.
	parsed.Host = strings.ToLower(parsed.Hostname())
	if parsed.Port() != "" {
		parsed.Host = parsed.Hostname() + ":" + parsed.Port()
	}

	// Upgrade http → https.
	if parsed.Scheme == "http" {
		parsed.Scheme = "https"
	}

	// Remove fragment.
	parsed.Fragment = ""

	// Strip trailing slashes (except root "/").
	if len(parsed.Path) > 1 {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}

	// Sort query parameters.
	if parsed.RawQuery != "" {
		parsed.RawQuery = sortQueryParams(parsed.RawQuery)
	}

	return parsed.String()
}

// GetURLSignature extracts the domain-agnostic path signature of a URL:
// pathname + sorted query string. Two URLs with the same signature but
// different domains point to the same content (mirror sites).
//
// Example:
//
//	https://www.lovecutes.com/article/123 → "/article/123"
//	https://xx.knit.bid/article/123       → "/article/123"  (same signature)
//
// Ported from TS: src/lib/utils/url-normalizer.ts → getUrlSignature()
func GetURLSignature(rawURL string) string {
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return CleanURL(rawURL)
	}

	// Path (strip trailing slashes except root).
	path := parsed.Path
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}

	// Sorted query string.
	search := ""
	if parsed.RawQuery != "" {
		search = "?" + sortQueryParams(parsed.RawQuery)
	}

	return path + search
}

// MirrorURLInfo holds the normalized URL and all mirror-domain variants
// for a single source URL, enabling multi-domain dedup checks.
type MirrorURLInfo struct {
	Normalized string   // NormalizeURL(rawURL)
	Signature  string   // GetURLSignature(rawURL)
	Mirrors    []string // All mirror-domain variants (including Normalized)
}

// GenerateMirrorURLs builds mirror-domain URL variants by replacing the
// hostname with each domain in the provided list while preserving the
// path signature. If no mirror domains are provided, returns a
// single-element slice containing the normalized URL.
//
// Ported from TS: src/lib/utils/url-normalizer.ts → generateMirrorUrls()
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

	// Ensure the normalized URL is included.
	if !seen[normalized] {
		mirrors = append(mirrors, normalized)
	}

	return MirrorURLInfo{
		Normalized: normalized,
		Signature:  signature,
		Mirrors:    mirrors,
	}
}

// IsNumericID returns true if the string consists solely of digits.
// Used by the Aimeizizi provider's CanHandle fallback for pure-numeric IDs.
func IsNumericID(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
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
