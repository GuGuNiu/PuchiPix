package pornhub

import (
	"regexp"
	"strconv"
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
	Duration      string   `json:"duration"`
	DurationSec   int      `json:"durationSec"`
	PublishDate   string   `json:"publishDate"`
	Uploader      string   `json:"uploader"`
	UploaderURL   string   `json:"uploaderUrl,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Categories    []string `json:"categories,omitempty"`
	Cast          []string `json:"cast,omitempty"`
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
// including the HLS M3U8 URLs and MP4 direct links extracted from the
// inline flashvars object.
type VideoDetailResult struct {
	VideoMetadata
	M3U8URL string `json:"m3u8Url"`
	// M3U8Candidates holds every HLS quality the page advertises, ordered
	// from the site's default quality downwards.
	M3U8Candidates []M3U8Candidate   `json:"m3u8Candidates,omitempty"`
	MP4URL         string            `json:"mp4Url,omitempty"`
	MP4Links       map[string]string `json:"mp4Links,omitempty"` // quality label -> URL
	// GetMediaURL is the /video/get_media endpoint advertised as an
	// MP4 rendition. It answers with a JSON list of direct MP4 links, or
	// an empty list when the video is HLS-only.
	GetMediaURL string `json:"getMediaUrl,omitempty"`
	// UploadDateFromURL is the YYYYMMDD date encoded in the media path.
	UploadDateFromURL string `json:"uploadDateFromUrl,omitempty"`
}

// M3U8Candidate is one HLS quality discovered in the flashvars object.
type M3U8Candidate struct {
	URL    string
	Title  string
	Height int
}

// SortType represents the available sorting options on PORNHUB.
type SortType string

const (
	SortTypeNewest     SortType = "newest"
	SortTypeMostViewed SortType = "mostviewed"
	SortTypeTopRated   SortType = "toprated"
	SortTypeLongest    SortType = "longest"
)

// Detail pages are /view_video.php?viewkey={key} or /watch/{key}; listing
// pages cover the homepage, /video?search=..., /categories and /playlists;
// search lives at /video/search?search={keyword}&page={page}
const (
	DetailViewKeyPattern = `(?:[?&]viewkey=|/watch/)([a-zA-Z0-9]+)`
)

// Pre-compiled at package init so listing scrapes do not recompile them per page
var (
	ViewKeyPattern = regexp.MustCompile(DetailViewKeyPattern)

	// The player configuration is emitted as a single JSON object assigned
	// to flashvars_N. Verified against live pages: the per-quality stream
	// list lives in its mediaDefinitions array, and there is no hlsUrl,
	// playerObjectList or quality_NNNp key on the current site.
	FlashvarsPattern = regexp.MustCompile(`(?s)var\s+flashvars_\d+\s*=\s*(\{.*?\});`)

	// Legacy quality_NNNp keys, still present on some cached pages.
	MP4QualityPattern = regexp.MustCompile(`"quality_(\d+p)"\s*:\s*"([^"]+)"`)

	TwitterTitlePattern = regexp.MustCompile(`<meta\s+name="twitter:title"\s+content="([^"]*)"`)

	ThumbnailPattern = regexp.MustCompile(`<meta\s+property="og:image"\s+content="([^"]*)"`)

	JSONLDVideoObjectPattern = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)

	JSONLDNamePattern = regexp.MustCompile(`"name"\s*:\s*"([^"]*)"`)

	// MODEL_PROFILE carries the uploader display name for model uploads.
	ModelProfilePattern = regexp.MustCompile(`(?s)var\s+MODEL_PROFILE\s*=\s*(\{.*?\});`)

	// uploaderLink is an HTML fragment, so the name is read from the anchor
	// it wraps rather than from a JSON string field.
	AnchorTextPattern = regexp.MustCompile(`>([^<>]+)<`)

	// The media path embeds the upload date as YYYYMM/DD.
	MediaPathDatePattern = regexp.MustCompile(`/videos/(\d{4})(\d{2})/(\d{2})/`)

	// Anti-bot interstitial markers. A page matching any of these needs a
	// JavaScript-capable fetch before the stream can be read.
	AntiBotReloadPattern = regexp.MustCompile(`document\.location\.reload\(true\)`)
	AntiBotRNKeyPattern  = regexp.MustCompile(`document\.cookie\s*=\s*['"]RNKEY=`)
	AntiBotGoPattern     = regexp.MustCompile(`<body\b[^>]*\bonload=["']go\(\)`)

	ISODurationPattern = regexp.MustCompile(`PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?`)
)

// AgeGateCookies satisfies PORNHUB's age disclaimer. Without them the site
// serves the disclaimer interstitial instead of the player page, so no
// flashvars object is present and no stream can be found.
const AgeGateCookies = "age_verified=1; accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; accessPH=1; platform=pc"

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

// pad2 renders a time component with a leading zero below ten.
func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// parseUploadDate returns the input unchanged when it is not a parseable date.
func parseUploadDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		t, err = time.Parse("2006-01-02", dateStr)
		if err != nil {
			return dateStr
		}
	}
	return t.Format("2006-01-02")
}

// ExtractViewKey returns the view key from both the legacy
// /view_video.php?viewkey={key} and the current /watch/{key} URL forms.
func ExtractViewKey(rawURL string) string {
	m := ViewKeyPattern.FindStringSubmatch(rawURL)
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

// IsAntiBotPage reports whether the HTML is an anti-bot interstitial rather
// than a real video page. The caller escalates to a browser fetch when this
// returns true.
func IsAntiBotPage(html string) bool {
	return AntiBotGoPattern.MatchString(html) ||
		AntiBotRNKeyPattern.MatchString(html) ||
		AntiBotReloadPattern.MatchString(html)
}
