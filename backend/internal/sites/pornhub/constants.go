package pornhub

import (
	"regexp"
	"time"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID            string   `json:"id"`
	ViewKey       string   `json:"viewKey"`
	Title         string   `json:"title"`
	TitleOriginal string   `json:"titleOriginal,omitempty"`
	PageURL       string   `json:"pageUrl"`
	ThumbnailURL  string   `json:"thumbnailUrl"`
	Views         int      `json:"views"`
	ViewsText     string   `json:"viewsText"`
	Duration     string   `json:"duration"`
	DurationSec   int      `json:"durationSec"`
	PublishDate   string   `json:"publishDate"`
	Uploader      string   `json:"uploader"`
	UploaderURL   string   `json:"uploaderUrl,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Production    string   `json:"production,omitempty"`
	IsVR          bool     `json:"isVr,omitempty"`
}

// ListingPageResult holds the parsed data from a video listing page.
type ListingPageResult struct {
	Videos      []VideoMetadata `json:"videos"`
	TotalPages  int             `json:"totalPages"`
	CurrentPage int             `json:"currentPage"`
	HasNextPage bool            `json:"hasNextPage"`
	NextPageURL string          `json:"nextPageUrl,omitempty"`
}

// VideoDetailResult holds the parsed data from a video detail page,
// including the HLS M3U8 URL and MP4 direct links extracted from the
// inline flashvars JSON object.
type VideoDetailResult struct {
	VideoMetadata
	M3U8URL  string `json:"m3u8Url"`
	MP4URL   string `json:"mp4Url,omitempty"`
	MP4Links map[string]string `json:"mp4Links,omitempty"` // quality -> url, e.g. "720" -> "https://..."
}

// SortType represents the available sorting options on PORNHUB.
type SortType string

const (
	SortTypeNewest    SortType = "newest"   // 最新
	SortTypeMostViewed SortType = "mostviewed" // 观看最多
	SortTypeTopRated  SortType = "toprated"  // 评分最高
	SortTypeLongest   SortType = "longest"   // 时长最长
)

// URL patterns for the PORNHUB site.
// The site uses the following URL structure:
//   - Detail page (legacy): /view_video.php?viewkey=ph5f4a1b2c3d4e5
//   - Detail page (new):    /watch/ph5f4a1b2c3d4e5
//   - Listing page:         / (homepage), /video?search=xxx&o=mv, /categories, /playlists
//   - Search page:          /video/search?search={keyword}&page={page}
const (
	// DetailViewKeyPattern matches ?viewkey=ph... or /watch/ph...
	DetailViewKeyPattern = `(?:[?&]viewkey=|/watch/)([a-zA-Z0-9]+)`
)

// Pre-compiled regex patterns.
var (
	// View key extraction from URL.
	ViewKeyPattern = regexp.MustCompile(DetailViewKeyPattern)

	// View key from listing card data attribute: data-video-vkey="ph..."
	CardVKeyPattern = regexp.MustCompile(`data-video-vkey="([a-zA-Z0-9]+)"`)

	// flashvars JSON block detection: var playerObjectList = [{ ... }] or flashvars_... = {...}
	FlashvarsBlockPattern = regexp.MustCompile(`(?s)var\s+playerObjectList\s*=\s*\[(.*?)\]\s*;`)

	// HLS M3U8 URL from flashvars: "hlsUrl":"..." or mediaDefinition entries.
	HLSURLPattern = regexp.MustCompile(`"hlsUrl"\s*:\s*"([^"]+)"`)

	// MP4 URL from flashvars: "quality_720p":"..." (highest available first).
	MP4URLPattern = regexp.MustCompile(`"quality_(?:1080p|720p|480p|240p)"\s*:\s*"([^"]+)"`)

	// All MP4 quality links: "quality_1080p":"https://..."
	MP4QualityPattern = regexp.MustCompile(`"quality_(\d+p)"\s*:\s*"([^"]+)"`)

	// Video title from JSON-LD name field or og:title meta tag.
	VideoTitlePattern = regexp.MustCompile(`<meta\s+property="og:title"\s+content="([^"]*)"`)

	// Image URL from og:image meta tag or thumbnailUrl in JSON-LD.
	ThumbnailPattern = regexp.MustCompile(`<meta\s+property="og:image"\s+content="([^"]*)"`)

	// JSON-LD script block detection.
	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)

	// Upload date from JSON-LD: "2026-05-19T22:00:00+00:00".
	UploadDatePattern = regexp.MustCompile(`"uploadDate"\s*:\s*"([^"]+)"`)

	// Duration from JSON-LD: "PT00H11M44S".
	JSONLDDurationPattern = regexp.MustCompile(`"duration"\s*:\s*"([^"]+)"`)

	// Interaction count from JSON-LD.
	InteractionCountPattern = regexp.MustCompile(`"userInteractionCount"\s*:\s*(\d+)`)

	// Name from JSON-LD.
	JSONLDNamePattern = regexp.MustCompile(`"name"\s*:\s*"([^"]*)"`)
)

// parseISODuration converts an ISO 8601 duration string (e.g. "PT00H11M44S")
// to a human-readable "HH:MM:SS" or "MM:SS" format and total seconds.
func parseISODuration(iso string) (string, int) {
	re := regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)
	m := re.FindStringSubmatch(iso)
	if len(m) < 4 {
		return iso, 0
	}

	hours := atoiSafe(m[1])
	minutes := atoiSafe(m[2])
	seconds := atoiSafe(m[3])
	total := hours*3600 + minutes*60 + seconds

	return fmtDuration(hours, minutes, seconds), total
}

// atoiSafe converts a numeric string to int, returning 0 on error.
func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

// fmtDuration formats hours, minutes, seconds into "HH:MM:SS" or "MM:SS".
func fmtDuration(h, m, s int) string {
	if h > 0 {
		return pad2(h) + ":" + pad2(m) + ":" + pad2(s)
	}
	return pad2(m) + ":" + pad2(s)
}

// pad2 ensures a number string has a leading zero if single digit.
func pad2(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	b := []byte{}
	if n >= 100 {
		b = append(b, byte('0'+n/100))
	}
	b = append(b, byte('0'+(n/10)%10))
	b = append(b, byte('0'+n%10))
	return string(b)
}

// parseUploadDate converts an ISO 8601 date string to "YYYY-MM-DD" format.
func parseUploadDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		// Try date-only format.
		t, err = time.Parse("2006-01-02", dateStr)
		if err != nil {
			return dateStr
		}
	}
	return t.Format("2006-01-02")
}

// ExtractViewKey extracts the video view key from a URL like
// https://www.pornhub.com/view_video.php?viewkey=ph5f4a1b2c3d4e5
// or https://www.pornhub.com/watch/ph5f4a1b2c3d4e5
func ExtractViewKey(rawURL string) string {
	m := ViewKeyPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractViews parses the views count from text like "539,480".
func ExtractViews(text string) int {
	cleaned := ""
	for _, c := range text {
		if c >= '0' && c <= '9' {
			cleaned += string(c)
		}
	}
	return atoiSafe(cleaned)
}
