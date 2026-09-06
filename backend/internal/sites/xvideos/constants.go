package xvideos

import (
	"regexp"
	"time"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID            string   `json:"id"`
	EncodedID     string   `json:"encodedId"`
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
	M3U8URL    string `json:"m3u8Url"`
	MP4URL     string `json:"mp4Url,omitempty"`
	VideoUUID  string `json:"videoUuid,omitempty"`
	CDNID      string `json:"cdnId,omitempty"`
}

// SortType represents the available sorting options on XVIDEOS.
type SortType string

const (
	SortTypeLatest  SortType = "latest"   // 最新
	SortTypeHottest SortType = "hottest"  // 最热
	SortTypeRated   SortType = "rated"    // 评分最高
	SortTypeLongest SortType = "longest"  // 时长最长
)

// URL patterns for XVIDEOS site.
// The site uses the following URL structure:
//   - Detail page:  /video.{encodedId}/{slug}
//   - Listing page: /{sort} (e.g. /latest, /hottest)
//   - Search page:  /?k={keyword}&p={page}
const (
	// DetailPathPattern matches /video.oobhaop4b5e/_cos_
	DetailPathPattern = `/video\.([a-zA-Z0-9]+)`
)

// Pre-compiled regex patterns.
var (
	// EncodedID extraction from URL: /video.oobhaop4b5e/...
	EncodedIDPattern = regexp.MustCompile(`/video\.([a-zA-Z0-9]+)`)

	// HLS M3U8 URL from html5player.setVideoHLS('...')
	HLSURLPattern = regexp.MustCompile(`setVideoHLS\(\s*['"]([^'"]+)['"]\s*\)`)

	// MP4 URL from html5player.setVideoUrlLow('...') or setVideoUrlHigh('...')
	MP4URLPattern = regexp.MustCompile(`setVideoUrl(?:Low|High)\(\s*['"]([^'"]+)['"]\s*\)`)

	// Video title from html5player.setVideoTitle('...')
	VideoTitlePattern = regexp.MustCompile(`setVideoTitle\(\s*'(?:<\?[^>]+>\s*)?([^']+)'\s*\)`)

	// Encoded ID from html5player.setEncodedIdVideo('...')
	EncodedIDScriptPattern = regexp.MustCompile(`setEncodedIdVideo\(\s*['"]([^'"]+)['"]\s*\)`)

	// CDN ID from html5player.setIdCDN('...')
	CDNIDPattern = regexp.MustCompile(`setIdCDN\(\s*['"]([^'"]+)['"]\s*\)`)

	// Uploader name from html5player.setUploaderName('...')
	UploaderPattern = regexp.MustCompile(`setUploaderName\(\s*['"]([^'"]+)['"]\s*\)`)

	// Video UUID extraction from HLS URL: /{uuid}/{cdn_id}/hls.m3u8
	VideoUUIDPattern = regexp.MustCompile(`/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/\d+/hls\.m3u8`)

	// Thumbnail/poster URL from meta tag or html5player
	ThumbnailPattern = regexp.MustCompile(`(?:setVideoThumbUrl|setThumbUrl)\(\s*['"]([^'"]+)['"]\s*\)`)

	// Views extraction from text like "539,480" or "539480 views"
	ViewsPattern = regexp.MustCompile(`([\d,]+)\s*(?:views|次观看)?`)

	// Duration extraction: ISO 8601 "PT00H11M44S"
	ISODurationPattern = regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)

	// JSON-LD script block detection
	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)

	// OG title meta tag
	OGTitlePattern = regexp.MustCompile(`<meta\s+property="og:title"\s+content="([^"]*)"`)

	// OG image meta tag
	OGImagePattern = regexp.MustCompile(`<meta\s+property="og:image"\s+content="([^"]*)"`)

	// Upload date from JSON-LD: "2026-05-19T22:00:00+00:00"
	UploadDatePattern = regexp.MustCompile(`"uploadDate"\s*:\s*"([^"]+)"`)

	// Duration from JSON-LD: "PT00H11M44S"
	JSONLDDurationPattern = regexp.MustCompile(`"duration"\s*:\s*"([^"]+)"`)

	// Interaction count from JSON-LD
	InteractionCountPattern = regexp.MustCompile(`"userInteractionCount"\s*:\s*(\d+)`)

	// Name from JSON-LD
	JSONLDNamePattern = regexp.MustCompile(`"name"\s*:\s*"([^"]*)"`)

	// Thumbnail URL from JSON-LD
	JSONLDThumbnailPattern = regexp.MustCompile(`"thumbnailUrl"\s*:\s*\[?"([^"]+)"\]?`)

	// Content URL from JSON-LD (MP4 direct link)
	JSONLDContentURLPattern = regexp.MustCompile(`"contentUrl"\s*:\s*"([^"]+)"`)
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

// pad2 ensures a number string has leading zero if single digit.
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
		return dateStr
	}
	return t.Format("2006-01-02")
}

// ExtractEncodedID extracts the encoded video ID from a URL like /video.oobhaop4b5e/...
func ExtractEncodedID(rawURL string) string {
	m := EncodedIDPattern.FindStringSubmatch(rawURL)
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
