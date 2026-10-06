package stealth

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// CDN media subresource request kinds, used to fill the Sec-Fetch metadata
// trio. Cloudflare bot rules score these values, so they must match what the
// embedding page's player would have sent.
const (
	// FetchDestEmpty is used for XHR/fetch style requests: HLS playlists,
	// media segments and any other binary subresource.
	FetchDestEmpty = "empty"
	// FetchDestVideo is used for progressive <video> loads such as direct
	// MP4 sources.
	FetchDestVideo = "video"
)

// mediaProfile is the identity used for media subresource requests when the
// caller supplies none.
//
// It is deliberately a fixed Chrome desktop profile rather than a random
// draw: only Chromium sends the sec-ch-ua client hints, and without them
// Cloudflare answers HTTP 410. A random profile would intermittently pick
// Firefox or Safari, silently stripping the headers that make the request
// look like a browser.
func mediaProfile() BrowserProfile {
	return BrowserProfile{
		UA:                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Safari/537.36",
		Browser:             BrowserChrome,
		Platform:            PlatformWindows,
		Accept:              chromeAccept,
		AcceptEncoding:      chromeEncoding,
		SecChUa:             chromeBrands[126],
		SecChUaMobile:       "?0",
		SecChUaPlatform:     `"Windows"`,
		ViewportWidth:       1920,
		ViewportHeight:      1080,
		HardwareConcurrency: 8,
		DeviceMemory:        8,
		NavigatorPlatform:   "Win32",
		Vendor:              "Google Inc.",
	}
}

// resolveMediaProfile returns the caller's profile, or the fixed Chrome one,
// and guarantees the client hints are present. A caller-supplied non-Chromium
// profile keeps its UA but inherits the hints, because a request that mixes
// a Firefox UA with Chrome hints is less browser-like than either.
func resolveMediaProfile(profile *BrowserProfile) BrowserProfile {
	p := mediaProfile()
	if profile == nil {
		return p
	}
	if profile.UA == "" {
		profile.UA = p.UA
	}
	if profile.SecChUa == "" {
		profile.SecChUa = p.SecChUa
	}
	if profile.SecChUaMobile == "" {
		profile.SecChUaMobile = p.SecChUaMobile
	}
	if profile.SecChUaPlatform == "" {
		profile.SecChUaPlatform = p.SecChUaPlatform
	}
	return *profile
}

// CDNRequestHeaders builds the header set a browser sends when a page
// player pulls a media subresource (HLS playlist, TS/fMP4 segment,
// progressive MP4) from a CDN.
//
// Cloudflare's bot management scores the presence of client-hint and
// fetch-metadata headers: a request that carries only User-Agent, Accept
// and Referer is answered with HTTP 410 Gone even though the very same URL
// returns 200 for a real browser. Adding sec-ch-ua* (or Sec-Fetch-*, or
// Priority) is sufficient to flip the decision, so every media request
// from this project must carry the full set.
//
// dest selects the Sec-Fetch-Dest value; pass FetchDestEmpty for playlist
// and segment requests, FetchDestVideo for progressive files. referer is
// the page the media belongs to and is omitted when empty. profile
// supplies the UA and client hints, and a fixed Chrome profile is used
// when nil.
func CDNRequestHeaders(profile *BrowserProfile, referer, dest string) map[string]string {
	p := resolveMediaProfile(profile)

	if dest == "" {
		dest = FetchDestEmpty
	}

	headers := map[string]string{
		"User-Agent":         p.UA,
		"Accept":             "*/*",
		"Accept-Language":    defaultAcceptLanguage,
		"Sec-Ch-Ua":          p.SecChUa,
		"Sec-Ch-Ua-Mobile":   p.SecChUaMobile,
		"Sec-Ch-Ua-Platform": p.SecChUaPlatform,
		"Sec-Fetch-Dest":     dest,
		"Sec-Fetch-Mode":     "cors",
		"Sec-Fetch-Site":     "same-site",
		"Priority":           "u=1, i",
	}

	if referer != "" {
		headers["Referer"] = referer
	}

	return headers
}

// ApplyCDNRequestHeaders copies the CDN header set onto an http.Header so
// callers that already hold a request object (segment downloads) reuse the
// same construction as CDNRequestHeaders.
func ApplyCDNRequestHeaders(h http.Header, profile *BrowserProfile, referer, dest string) {
	for k, v := range CDNRequestHeaders(profile, referer, dest) {
		h.Set(k, v)
	}
}

// DocumentRequestHeaders builds the header set for a top-level document
// navigation. It mirrors CDNRequestHeaders but uses the navigation fetch
// mode and the page-oriented Accept value, which detail-page scrapers on
// Cloudflare-fronted sites require.
func DocumentRequestHeaders(profile *BrowserProfile, referer string) map[string]string {
	p := resolveMediaProfile(profile)

	headers := map[string]string{
		"User-Agent":                p.UA,
		"Accept":                    p.Accept,
		"Accept-Language":           defaultAcceptLanguage,
		"Sec-Ch-Ua":                 p.SecChUa,
		"Sec-Ch-Ua-Mobile":          p.SecChUaMobile,
		"Sec-Ch-Ua-Platform":        p.SecChUaPlatform,
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "none",
		"Sec-Fetch-User":            "?1",
		"Upgrade-Insecure-Requests": "1",
	}

	if referer != "" {
		headers["Referer"] = referer
	}

	return headers
}

// streamExpiryQueryPattern matches the signed-expiry query parameter used by
// the media CDNs (pornhub's `?h=<hash>&e=<unix>&f=1`).
var streamExpiryQueryPattern = regexp.MustCompile(`(?:^|[?&])e=(\d+)(?:&|$)`)

// streamExpiryPathPattern matches the `<token>,<unix-expiry>` path segment
// used by xvideos' CDN (`hls-cdn77/.../{token},{ts}/{uuid}/6/hls.m3u8`).
var streamExpiryPathPattern = regexp.MustCompile(`,(\d{9,})(?:/|$)`)

// StreamURLExpired reports whether a signed stream URL's validity window has
// already passed.
//
// Stream URLs are not permanent: the media CDNs embed a short expiry
// (roughly an hour on the sites this project supports), so a task
// identified now can be unschedulable by the time it runs. Treating a stored
// URL as always fresh strands those tasks; re-identifying from the page
// yields a new signature.
//
// An expiry of zero, and any URL with no recognisable expiry, is reported as
// not expired: those URLs are either unsigned or explicitly non-expiring and
// re-scraping them on every run would be pure overhead.
func StreamURLExpired(streamURL string, now time.Time) bool {
	if streamURL == "" {
		return false
	}

	for _, m := range streamExpiryQueryPattern.FindAllStringSubmatch(streamURL, -1) {
		if ts, err := strconv.ParseInt(m[1], 10, 64); err == nil && ts > 0 && now.Unix() >= ts {
			return true
		}
	}

	for _, m := range streamExpiryPathPattern.FindAllStringSubmatch(streamURL, -1) {
		if ts, err := strconv.ParseInt(m[1], 10, 64); err == nil && ts > 0 && now.Unix() >= ts {
			return true
		}
	}

	return false
}

// IsMediaGoneStatus reports whether a response status means the media
// request was rejected outright rather than transiently failing.
//
// Cloudflare answers non-browser media clients with 410 Gone, which is
// indistinguishable from "expired token" for the caller unless it is
// surfaced explicitly. Callers use this to decide between a token refresh
// and a genuine access block.
func IsMediaGoneStatus(status int) bool {
	return status == http.StatusGone
}

// Media rejection reasons returned by ClassifyMediaRejection.
const (
	// RejectionNone means the response was accepted.
	RejectionNone = ""
	// RejectionExpiredToken means the signed stream URL is past its
	// validity window and the page must be re-scraped for a fresh one.
	RejectionExpiredToken = "expired stream token; re-scrape the page for a fresh stream URL"
	// RejectionBotBlocked means the request was rejected for looking like
	// a bot, which no amount of retrying on the same headers will fix.
	RejectionBotBlocked = "media request rejected as a bot; the request is missing the browser client hints Cloudflare scores"
)

// ClassifyMediaRejection turns a failed media response into an actionable
// reason, and returns RejectionNone when the status is a success.
//
// Both Cloudflare-fronted and plain CDNs answer 410 Gone for two unrelated
// causes, and the response body is the only signal that separates them:
// an expired signed URL answers "expired token", while a bot rejection
// answers with an empty body. Reporting them identically makes a refreshable
// task look permanently broken.
func ClassifyMediaRejection(status int, body []byte) string {
	if status >= 200 && status < 300 {
		return RejectionNone
	}

	text := strings.ToLower(strings.TrimSpace(string(body)))
	switch {
	case strings.Contains(text, "expired"):
		return RejectionExpiredToken
	case status == http.StatusForbidden || status == http.StatusUnauthorized:
		return RejectionBotBlocked
	case status == http.StatusGone && text == "":
		return RejectionBotBlocked
	}

	return fmt.Sprintf("media CDN returned HTTP %d", status)
}
