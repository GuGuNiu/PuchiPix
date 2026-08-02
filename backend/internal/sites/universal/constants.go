package universal

import (
	"net/url"
	"regexp"
	"strings"
)

// PlayButtonSelectors lists CSS selectors for common video play button
// patterns, tried in order to initiate playback and trigger M3U8 loading.
var PlayButtonSelectors = []string{
	".play-btn", ".player-play", ".video-play",
	"[onclick*=\"play\"]", ".play-button", ".start-btn",
	".btn-play", ".play-icon", "[id*=\"play\"]",
	"[class*=\"play\"]", "[class*=\"player\"]",
	"video", ".video-js", ".vjs-tech", ".jw-video",
	".plyr", ".dplayer", ".art-video",
	"[data-player]", ".player-container video",
}

// M3U8ExcludePatterns filters out M3U8 URLs that match advertising,
// analytics, or statistics endpoints to avoid false positives.
var M3U8ExcludePatterns = []string{"ad", "stat", "analytics"}

// TagSelectors targets anchor elements within tag-like containers for
// metadata extraction from generic video pages.
const TagSelectors = ".category a, .tag a, .tags a, [class*=\"tag\"] a"

// ActorSelectors lists CSS selectors for extracting actor names from
// various common video page layouts.
var ActorSelectors = []string{
	".actor a", ".actors a", ".star a", ".stars a",
	".cast a", ".performer a", ".model a",
	"[class*=\"actor\"] a", "[class*=\"star\"] a",
	"[class*=\"performer\"] a", "[class*=\"model\"] a",
	".avatar-name", ".actor-name", ".star-name",
	"[class*=\"kv\"] a", ".celebrity a",
	".video-actor", ".media-star",
}

var (
	publisherPrefixPattern = regexp.MustCompile(`^[\x{4e00}-\x{9fff}]{3,8}[:]\s*`)
	onlineSuffixPatterns   = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\s*[-—丨]\s*在线播放.*$`),
		regexp.MustCompile(`(?i)\s*[-—丨]\s*在线观看.*$`),
		regexp.MustCompile(`(?i)\s*[-—丨]\s*免费.*$`),
		regexp.MustCompile(`(?i)\s*[-—丨]\s*高清.*$`),
	}
	// Kanav (MacCMS) title patterns. Kanav titles follow the format
	// "在线播放 - {title} - KanAV-免费高清中文AV在线看". We strip the
	// leading "在线播放 - " and the trailing " - {site-name}..." suffix.
	kanavPrefixPattern = regexp.MustCompile(`^在线播放\s*[-—丨]\s*`)
	kanavSuffixPattern = regexp.MustCompile(`\s*[-—丨]\s*KanAV[^-]*$`)
	m3u8ExtPattern       = regexp.MustCompile(`\.m3u8|\.m3u`)
	resolutionPattern    = regexp.MustCompile(`(?i)(\d{3,4})x(\d{3,4})`)
	resKeywordPatterns   = []struct {
		Pattern *regexp.Regexp
		Label   string
	}{
		{regexp.MustCompile(`(?i)1080p|1080`), "1080p"},
		{regexp.MustCompile(`(?i)720p|720`), "720p"},
		{regexp.MustCompile(`(?i)480p|480`), "480p"},
		{regexp.MustCompile(`(?i)360p|360`), "360p"},
		{regexp.MustCompile(`(?i)4k|2160`), "4K"},
	}
	bitratePattern = regexp.MustCompile(`(?i)(\d{3,5})\s*kbps|(\d)M\b`)
epPattern      = regexp.MustCompile(`(?i)(?:ep|episode|part|第)(\d{1,3})`)
	highQualityPat = regexp.MustCompile(`(?i)1080|1920|2160|4k|high`)
	m3u8FileExtPat = regexp.MustCompile(`(?i)\.(m3u8|m3u)$`)
	queryFragPat   = regexp.MustCompile(`[?#].*$`)
)

// CleanTitle removes publisher prefixes, Kanav-style wrappers, and
// common streaming-site suffixes from a raw page title to produce a
// clean video name.
func CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	// Strip Kanav (MacCMS) wrappers: "在线播放 - {title} - KanAV..."
	title := kanavPrefixPattern.ReplaceAllString(rawTitle, "")
	title = kanavSuffixPattern.ReplaceAllString(title, "")
	// Generic publisher prefix: "某某站: title"
	title = publisherPrefixPattern.ReplaceAllString(title, "")
	for _, pat := range onlineSuffixPatterns {
		title = pat.ReplaceAllString(title, "")
	}
	return title
}

// DeduplicateM3U8 removes M3U8 URLs that differ only in query or
// fragment portions, preserving the first occurrence of each base URL.
func DeduplicateM3U8(urls []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, u := range urls {
		normalized := queryFragPat.ReplaceAllString(u, "")
		if !seen[normalized] {
			seen[normalized] = true
			result = append(result, u)
		}
	}
	return result
}

// SelectBestM3U8 picks the highest-quality M3U8 URL by preferring
// high-resolution markers and longer URL paths as a quality proxy.
func SelectBestM3U8(urls []string) string {
	unique := DeduplicateM3U8(urls)
	if len(unique) == 0 {
		return ""
	}

	best := unique[0]
	bestScore := scoreM3U8(best)
	for i := 1; i < len(unique); i++ {
		s := scoreM3U8(unique[i])
		if s > bestScore {
			best = unique[i]
			bestScore = s
		}
	}
	return best
}

func parseURL(rawURL string) (*url.URL, error) {
	return url.Parse(rawURL)
}

func splitPath(path string) []string {
	return strings.FieldsFunc(path, func(r rune) bool {
		return r == '/'
	})
}

func scoreM3U8(url string) int {
	if highQualityPat.MatchString(url) {
		return 1000 + len(url)
	}
	return len(url)
}

// GuessM3U8Title derives a human-readable title from an M3U8 URL by
// examining its path, resolution markers, bitrate, and episode numbers.
func GuessM3U8Title(m3u8URL, pageTitle string) string {
	parsed, err := parseURL(m3u8URL)
	if err != nil {
		if len(m3u8URL) > 50 {
			return m3u8URL[:50] + "..."
		}
		return m3u8URL
	}

	segments := splitPath(parsed.Path)
	lastSegment := ""
	if len(segments) > 0 {
		lastSegment = segments[len(segments)-1]
	}

	name := m3u8FileExtPat.ReplaceAllString(lastSegment, "")
	name = queryFragPat.ReplaceAllString(name, "")

	if m := resolutionPattern.FindStringSubmatch(m3u8URL); len(m) >= 3 {
		base := name
		if base == "" {
			base = pageTitle
		}
		return base + " (" + m[1] + "x" + m[2] + ")"
	}

	for _, kp := range resKeywordPatterns {
		if kp.Pattern.MatchString(m3u8URL) {
			base := name
			if base == "" {
				base = pageTitle
			}
			return base + " (" + kp.Label + ")"
		}
	}

	if m := bitratePattern.FindStringSubmatch(m3u8URL); len(m) > 0 {
		base := name
		if base == "" {
			base = pageTitle
		}
		return base + " (" + m[0] + ")"
	}

	if m := epPattern.FindStringSubmatch(m3u8URL); len(m) >= 2 {
		base := name
		if base == "" {
			base = pageTitle
		}
	return base + " (EP" + m[1] + ")"
	}

	if len(name) > 2 {
		return name
	}

	if pageTitle != "" {
		return pageTitle
	}

	return parsed.Host
}
