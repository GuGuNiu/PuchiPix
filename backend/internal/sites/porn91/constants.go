package porn91

import (
	"regexp"
	"time"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	PageURL      string `json:"pageUrl"`
	ThumbnailURL string `json:"thumbnailUrl"`
	Views        int    `json:"views"`
	ViewsText    string `json:"viewsText"`
	Duration     string `json:"duration"`
	PublishDate  string `json:"publishDate"`
	Author       string `json:"author"`
	Tags         []string `json:"tags"`
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
// including the M3U8 stream URL extracted from JSON-LD structured data.
type VideoDetailResult struct {
	VideoMetadata
	M3U8URL     string `json:"m3u8Url"`
	Description string `json:"description"`
}

// SortType represents the available sorting options.
type SortType string

const (
	SortTypeLatest   SortType = "latest"    // 最新
	SortTypeHottest  SortType = "hottest"   // 最热
	SortTypeTopRated SortType = "toprated"  // 评分最高
)

// URL patterns for 91porn.plus site.
// The site is an Angular (Ionic) SPA with the following URL structure:
//   - Detail page:  /video/{videoId}
//   - Listing page: /category/{categoryId}/{sort}/{page}
//   - Search page:  /search/{keyword}/{page}
const (
	DetailPathFormat  = "/video/%s"
	ListingPathFormat = "/category/%d/%s/%d"
	SearchPathFormat  = "/search/%s/%d"
)

// Pre-compiled regex patterns.
var (
	// VideoID extraction from URL: /video/vMoXOjXEp
	VideoIDPattern = regexp.MustCompile(`/video/([a-zA-Z0-9]+)`)

	// Views extraction from text like "140,323" or "140323"
	ViewsPattern = regexp.MustCompile(`([\d,]+)`)

	// Duration extraction: "PT11M30S" → "11:30"
	ISODurationPattern = regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)

	// Thumbnail URL extraction from JSON-LD
	ThumbnailPattern = regexp.MustCompile(`"thumbnailUrl"\s*:\s*\[?"([^"]+)"\]?`)

	// JSON-LD VideoObject contentUrl extraction
	ContentURLPattern = regexp.MustCompile(`"contentUrl"\s*:\s*"([^"]+)"`)

	// Upload date extraction from JSON-LD: "2026-08-09T16:00:00.000Z"
	UploadDatePattern = regexp.MustCompile(`"uploadDate"\s*:\s*"([^"]+)"`)

	// Interaction count extraction from JSON-LD
	InteractionCountPattern = regexp.MustCompile(`"userInteractionCount"\s*:\s*(\d+)`)

	// JSON-LD script block detection
	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)
)

// parseISODuration converts an ISO 8601 duration string (e.g. "PT11M30S")
// to a human-readable "HH:MM:SS" or "MM:SS" format.
func parseISODuration(iso string) string {
	m := ISODurationPattern.FindStringSubmatch(iso)
	if len(m) < 4 {
		return iso
	}

	hours := 0
	minutes := 0
	seconds := 0

	if m[1] != "" {
		hours = atoiSafe(m[1])
	}
	if m[2] != "" {
		minutes = atoiSafe(m[2])
	}
	if m[3] != "" {
		seconds = atoiSafe(m[3])
	}

	if hours > 0 {
		return fmtDuration(hours, minutes, seconds)
	}
	return fmtDuration(0, minutes, seconds)
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

// padZero ensures a number string has leading zero if single digit.
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

// parseUploadDate converts an ISO 8601 date string (e.g. "2026-08-09T16:00:00.000Z")
// to a "YYYY-MM-DD" format. Falls back to the original string on parse failure.
func parseUploadDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return dateStr
	}
	return t.Format("2006-01-02")
}

// ExtractVideoID extracts the video ID from a URL like /video/vMoXOjXEp.
func ExtractVideoID(rawURL string) string {
	m := VideoIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractViews parses the views count from text like "140,323".
func ExtractViews(text string) int {
	cleaned := ""
	for _, c := range text {
		if c >= '0' && c <= '9' {
			cleaned += string(c)
		}
	}
	return atoiSafe(cleaned)
}
