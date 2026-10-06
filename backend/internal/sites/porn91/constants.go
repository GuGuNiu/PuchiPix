package porn91

import (
	"regexp"
	"time"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	PageURL      string   `json:"pageUrl"`
	ThumbnailURL string   `json:"thumbnailUrl"`
	Views        int      `json:"views"`
	ViewsText    string   `json:"viewsText"`
	Duration     string   `json:"duration"`
	DurationSec  int      `json:"durationSec"`
	PublishDate  string   `json:"publishDate"`
	Author       string   `json:"author"`
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
	SortTypeLatest   SortType = "latest"
	SortTypeHottest  SortType = "hottest"
	SortTypeTopRated SortType = "toprated"
)

// The site is an Angular (Ionic) SPA whose routes are detail /video/{videoId},
// listing /category/{categoryId}/{sort}/{page} and search /search/{keyword}/{page}
const (
	DetailPathFormat  = "/video/%s"
	ListingPathFormat = "/category/%d/%s/%d"
	SearchPathFormat  = "/search/%s/%d"
)

// Pre-compiled at package init so listing scrapes do not recompile them per page
var (
	VideoIDPattern = regexp.MustCompile(`/video/([a-zA-Z0-9]+)`)

	// ISO 8601 duration, e.g. PT11M30S
	ISODurationPattern = regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)

	ThumbnailPattern = regexp.MustCompile(`"thumbnailUrl"\s*:\s*\[?"([^"]+)"\]?`)

	ContentURLPattern = regexp.MustCompile(`"contentUrl"\s*:\s*"([^"]+)"`)

	UploadDatePattern = regexp.MustCompile(`"uploadDate"\s*:\s*"([^"]+)"`)

	InteractionCountPattern = regexp.MustCompile(`"userInteractionCount"\s*:\s*(\d+)`)

	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)

	// The site publishes no tag or category markup, so the keywords meta
	// tag is the only structured tag source on a detail page.
	MetaKeywordsPattern = regexp.MustCompile(`(?is)<meta\s+name="keywords"\s+content="([^"]*)"`)

	OGTitlePattern = regexp.MustCompile(`<meta\s+property="og:title"\s+content="([^"]*)"`)

	OGImagePattern = regexp.MustCompile(`<meta\s+property="og:image"\s+content="([^"]*)"`)
)

// brandKeywordPrefixes are the site's own SEO keywords, which appear in
// every detail page's keywords meta tag and describe the site rather than
// the video. A keyword that starts with one of these is dropped.
var brandKeywordPrefixes = []string{"91porn", "91视频", "91视頻", "91p"}

// parseISODuration converts an ISO 8601 duration string (e.g. "PT11M30S")
// to a human-readable "HH:MM:SS" or "MM:SS" format.
func parseISODuration(iso string) string {
	text, _ := parseISODurationSeconds(iso)
	return text
}

// parseISODurationSeconds converts an ISO 8601 duration string to its
// display form and the total number of seconds, which the pipeline records
// on the video row.
func parseISODurationSeconds(iso string) (string, int) {
	m := ISODurationPattern.FindStringSubmatch(iso)
	if len(m) < 4 {
		return iso, 0
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
		return fmtDuration(hours, minutes, seconds), hours*3600 + minutes*60 + seconds
	}
	return fmtDuration(0, minutes, seconds), minutes*60 + seconds
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func fmtDuration(h, m, s int) string {
	if h > 0 {
		return pad2(h) + ":" + pad2(m) + ":" + pad2(s)
	}
	return pad2(m) + ":" + pad2(s)
}

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

// parseUploadDate converts an ISO 8601 date string to "YYYY-MM-DD" and returns
// the input unchanged when parsing fails.
func parseUploadDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return dateStr
	}
	return t.Format("2006-01-02")
}

func ExtractVideoID(rawURL string) string {
	m := VideoIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func ExtractViews(text string) int {
	cleaned := ""
	for _, c := range text {
		if c >= '0' && c <= '9' {
			cleaned += string(c)
		}
	}
	return atoiSafe(cleaned)
}
