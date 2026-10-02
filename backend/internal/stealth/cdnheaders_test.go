package stealth

import (
	"net/http"
	"testing"
	"time"
)

// Cloudflare in front of the media CDN answers HTTP 410 Gone to any request
// that carries only User-Agent, Accept and Referer, even though the exact
// same URL returns 200 for a real browser. Every header below is therefore
// load-bearing: dropping one silently breaks all downloads from the site.
func TestCDNRequestHeadersCarryClientHints(t *testing.T) {
	headers := CDNRequestHeaders(nil, "https://www.pornhub.com/", FetchDestEmpty)

	required := []string{
		"User-Agent",
		"Accept",
		"Accept-Language",
		"Sec-Ch-Ua",
		"Sec-Ch-Ua-Mobile",
		"Sec-Ch-Ua-Platform",
		"Sec-Fetch-Dest",
		"Sec-Fetch-Mode",
		"Sec-Fetch-Site",
		"Priority",
		"Referer",
	}
	for _, key := range required {
		if headers[key] == "" {
			t.Errorf("header %q is missing; Cloudflare answers 410 without it", key)
		}
	}
}

// A non-Chromium profile has no client hints of its own, and a random draw
// can pick one. Inheriting the Chrome hints is what keeps the request from
// being answered with 410.
func TestCDNRequestHeadersFillsMissingClientHints(t *testing.T) {
	firefox := BrowserProfile{UA: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", Browser: BrowserFirefox}

	headers := CDNRequestHeaders(&firefox, "", FetchDestEmpty)
	if headers["Sec-Ch-Ua"] == "" {
		t.Error("Sec-Ch-Ua is empty for a profile that carries none; Cloudflare would answer 410")
	}
	if headers["User-Agent"] != firefox.UA {
		t.Errorf("User-Agent = %q, want the supplied profile UA %q", headers["User-Agent"], firefox.UA)
	}

	// The no-profile path must be stable across calls: a random draw could
	// otherwise intermittently drop the hints.
	for i := 0; i < 50; i++ {
		if CDNRequestHeaders(nil, "", FetchDestEmpty)["Sec-Ch-Ua"] == "" {
			t.Fatal("Sec-Ch-Ua was empty on a no-profile call; the default profile is not stable")
		}
	}
}

func TestCDNRequestHeadersOmitsEmptyReferer(t *testing.T) {
	headers := CDNRequestHeaders(nil, "", FetchDestEmpty)
	if _, ok := headers["Referer"]; ok {
		t.Error("Referer is set from an empty value")
	}
}

func TestCDNRequestHeadersDestSelection(t *testing.T) {
	if got := CDNRequestHeaders(nil, "", FetchDestEmpty)["Sec-Fetch-Dest"]; got != "empty" {
		t.Errorf("Sec-Fetch-Dest = %q, want empty for a playlist fetch", got)
	}
	if got := CDNRequestHeaders(nil, "", FetchDestVideo)["Sec-Fetch-Dest"]; got != "video" {
		t.Errorf("Sec-Fetch-Dest = %q, want video for a progressive fetch", got)
	}
	// An unset dest must fall back rather than emit an empty header, which
	// would itself look non-browser.
	if got := CDNRequestHeaders(nil, "", "")["Sec-Fetch-Dest"]; got == "" {
		t.Error("Sec-Fetch-Dest is empty when no dest was requested")
	}
}

func TestCDNRequestHeadersUsesSuppliedProfile(t *testing.T) {
	profile := BrowserProfile{
		UA:                  "TestUA/1.0",
		SecChUa:             `"Test";v="1"`,
		SecChUaMobile:       "?0",
		SecChUaPlatform:     `"Windows"`,
		Accept:              "text/html",
		AcceptEncoding:      "gzip",
		Browser:             BrowserChrome,
		Platform:            PlatformWindows,
		NavigatorPlatform:   "Win32",
		HardwareConcurrency: 8,
		DeviceMemory:        8,
		MaxTouchPoints:      0,
	}

	headers := CDNRequestHeaders(&profile, "https://example.test/", FetchDestEmpty)
	if headers["User-Agent"] != "TestUA/1.0" {
		t.Errorf("User-Agent = %q, want the supplied profile UA", headers["User-Agent"])
	}
	if headers["Sec-Ch-Ua"] != `"Test";v="1"` {
		t.Errorf("Sec-Ch-Ua = %q, want the supplied profile hint", headers["Sec-Ch-Ua"])
	}
}

func TestApplyCDNRequestHeaders(t *testing.T) {
	h := http.Header{}
	ApplyCDNRequestHeaders(h, nil, "https://example.test/", FetchDestEmpty)

	if h.Get("Sec-Ch-Ua") == "" {
		t.Error("ApplyCDNRequestHeaders did not set the client hint")
	}
	if h.Get("Referer") != "https://example.test/" {
		t.Errorf("Referer = %q", h.Get("Referer"))
	}
}

// Accept-Encoding is deliberately not set: the HTTP/2 transport used for
// media requests does not transparently decompress, so advertising it would
// hand the caller a compressed body.
func TestCDNRequestHeadersDoesNotAdvertiseEncoding(t *testing.T) {
	if _, ok := CDNRequestHeaders(nil, "", FetchDestEmpty)["Accept-Encoding"]; ok {
		t.Error("Accept-Encoding is set; the media transport would return an undecoded body")
	}
}

func TestDocumentRequestHeaders(t *testing.T) {
	headers := DocumentRequestHeaders(nil, "https://www.xvideos.com/")

	if got := headers["Sec-Fetch-Dest"]; got != "document" {
		t.Errorf("Sec-Fetch-Dest = %q, want document", got)
	}
	if got := headers["Sec-Fetch-Mode"]; got != "navigate" {
		t.Errorf("Sec-Fetch-Mode = %q, want navigate", got)
	}
	if headers["Sec-Ch-Ua"] == "" {
		t.Error("Sec-Ch-Ua is missing from the document header set")
	}
	if got := headers["Accept"]; got == "*/*" {
		t.Error("Accept = */*, want the page-oriented Accept value for a navigation request")
	}
}

// A stored stream URL is only reusable while its signature is valid. The
// media CDNs embed a short expiry, so trusting a stored URL forever strands
// any task that sits unscheduled for longer than that window.
func TestStreamURLExpired(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)

	tests := []struct {
		name string
		url  string
		want bool
	}{
		{
			name: "pornhub signature in the past",
			url:  "https://hv-h.phncdn.com/hls/c/videos/202608/24/60041855/720P.mp4/master.m3u8?h=AAA%3D&e=1790595947&f=1",
			want: true,
		},
		{
			name: "pornhub signature in the future",
			url:  "https://hv-h.phncdn.com/hls/c/videos/202608/24/60041855/720P.mp4/master.m3u8?h=AAA%3D&e=1800000600&f=1",
			want: false,
		},
		{
			name: "xvideos token segment in the past",
			url:  "https://hls-cdn77.xvideos-cdn.com/TOK,1790604011/275a2580-af72-45fb-bf6d-cd5b00f82835/6/hls.m3u8",
			want: true,
		},
		{
			name: "xvideos token segment in the future",
			url:  "https://hls-cdn77.xvideos-cdn.com/TOK,1800000600/275a2580-af72-45fb-bf6d-cd5b00f82835/6/hls.m3u8",
			want: false,
		},
		{
			// e=0 is the endpoint's way of saying "no expiry"; treating it
			// as expired would re-scrape on every single run.
			name: "zero expiry means non-expiring",
			url:  "https://www.pornhub.com/video/get_media?s=eyJrIjoiZmQ3ODU4YSJ9&v=6a8c673a68504&e=0&t=p",
			want: false,
		},
		{
			name: "unsigned url",
			url:  "https://cdn.example.com/segments/seg-1.ts",
			want: false,
		},
		{
			name: "empty url",
			url:  "",
			want: false,
		},
		{
			// A path segment that merely ends in digits must not be read as
			// an expiry signature.
			name: "numeric path segment is not a signature",
			url:  "https://cdn.example.com/hls/v3/12345678/index.m3u8",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := StreamURLExpired(tt.url, now); got != tt.want {
				t.Errorf("StreamURLExpired(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}

func TestIsMediaGoneStatus(t *testing.T) {
	if !IsMediaGoneStatus(http.StatusGone) {
		t.Error("IsMediaGoneStatus(410) = false, want true")
	}
	for _, status := range []int{http.StatusOK, http.StatusForbidden, http.StatusNotFound, http.StatusTooManyRequests} {
		if IsMediaGoneStatus(status) {
			t.Errorf("IsMediaGoneStatus(%d) = true, want false", status)
		}
	}
}

// Both causes share HTTP 410, so the body is the only signal that separates
// a refreshable task from a permanently blocked one.
func TestClassifyMediaRejection(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"success", http.StatusOK, "#EXTM3U", RejectionNone},
		{"expired signed url", http.StatusGone, "expired token\n", RejectionExpiredToken},
		{"expired worded differently", http.StatusGone, "Error: link has EXPIRED", RejectionExpiredToken},
		{"bot rejection with empty body", http.StatusGone, "", RejectionBotBlocked},
		{"bot rejection with blank body", http.StatusGone, "  ", RejectionBotBlocked},
		{"forbidden", http.StatusForbidden, "", RejectionBotBlocked},
		{"unauthorized", http.StatusUnauthorized, "", RejectionBotBlocked},
		{"unclassified", http.StatusInternalServerError, "boom", "media CDN returned HTTP 500"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyMediaRejection(tt.status, []byte(tt.body))
			if got != tt.want {
				t.Errorf("ClassifyMediaRejection(%d, %q) = %q, want %q", tt.status, tt.body, got, tt.want)
			}
		})
	}
}
