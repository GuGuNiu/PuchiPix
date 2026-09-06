package porn91

import (
	"testing"
)

// TestExtractVideoID verifies extraction of video IDs from 91porn.plus URLs.
func TestExtractVideoID(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		want    string
	}{
		{
			name: "standard detail URL",
			url:  "https://91porn.plus/video/vMoXOjXEp",
			want: "vMoXOjXEp",
		},
		{
			name: "URL with trailing slash",
			url:  "https://91porn.plus/video/abc123/",
			want: "abc123",
		},
		{
			name: "URL with query params",
			url:  "https://91porn.plus/video/xyz789?ref=home",
			want: "xyz789",
		},
		{
			name: "non-video URL",
			url:  "https://91porn.plus/category/1/latest",
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
			got := ExtractVideoID(tt.url)
			if got != tt.want {
				t.Errorf("ExtractVideoID(%q) = %q, want %q", tt.url, got, tt.want)
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
		{"with text", "140,323 Views", 140323},
		{"empty", "", 0},
		{"large number", "1,000,000", 1000000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractViews(tt.text)
			if got != tt.want {
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
			got := parseISODuration(tt.iso)
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
		{
			name: "standard ISO date",
			date: "2026-08-09T16:00:00.000Z",
			want: "2026-08-09",
		},
		{
			name: "date without time",
			date: "2026-01-15",
			want: "2026-01-15",
		},
		{
			name: "invalid date",
			date: "invalid",
			want: "invalid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseUploadDate(tt.date)
			if got != tt.want {
				t.Errorf("parseUploadDate(%q) = %q, want %q", tt.date, got, tt.want)
			}
		})
	}
}

// TestExtractJSONLDVideoObject verifies extraction of M3U8 URL from
// JSON-LD structured data, matching the real page structure from the
// 91porn.plus reverse engineering report.
func TestExtractJSONLDVideoObject(t *testing.T) {
	html := `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "name": "镜子面前让母狗",
  "description": "在线观看",
  "thumbnailUrl": ["https://tp.helloye.com/vMoXOjXEp.jpg"],
  "uploadDate": "2026-08-09T16:00:00.000Z",
  "duration": "PT11M30S",
  "contentUrl": "https://tm.helloye.com/qovQAryXM6t4erxS3j8Q6A==,1787827186/6a884c1f3a19e44b93b4fe61/index.m3u8",
  "interactionStatistic": {
    "@type": "InteractionCounter",
    "interactionType": {"@type": "WatchAction"},
    "userInteractionCount": 140232
  }
}
</script>
</head><body></body></html>`

	obj, err := extractJSONLDVideoObject(html)
	if err != nil {
		t.Fatalf("extractJSONLDVideoObject failed: %v", err)
	}

	if obj.Type != "VideoObject" {
		t.Errorf("Type = %q, want %q", obj.Type, "VideoObject")
	}
	if obj.Name != "镜子面前让母狗" {
		t.Errorf("Name = %q, want %q", obj.Name, "镜子面前让母狗")
	}
	if obj.ContentURL != "https://tm.helloye.com/qovQAryXM6t4erxS3j8Q6A==,1787827186/6a884c1f3a19e44b93b4fe61/index.m3u8" {
		t.Errorf("ContentURL = %q, want the m3u8 URL", obj.ContentURL)
	}
	if obj.UploadDate != "2026-08-09T16:00:00.000Z" {
		t.Errorf("UploadDate = %q, want %q", obj.UploadDate, "2026-08-09T16:00:00.000Z")
	}
	if obj.Duration != "PT11M30S" {
		t.Errorf("Duration = %q, want %q", obj.Duration, "PT11M30S")
	}
	if obj.InteractionStatistic.UserInteractionCount != 140232 {
		t.Errorf("Views = %d, want %d", obj.InteractionStatistic.UserInteractionCount, 140232)
	}
	if len(obj.ThumbnailURL) != 1 || obj.ThumbnailURL[0] != "https://tp.helloye.com/vMoXOjXEp.jpg" {
		t.Errorf("ThumbnailURL = %v, want [https://tp.helloye.com/vMoXOjXEp.jpg]", obj.ThumbnailURL)
	}
}

// TestExtractJSONLDVideoObject_NoJSONLD verifies the fallback regex extraction
// when no proper JSON-LD script block is found but the contentUrl is present
// in the raw HTML.
func TestExtractJSONLDVideoObject_NoJSONLD(t *testing.T) {
	// No proper JSON-LD script block, but contentUrl pattern exists in raw JS.
	html := `<html><body>
<script>var data = {"@type":"VideoObject","contentUrl":"https://cdn.example.com/video.m3u8","name":"Test Video"}</script>
</body></html>`

	obj, err := extractJSONLDVideoObject(html)
	if err != nil {
		t.Fatalf("extractJSONLDVideoObject failed: %v", err)
	}

	if obj.ContentURL != "https://cdn.example.com/video.m3u8" {
		t.Errorf("ContentURL = %q, want %q", obj.ContentURL, "https://cdn.example.com/video.m3u8")
	}
	if obj.Name != "Test Video" {
		t.Errorf("Name = %q, want %q", obj.Name, "Test Video")
	}
}

// TestExtractJSONLDVideoObject_NoContentURL verifies error when no contentUrl
// is found anywhere in the HTML.
func TestExtractJSONLDVideoObject_NoContentURL(t *testing.T) {
	html := `<html><head><script type="application/ld+json">{"@type":"WebPage"}</script></head></html>`

	_, err := extractJSONLDVideoObject(html)
	if err == nil {
		t.Error("expected error when no contentUrl found, got nil")
	}
}

// TestResolveURL verifies URL resolution from relative to absolute.
func TestResolveURL(t *testing.T) {
	base := "https://91porn.plus"

	tests := []struct {
		name string
		href string
		want string
	}{
		{"absolute https", "https://cdn.example.com/video.m3u8", "https://cdn.example.com/video.m3u8"},
		{"protocol-relative", "//cdn.example.com/video.m3u8", "https://cdn.example.com/video.m3u8"},
		{"root-relative", "/video/abc123", "https://91porn.plus/video/abc123"},
		{"relative", "video/abc123", "https://91porn.plus/video/abc123"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveURL(tt.href, base)
			if got != tt.want {
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
		{"standard URL", "https://91porn.plus/video/abc", "https://91porn.plus"},
		{"URL with path", "https://91porn.plus/category/1/latest/2", "https://91porn.plus"},
		{"URL with port", "http://localhost:8080/test", "http://localhost:8080"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractBaseURL(tt.url)
			if got != tt.want {
				t.Errorf("extractBaseURL(%q) = %q, want %q", tt.url, got, tt.want)
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
			got := pad2(tt.n)
			if got != tt.want {
				t.Errorf("pad2(%d) = %q, want %q", tt.n, got, tt.want)
			}
		})
	}
}
