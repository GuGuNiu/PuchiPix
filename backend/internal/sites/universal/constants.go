package universal

import (
	"encoding/base64"
	"net/url"
	"regexp"
	"strings"
)

// PlayButtonSelectors is tried in order, because generic video pages expose
// playback under a wide range of markup and clicking a button is what
// triggers the M3U8 request.
var PlayButtonSelectors = []string{
	".play-btn", ".player-play", ".video-play",
	"[onclick*=\"play\"]", ".play-button", ".start-btn",
	".btn-play", ".play-icon", "[id*=\"play\"]",
	"[class*=\"play\"]", "[class*=\"player\"]",
	"video", ".video-js", ".vjs-tech", ".jw-video",
	".plyr", ".dplayer", ".art-video",
	"[data-player]", ".player-container video",
}

// M3U8ExcludePatterns drops advertising and analytics endpoints, which
// otherwise surface as M3U8 candidates.
var M3U8ExcludePatterns = []string{"ad", "stat", "analytics"}

const TagSelectors = ".category a, .tag a, .tags a, [class*=\"tag\"] a"

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
	// MacCMS titles are wrapped in a leading "watch online" segment and a
	// trailing site-name segment, so both are stripped. The suffix pattern
	// uses .* rather than [^-]* because the suffix itself contains hyphens.
	kanavPrefixPattern = regexp.MustCompile(`^在线播放\s*[-—丨]\s*`)
	kanavSuffixPattern = regexp.MustCompile(`\s*[-—丨]\s*KanAV.*$`)
	m3u8ExtPattern     = regexp.MustCompile(`\.m3u8|\.m3u`)
	resolutionPattern  = regexp.MustCompile(`(?i)(\d{3,4})x(\d{3,4})`)
	resKeywordPatterns = []struct {
		Pattern *regexp.Regexp
		Label   string
	}{
		{regexp.MustCompile(`(?i)1080p|1080`), "1080p"},
		{regexp.MustCompile(`(?i)720p|720`), "720p"},
		{regexp.MustCompile(`(?i)480p|480`), "480p"},
		{regexp.MustCompile(`(?i)360p|360`), "360p"},
		{regexp.MustCompile(`(?i)4k|2160`), "4K"},
	}
	bitratePattern        = regexp.MustCompile(`(?i)(\d{3,5})\s*kbps|(\d)M\b`)
	epPattern             = regexp.MustCompile(`(?i)(?:ep|episode|part|第)(\d{1,3})`)
	highQualityPat        = regexp.MustCompile(`(?i)1080|1920|2160|4k|high`)
	m3u8FileExtPat        = regexp.MustCompile(`(?i)\.(m3u8|m3u)$`)
	queryFragPat          = regexp.MustCompile(`[?#].*$`)
	invalidTitleFragments = []string{
		"attention required",
		"just a moment",
		"access denied",
		"checking your browser",
		"请稍候",
		"安全检查",
		"访问被拒绝",
	}
)

// CleanTitle strips MacCMS-style title wrappers, publisher prefixes, and
// streaming-site suffixes, returning an empty title when the page title
// carries a known anti-bot interstitial marker.
func CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	title := kanavPrefixPattern.ReplaceAllString(rawTitle, "")
	title = kanavSuffixPattern.ReplaceAllString(title, "")
	title = publisherPrefixPattern.ReplaceAllString(title, "")
	for _, pat := range onlineSuffixPatterns {
		title = pat.ReplaceAllString(title, "")
	}
	title = strings.TrimSpace(title)
	lower := strings.ToLower(title)
	for _, fragment := range invalidTitleFragments {
		if strings.Contains(lower, fragment) {
			return ""
		}
	}
	return title
}

var base64CharsetPattern = regexp.MustCompile(`^[A-Za-z0-9+/=]{20,}$`)

// DecodeMacCMSURL returns the input unchanged unless it is a base64 token,
// which some MacCMS themes emit in place of a plain stream URL; the decoded
// payload is URL-unescaped before being returned.
func DecodeMacCMSURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return rawURL
	}

	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}

	if !base64CharsetPattern.MatchString(rawURL) {
		return rawURL
	}

	decoded, err := base64.StdEncoding.DecodeString(rawURL)
	if err != nil {
		return rawURL
	}

	decodedStr := string(decoded)

	if strings.Contains(decodedStr, "%") {
		if unescaped, err := url.QueryUnescape(decodedStr); err == nil {
			return unescaped
		}
	}

	if strings.HasPrefix(decodedStr, "http://") || strings.HasPrefix(decodedStr, "https://") {
		return decodedStr
	}

	return rawURL
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
