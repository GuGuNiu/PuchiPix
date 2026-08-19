package stealth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestDetectWafHTTP403 verifies that a 403 status code is detected
// as a WAF block, triggering fallback to browser mode.
func TestDetectWafHTTP403(t *testing.T) {
	result := DetectWaf(403, "", nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonHTTP403, result.Reason)
}

// TestDetectWafHTTP429 verifies that a 429 status code is detected
// as a rate-limit block.
func TestDetectWafHTTP429(t *testing.T) {
	result := DetectWaf(429, "", nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonHTTP429, result.Reason)
}

// TestDetectWafCloudflare verifies that Cloudflare challenge pages
// are detected from HTML content signatures.
func TestDetectWafCloudflare(t *testing.T) {
	html := `<html><head><title>Just a moment</title></head><body>cf-browser-verification</body></html>`
	result := DetectWaf(200, html, nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonCloudflare, result.Reason)
}

// TestDetectWafCaptcha verifies that CAPTCHA pages are detected,
// triggering credential-based fallback.
func TestDetectWafCaptcha(t *testing.T) {
	html := `<html><body><div class="g-recaptcha">Please verify you are human</div></body></html>`
	result := DetectWaf(200, html, nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonCaptcha, result.Reason)
}

// TestDetectWafJavaScriptChallenge verifies that JS challenge pages
// are detected, indicating a need for browser rendering.
func TestDetectWafJavaScriptChallenge(t *testing.T) {
	html := `<html><body><noscript>Please enable JavaScript</noscript></body></html>`
	result := DetectWaf(200, html, nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonJavaScriptChallenge, result.Reason)
}

// TestDetectWafCleanPage verifies that a normal page with sufficient
// content is not flagged as blocked, preventing false positives.
func TestDetectWafCleanPage(t *testing.T) {
	html := strings.Repeat("<p>Normal gallery content with images and text.</p>", 200)
	result := DetectWaf(200, html, nil)
	assert.False(t, result.Blocked)
	assert.Equal(t, WafReasonNone, result.Reason)
}

// TestDetectWafEmptyContent verifies that empty HTML content returns
// a non-blocked result with reason "none".
func TestDetectWafEmptyContent(t *testing.T) {
	result := DetectWaf(200, "", nil)
	assert.False(t, result.Blocked)
	assert.Equal(t, WafReasonNone, result.Reason)
}

// TestDetectWaf503Cloudflare verifies that a 503 status combined with
// Cloudflare signatures is detected as a Cloudflare block.
func TestDetectWaf503Cloudflare(t *testing.T) {
	html := `<html><body>Checking your browser before accessing. cf-ray: 12345</body></html>`
	result := DetectWaf(503, html, nil)
	assert.True(t, result.Blocked)
	assert.Equal(t, WafReasonCloudflare, result.Reason)
}

// TestShouldFallbackNoImages verifies that a scrape result with zero
// images and videos triggers a browser fallback.
func TestShouldFallbackNoImages(t *testing.T) {
	fallback, reason := ShouldFallbackToBrowser("Gallery Title", 0, 0, 1)
	assert.True(t, fallback)
	assert.NotEmpty(t, reason)
}

// TestShouldFallbackInvalidTitle verifies that an empty or error
// title triggers a browser fallback.
func TestShouldFallbackInvalidTitle(t *testing.T) {
	tests := []string{"", "404", "Not Found", "Error Page"}
	for _, title := range tests {
		fallback, _ := ShouldFallbackToBrowser(title, 10, 0, 1)
		assert.True(t, fallback, "title %q should trigger fallback", title)
	}
}

// TestShouldFallbackLowImageRatio verifies that a low image count
// relative to page count triggers a browser fallback.
func TestShouldFallbackLowImageRatio(t *testing.T) {
	fallback, _ := ShouldFallbackToBrowser("Gallery", 2, 0, 10)
	assert.True(t, fallback)
}

// TestShouldFallbackNoFallback verifies that a healthy scrape result
// with sufficient images does not trigger a fallback.
func TestShouldFallbackNoFallback(t *testing.T) {
	fallback, _ := ShouldFallbackToBrowser("Gallery Title", 100, 2, 5)
	assert.False(t, fallback)
}

// TestParseExpectedImageCount verifies that the "NP" suffix in a
// title is parsed to extract the expected image count.
func TestParseExpectedImageCount(t *testing.T) {
	tests := []struct {
		title    string
		expected int
	}{
		{"Gallery 73P", 73},
		{"Gallery 100P", 100},
		{"Gallery 50P Extra", 50},
		{"Gallery", 0},
		{"Gallery 73p", 73},
	}

	for _, tt := range tests {
		t.Run(tt.title, func(t *testing.T) {
			result := parseExpectedImageCount(tt.title)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestContainsAnyCIVerifies that case-insensitive matching works
// correctly for WAF signature detection.
func TestContainsAnyCI(t *testing.T) {
	assert.True(t, containsAnyCI("Please Complete CAPTCHA", captchaSignatures))
	assert.True(t, containsAnyCI("enable javascript now", jsChallengeSignatures))
	assert.False(t, containsAnyCI("normal gallery page content", captchaSignatures))
}
