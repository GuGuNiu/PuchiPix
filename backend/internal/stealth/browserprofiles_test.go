package stealth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetAllProfiles verifies that the built-in profile list is
// populated during init, ensuring stealth requests have identity options.
func TestGetAllProfiles(t *testing.T) {
	profiles := GetAllProfiles()
	assert.NotEmpty(t, profiles)
	assert.GreaterOrEqual(t, len(profiles), 5)
}

// TestRandomProfile verifies that a returned profile has a non-empty
// User-Agent string, preventing empty-header requests.
func TestRandomProfile(t *testing.T) {
	p := RandomProfile()
	assert.NotEmpty(t, p.UA)
	assert.NotEmpty(t, p.Accept)
	assert.NotEmpty(t, p.NavigatorPlatform)
}

// TestRandomUA verifies that RandomUA returns a non-empty string.
func TestRandomUA(t *testing.T) {
	ua := RandomUA()
	assert.NotEmpty(t, ua)
	assert.Contains(t, ua, "Mozilla")
}

// TestBuildStealthHeaders verifies that stealth headers include all
// necessary browser-mimicking fields, reducing detection risk.
func TestBuildStealthHeaders(t *testing.T) {
	p := RandomProfile()
	h := BuildStealthHeaders(p, "https://example.com/gallery")

	assert.NotEmpty(t, h.Get("User-Agent"))
	assert.NotEmpty(t, h.Get("Accept"))
	assert.NotEmpty(t, h.Get("Accept-Language"))
	assert.Equal(t, "https://example.com/gallery", h.Get("Referer"))
	assert.NotEmpty(t, h.Get("Connection"))
}

// TestBuildStealthHeadersEmptyProfile verifies that an empty profile
// triggers a fallback to a random profile, preventing empty headers.
func TestBuildStealthHeadersEmptyProfile(t *testing.T) {
	h := BuildStealthHeaders(BrowserProfile{}, "")

	assert.NotEmpty(t, h.Get("User-Agent"))
	assert.NotEmpty(t, h.Get("Accept"))
}

// TestBuildStealthHeadersChromeSecChUa verifies that Chrome/Edge
// profiles include sec-ch-ua client hints, matching modern browser
// behavior that anti-bot systems check for.
func TestBuildStealthHeadersChromeSecChUa(t *testing.T) {
	profiles := GetAllProfiles()
	var chromeProfile *BrowserProfile
	for i := range profiles {
		if profiles[i].Browser == BrowserChrome {
			chromeProfile = &profiles[i]
			break
		}
	}
	require.NotNil(t, chromeProfile, "should have at least one Chrome profile")

	h := BuildStealthHeaders(*chromeProfile, "")
	assert.NotEmpty(t, h.Get("sec-ch-ua"))
	assert.NotEmpty(t, h.Get("sec-ch-ua-mobile"))
	assert.NotEmpty(t, h.Get("sec-ch-ua-platform"))
}

// TestBuildStealthHeadersSecFetch verifies that Chrome/Firefox/Edge
// profiles include sec-fetch-* headers, matching modern browser
// navigation behavior.
func TestBuildStealthHeadersSecFetch(t *testing.T) {
	profiles := GetAllProfiles()
	for _, p := range profiles {
		if p.Browser == BrowserSafari {
			continue
		}
		h := BuildStealthHeaders(p, "")
		assert.NotEmpty(t, h.Get("sec-fetch-dest"), "browser %s should have sec-fetch-dest", p.Browser)
		assert.NotEmpty(t, h.Get("sec-fetch-mode"), "browser %s should have sec-fetch-mode", p.Browser)
	}
}

// TestBuildStealthHeadersReferer verifies that a non-empty referer
// is set in the headers.
func TestBuildStealthHeadersReferer(t *testing.T) {
	p := RandomProfile()
	h := BuildStealthHeaders(p, "https://source.example.com/page")
	assert.Equal(t, "https://source.example.com/page", h.Get("Referer"))
}

// TestBuildStealthHeadersNoReferer verifies that no Referer header
// is set when the referer parameter is empty.
func TestBuildStealthHeadersNoReferer(t *testing.T) {
	p := RandomProfile()
	h := BuildStealthHeaders(p, "")
	assert.Empty(t, h.Get("Referer"))
}
