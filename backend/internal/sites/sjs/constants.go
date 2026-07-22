package sjs

import (
	"html"
	"net/url"
	"regexp"
	"strings"

	"backend/internal/sites"
)

var SiteDomains []string
var PrimaryDomain string
var DiscuzCookiePrefix string
var PlaceholderGIF string

var pkgDataStore sites.SiteDataStore

var (
	threadIDPattern      = regexp.MustCompile(`thread-(\d+)-\d+-\d+\.html`)
	threadIDQueryPattern = regexp.MustCompile(`[?&]tid=(\d+)`)
	forumIDPattern       = regexp.MustCompile(`forum-(\d+)-\d+\.html`)
	threadURLPattern     = regexp.MustCompile(`thread-\d+-\d+-\d+\.html`)
	datePattern          = regexp.MustCompile(`(\d{4}-\d{1,2}-\d{1,2})`)
	relDatePattern       = regexp.MustCompile(`(\d{4}-\d{1,2}-\d{1,2}|\d+天前|\d+小时前|昨天|前天|\d+分钟前)`)
	publishedPattern     = regexp.MustCompile(`发布时间\s*(.+)`)
	publisherPrefixPattern = regexp.MustCompile(`^[\x{4e00}-\x{9fff}]{3,8}[:]\s*`)
	sjsSuffixPattern     = regexp.MustCompile(`(?i)\s*-\s*司机社\s*-\s*求出处.*$`)
	sjsSuffixPattern2    = regexp.MustCompile(`(?i)\s*-\s*司机社.*$`)
)

var categorySuffixPatterns []*regexp.Regexp

// initData populates package-level configuration variables from the
// unified SiteDataStore, replacing former hardcoded constants.
func initData(ds sites.SiteDataStore) {
	pkgDataStore = ds

	if mod, ok := ds.GetModuleConfig("sjs"); ok {
		SiteDomains = mod.Domains
	}

	pd, ok := ds.GetProviderData("sjs")
	if !ok {
		return
	}

	PrimaryDomain = pd.PrimaryDomain
	DiscuzCookiePrefix = pd.DiscuzCookiePrefix
	PlaceholderGIF = pd.PlaceholderGif

	categorySuffixPatterns = nil
	for _, patternStr := range pd.TitleCleanPatterns {
		if re, err := regexp.Compile(patternStr); err == nil {
			categorySuffixPatterns = append(categorySuffixPatterns, re)
		}
	}
}

// ExtractThreadID extracts the numeric thread ID from a URL, supporting
// both thread-TID-PAGE-FID.html and forum.php?mod=viewthread&tid=TID formats.
func ExtractThreadID(rawURL string) string {
	if m := threadIDPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	if m := threadIDQueryPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractForumID extracts the numeric forum ID from a URL path.
func ExtractForumID(rawURL string) string {
	if m := forumIDPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	return ""
}

// NormalizeSjsUrl converts any SJS URL to the primary domain format,
// rewriting query-style thread URLs to thread-TID-1-FID.html.
func NormalizeSjsUrl(rawURL string) string {
	if m := threadIDQueryPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		fid := "1"
		if fm := regexp.MustCompile(`[?&]fid=(\d+)`).FindStringSubmatch(rawURL); len(fm) >= 2 {
			fid = fm[1]
		}
		return PrimaryDomain + "/thread-" + m[1] + "-1-" + fid + ".html"
	}
	return ReplaceDomain(rawURL, PrimaryDomain)
}

// ReplaceDomain swaps the domain in a URL to the target base URL.
func ReplaceDomain(rawURL, baseDomain string) string {
	if rawURL == "" || baseDomain == "" {
		return rawURL
	}
	for _, domain := range SiteDomains {
		if strings.HasPrefix(rawURL, domain) {
			return baseDomain + rawURL[len(domain):]
		}
	}
	return rawURL
}

// MatchesSjsUrl checks if a URL belongs to any known SJS domain.
func MatchesSjsUrl(rawURL string) bool {
	if pkgDataStore == nil {
		return false
	}
	return pkgDataStore.CanHandle("sjs", rawURL)
}

// IsListingPage reports whether the URL is a forum listing or search
// page rather than a thread detail page.
func IsListingPage(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if threadURLPattern.MatchString(parsed.Path) {
		return false
	}
	if parsed.Query().Get("mod") == "viewthread" {
		return false
	}
	return true
}

// CleanSjsTitle removes publisher prefixes, site suffixes, and category
// suffixes from a raw thread title, then decodes HTML entities.
func CleanSjsTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	title = publisherPrefixPattern.ReplaceAllString(title, "")
	title = sjsSuffixPattern.ReplaceAllString(title, "")
	title = sjsSuffixPattern2.ReplaceAllString(title, "")
	for _, p := range categorySuffixPatterns {
		title = p.ReplaceAllString(title, "")
	}
	title = html.UnescapeString(title)
	return strings.TrimSpace(title)
}

// ResolveURL converts a relative URL to absolute using the primary domain.
func ResolveURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	if strings.HasPrefix(rawURL, "/") {
		return strings.TrimRight(PrimaryDomain, "/") + rawURL
	}
	return rawURL
}
