package pornhub

import (
	"strings"
	"testing"
)

// TestExtractViewKey verifies extraction of view keys from PORNHUB URLs.
func TestExtractViewKey(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "legacy view_video URL",
			url:  "https://www.pornhub.com/view_video.php?viewkey=ph5f4a1b2c3d4e5",
			want: "ph5f4a1b2c3d4e5",
		},
		{
			name: "new watch URL",
			url:  "https://www.pornhub.com/watch/ph5f4a1b2c3d4e5",
			want: "ph5f4a1b2c3d4e5",
		},
		{
			name: "URL with extra params",
			url:  "https://www.pornhub.com/view_video.php?viewkey=ph612ab34cd56ef&t=comments",
			want: "ph612ab34cd56ef",
		},
		{
			name: "listing page URL",
			url:  "https://www.pornhub.com/video/search?search=test",
			want: "",
		},
		{
			name: "empty URL",
			url:  "",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractViewKey(tt.url)
			if got != tt.want {
				t.Errorf("ExtractViewKey(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

// TestExtractMediaURLs verifies M3U8/MP4 extraction from a flashvars-like
// HTML snippet mirroring the real page structure.
func TestExtractMediaURLs(t *testing.T) {
	html := `<script>
var playerObjectList = [{
	"flashvars": {
		"quality_720p": "https:\/\/ev.phncdn.com\/videos\/202008\/27\/353493742\/720_353493742.mp4?val=abc",
		"quality_480p": "https:\/\/ev.phncdn.com\/videos\/202008\/27\/353493742\/480_353493742.mp4?val=abc",
		"hlsUrl": "https:\/\/manifest.googlevideo.com\/hls\/index.m3u8?token=xyz"
	}
}];
</script>`

	result := &VideoDetailResult{}
	extractMediaURLs(html, result)

	if result.M3U8URL != "https://manifest.googlevideo.com/hls/index.m3u8?token=xyz" {
		t.Errorf("M3U8URL = %q, want the unescaped hls URL", result.M3U8URL)
	}
	if result.MP4URL != "https://ev.phncdn.com/videos/202008/27/353493742/720_353493742.mp4?val=abc" {
		t.Errorf("MP4URL = %q, want the 720p URL", result.MP4URL)
	}
	if len(result.MP4Links) != 2 {
		t.Errorf("MP4Links count = %d, want 2", len(result.MP4Links))
	}
	if result.MP4Links["720"] == "" || result.MP4Links["480"] == "" {
		t.Errorf("MP4Links = %v, want 720 and 480 entries", result.MP4Links)
	}
}

// TestExtractMediaURLs_MediaUrlFallback verifies the "mediaUrl" fallback
// when no quality_* links exist.
func TestExtractMediaURLs_MediaUrlFallback(t *testing.T) {
	html := `<script>{"mediaUrl":"https:\/\/ev.phncdn.com\/video.mp4"}</script>`

	result := &VideoDetailResult{}
	extractMediaURLs(html, result)

	if result.MP4URL != "https://ev.phncdn.com/video.mp4" {
		t.Errorf("MP4URL = %q, want the mediaUrl fallback", result.MP4URL)
	}
}

// TestExtractTitle verifies title extraction from JSON-LD and og:title.
func TestExtractTitle(t *testing.T) {
	html := `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "name": "Test Video Title"
}
</script>
<meta property="og:title" content="Fallback Title - Pornhub.com">
</head></html>`

	if got := extractTitle(html); got != "Test Video Title" {
		t.Errorf("extractTitle = %q, want %q (JSON-LD first)", got, "Test Video Title")
	}

	htmlNoJSONLD := `<html><head>
<meta property="og:title" content="Fallback Title &amp; More - Pornhub.com">
</head></html>`
	if got := extractTitle(htmlNoJSONLD); got != "Fallback Title & More - Pornhub.com" {
		t.Errorf("extractTitle = %q, want og:title with entity decode", got)
	}
}

// TestExtractMetadataFromJSONLD verifies views/duration/date extraction.
func TestExtractMetadataFromJSONLD(t *testing.T) {
	html := `<script type="application/ld+json">
{
  "@type": "VideoObject",
  "uploadDate": "2026-08-09T16:00:00+00:00",
  "duration": "PT11M30S",
  "interactionStatistic": {"userInteractionCount": 140232}
}
</script>`

	result := &VideoDetailResult{}
	extractMetadataFromJSONLD(html, result)

	if result.PublishDate != "2026-08-09" {
		t.Errorf("PublishDate = %q, want %q", result.PublishDate, "2026-08-09")
	}
	if result.Duration != "11:30" {
		t.Errorf("Duration = %q, want %q", result.Duration, "11:30")
	}
	if result.DurationSec != 690 {
		t.Errorf("DurationSec = %d, want 690", result.DurationSec)
	}
	if result.Views != 140232 {
		t.Errorf("Views = %d, want 140232", result.Views)
	}
}

// TestExtractUploader verifies uploader extraction from JSON-LD author.
func TestExtractUploader(t *testing.T) {
	tests := []struct {
		name string
		html string
		want string
	}{
		{
			name: "simple author string",
			html: `<script type="application/ld+json">{"author":"Model Name"}</script>`,
			want: "Model Name",
		},
		{
			name: "nested author object",
			html: `<script type="application/ld+json">{"author":[{"name":"Channel X"}]}</script>`,
			want: "Channel X",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractUploader(tt.html); got != tt.want {
				t.Errorf("extractUploader = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestExtractViews verifies parsing of view counts from text.
func TestExtractViews(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{"comma-separated", "140,323", 140323},
		{"plain number", "12345", 12345},
		{"with suffix K", "12.5K", 125},
		{"empty", "", 0},
		{"large number", "1,000,000", 1000000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractViews(tt.text); got != tt.want {
				t.Errorf("ExtractViews(%q) = %d, want %d", tt.text, got, tt.want)
			}
		})
	}
}

// TestParseISODuration verifies conversion of ISO 8601 durations.
func TestParseISODuration(t *testing.T) {
	tests := []struct {
		name string
		iso  string
		want string
	}{
		{"minutes and seconds", "PT11M30S", "11:30"},
		{"hours minutes seconds", "PT1H2M30S", "01:02:30"},
		{"minutes only", "PT45M", "45:00"},
		{"seconds only", "PT30S", "00:30"},
		{"hours only", "PT2H", "02:00:00"},
		{"empty", "", ""},
		{"invalid", "invalid", "invalid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := parseISODuration(tt.iso)
			if got != tt.want {
				t.Errorf("parseISODuration(%q) = %q, want %q", tt.iso, got, tt.want)
			}
		})
	}
}

// TestParseUploadDate verifies parsing of ISO 8601 date strings.
func TestParseUploadDate(t *testing.T) {
	tests := []struct {
		name string
		date string
		want string
	}{
		{name: "standard ISO date", date: "2026-08-09T16:00:00.000Z", want: "2026-08-09"},
		{name: "date only", date: "2026-01-15", want: "2026-01-15"},
		{name: "invalid date", date: "invalid", want: "invalid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseUploadDate(tt.date); got != tt.want {
				t.Errorf("parseUploadDate(%q) = %q, want %q", tt.date, got, tt.want)
			}
		})
	}
}

// TestParseClockDuration verifies "HH:MM:SS"/"MM:SS" parsing.
func TestParseClockDuration(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{"mm:ss", "11:30", 690},
		{"hh:mm:ss", "1:02:30", 3750},
		{"zero padded", "00:45", 45},
		{"invalid", "abc", 0},
		{"empty", "", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseClockDuration(tt.text); got != tt.want {
				t.Errorf("parseClockDuration(%q) = %d, want %d", tt.text, got, tt.want)
			}
		})
	}
}

// TestResolveURL verifies URL resolution from relative to absolute.
func TestResolveURL(t *testing.T) {
	base := "https://www.pornhub.com"

	tests := []struct {
		name string
		href string
		want string
	}{
		{"absolute https", "https://cdn.example.com/video.m3u8", "https://cdn.example.com/video.m3u8"},
		{"protocol-relative", "//cdn.example.com/video.m3u8", "https://cdn.example.com/video.m3u8"},
		{"root-relative", "/view_video.php?viewkey=ph123", "https://www.pornhub.com/view_video.php?viewkey=ph123"},
		{"relative", "video/abc123", "https://www.pornhub.com/video/abc123"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveURL(tt.href, base); got != tt.want {
				t.Errorf("resolveURL(%q, %q) = %q, want %q", tt.href, base, got, tt.want)
			}
		})
	}
}

// TestExtractBaseURL verifies extraction of the scheme://host from a URL.
func TestExtractBaseURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"standard URL", "https://www.pornhub.com/watch/ph123", "https://www.pornhub.com"},
		{"URL with path", "https://www.pornhub.com/video/search?search=test", "https://www.pornhub.com"},
		{"URL with port", "http://localhost:8080/test", "http://localhost:8080"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractBaseURL(tt.url); got != tt.want {
				t.Errorf("extractBaseURL(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

// TestBuildNextPageURL verifies construction of the next page URL.
func TestBuildNextPageURL(t *testing.T) {
	tests := []struct {
		name       string
		currentURL string
		nextPage   int
		want       string
	}{
		{
			name:       "existing page param",
			currentURL: "https://www.pornhub.com/video/search?search=test&page=2",
			nextPage:   3,
			want:       "https://www.pornhub.com/video/search?search=test&page=3",
		},
		{
			name:       "query without page",
			currentURL: "https://www.pornhub.com/video/search?search=test",
			nextPage:   2,
			want:       "https://www.pornhub.com/video/search?search=test&page=2",
		},
		{
			name:       "no query",
			currentURL: "https://www.pornhub.com/video",
			nextPage:   2,
			want:       "https://www.pornhub.com/video?page=2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildNextPageURL(tt.currentURL, tt.nextPage); got != tt.want {
				t.Errorf("buildNextPageURL(%q, %d) = %q, want %q", tt.currentURL, tt.nextPage, got, tt.want)
			}
		})
	}
}

// TestPad2 verifies the pad2 helper function.
func TestPad2(t *testing.T) {
	tests := []struct {
		name string
		n    int
		want string
	}{
		{"zero", 0, "00"},
		{"single digit", 5, "05"},
		{"double digit", 30, "30"},
		{"triple digit", 120, "120"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pad2(tt.n); got != tt.want {
				t.Errorf("pad2(%d) = %q, want %q", tt.n, got, tt.want)
			}
		})
	}
}

// TestHtmlUnescape verifies decoding of common HTML entities.
func TestHtmlUnescape(t *testing.T) {
	if got := htmlUnescape("A &amp; B &lt;tag&gt; &#039;quoted&#039;"); got != "A & B <tag> 'quoted'" {
		t.Errorf("htmlUnescape = %q", got)
	}
}

// TestUnescapeJSONString verifies decoding of JSON string escapes.
func TestUnescapeJSONString(t *testing.T) {
	if got := unescapeJSONString(`https:\/\/ev.phncdn.com\/video.mp4`); !strings.HasSuffix(got, "ev.phncdn.com/video.mp4") {
		t.Errorf("unescapeJSONString = %q", got)
	}
	if got := unescapeJSONString("plain-value"); got != "plain-value" {
		t.Errorf("unescapeJSONString passthrough = %q", got)
	}
}
