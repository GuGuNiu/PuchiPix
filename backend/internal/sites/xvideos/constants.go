package xvideos

import (
	"regexp"
	"time"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID            string   `json:"id"`
	EncodedID     string   `json:"encodedId"`
	VideoID       string   `json:"videoId,omitempty"`
	CDNID         string   `json:"cdnId,omitempty"`
	Title         string   `json:"title"`
	TitleOriginal string   `json:"titleOriginal,omitempty"`
	PageURL       string   `json:"pageUrl"`
	ThumbnailURL  string   `json:"thumbnailUrl"`
	Views         int      `json:"views"`
	ViewsText     string   `json:"viewsText"`
	Duration      string   `json:"duration"`
	DurationSec   int      `json:"durationSec"`
	PublishDate   string   `json:"publishDate"`
	Uploader      string   `json:"uploader"`
	UploaderID    string   `json:"uploaderId,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Categories    []string `json:"categories,omitempty"`
	Pornstars     []string `json:"pornstars,omitempty"`
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
// including the HLS M3U8 URL and MP4 direct link extracted from inline scripts.
type VideoDetailResult struct {
	VideoMetadata
	M3U8URL   string `json:"m3u8Url"`
	MP4URL    string `json:"mp4Url,omitempty"`
	VideoUUID string `json:"videoUuid,omitempty"`
	CDNID     string `json:"cdnId,omitempty"`
}

// SortType represents the available sorting options on XVIDEOS.
type SortType string

const (
	SortTypeLatest  SortType = "latest"
	SortTypeHottest SortType = "hottest"
	SortTypeRated   SortType = "rated"
	SortTypeLongest SortType = "longest"
)

// Detail pages live at /video.{encodedId}/{slug}, listing pages at /{sort},
// and search at /?k={keyword}&p={page}
const (
	DetailPathPattern = `/video\.([a-zA-Z0-9]+)`
)

// Pre-compiled at package init so listing scrapes do not recompile them per page
var (
	// All three detail URL shapes are in use: /video.{encodedId}/{slug},
	// the older /video{numericId}/{slug}, and the embed frame. The two
	// alternatives capture into separate groups so the caller can pick
	// whichever matched.
	EncodedIDPattern = regexp.MustCompile(`/video\.?([a-zA-Z0-9]+)|/embedframe/([a-zA-Z0-9]+)`)

	// The player config object is the third constructor argument of
	// new HTML5Player and carries the site's own categories and keyword
	// tags, which is the only structured source for both.
	PlayerConfigPattern = regexp.MustCompile(`(?s)new\s+HTML5Player\s*\([^,]+,\s*['"]?\d+['"]?\s*,\s*(\{.*?\})\s*\)`)

	HLSURLPattern = regexp.MustCompile(`setVideoHLS\(\s*['"]([^'"]+)['"]\s*\)`)

	MP4URLPattern = regexp.MustCompile(`setVideoUrl(?:Low|High)\(\s*['"]([^'"]+)['"]\s*\)`)

	// flv_url appears in a legacy query-string based player configuration.
	LegacyFLVURLPattern = regexp.MustCompile(`flv_url=([^&'"]+)`)

	VideoTitlePattern = regexp.MustCompile(`setVideoTitle\(\s*'(?:<\?[^>]+>\s*)?([^']+)'\s*\)`)

	EncodedIDScriptPattern = regexp.MustCompile(`setEncodedIdVideo\(\s*['"]([^'"]+)['"]\s*\)`)

	CDNIDPattern = regexp.MustCompile(`setIdCDN\(\s*['"]([^'"]+)['"]\s*\)`)

	UploaderPattern = regexp.MustCompile(`setUploaderName\(\s*['"]([^'"]+)['"]\s*\)`)

	// HLS playlist URLs are laid out as /{uuid}/{cdn_id}/hls.m3u8
	VideoUUIDPattern = regexp.MustCompile(`/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/\d+/hls\.m3u8`)

	ThumbnailPattern = regexp.MustCompile(`(?:setVideoThumbUrl|setThumbUrl)\(\s*['"]([^'"]+)['"]\s*\)`)

	// og:duration is published in whole seconds.
	OGDurationPattern = regexp.MustCompile(`<meta\s+property="og:duration"\s+content="([^"]*)"`)

	// Listing cards render the duration as "7 min" / "1 h 12 min" rather
	// than a clock value, so the two forms are matched separately.
	CardDurationClockPattern = regexp.MustCompile(`(\d{1,2}:\d{2}(?::\d{2})?)`)
	CardDurationHoursPattern = regexp.MustCompile(`(\d+)\s*h`)
	CardDurationMinsPattern  = regexp.MustCompile(`(\d+)\s*min`)

	// Upload date is published as a JS string in the page payload.
	UploadDateScriptPattern = regexp.MustCompile(`uploadDate"?\s*[:=]\s*"([^"]+)"`)

	// Views live in the action bar as a comma-grouped number, published
	// twice: an exact value for desktop and an abbreviated one for mobile.
	// Only the exact form is read, otherwise the two would be concatenated
	// into a wrong count.
	ViewsBlockPattern    = regexp.MustCompile(`(?s)id="v-views"[^>]*>(.*?)</div>`)
	ViewsExactPattern    = regexp.MustCompile(`class="[^"]*mobile-hide[^"]*"[^>]*>([\d,.]+)<`)
	ViewsFallbackPattern = regexp.MustCompile(`([\d,.]+)`)

	// The page heading carries the title, the rounded duration and the
	// resolution mark as sibling spans.
	PageTitlePattern = regexp.MustCompile(`(?s)<h2[^>]*class="page-title"[^>]*>(.*?)</h2>`)

	// Pornstar entries are the label-list items flagged is-pornstar.
	PornstarNamePattern = regexp.MustCompile(`(?s)class="name">(.*?)</span>`)
	// A removed, private or region-blocked video renders this banner.
	InlineErrorPattern = regexp.MustCompile(`<h1[^>]*class="inlineError"[^>]*>(.+?)</h1>`)

	// ISO 8601 duration, e.g. PT11M30S
	ISODurationPattern = regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)

	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)

	OGTitlePattern = regexp.MustCompile(`<meta\s+property="og:title"\s+content="([^"]*)"`)

	OGImagePattern = regexp.MustCompile(`<meta\s+property="og:image"\s+content="([^"]*)"`)

	JSONLDNamePattern = regexp.MustCompile(`"name"\s*:\s*"([^"]*)"`)

	JSONLDThumbnailPattern = regexp.MustCompile(`"thumbnailUrl"\s*:\s*\[?"([^"]+)"\]?`)
)

// parseISODuration converts an ISO 8601 duration string (e.g. "PT00H11M44S")
// to a human-readable "HH:MM:SS" or "MM:SS" format and total seconds.
func parseISODuration(iso string) (string, int) {
	m := ISODurationPattern.FindStringSubmatch(iso)
	if len(m) < 4 {
		return iso, 0
	}

	hours := atoiSafe(m[1])
	minutes := atoiSafe(m[2])
	seconds := atoiSafe(m[3])
	total := hours*3600 + minutes*60 + seconds

	return fmtDuration(hours, minutes, seconds), total
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

func parseUploadDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return dateStr
	}
	return t.Format("2006-01-02")
}

func ExtractEncodedID(rawURL string) string {
	m := EncodedIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 3 {
		if m[1] != "" {
			return m[1]
		}
		return m[2]
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
