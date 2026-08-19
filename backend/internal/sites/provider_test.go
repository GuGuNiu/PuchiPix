package sites

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestAccountStatusConstants verifies that all account status
// constants are non-empty strings, preventing silent zero-value
// comparisons.
func TestAccountStatusConstants(t *testing.T) {
	statuses := []AccountStatus{
		AccountStatusActive,
		AccountStatusDisabled,
		AccountStatusCooldown,
		AccountStatusExpired,
		AccountStatusBanned,
	}
	for _, s := range statuses {
		assert.NotEmpty(t, string(s), "account status must not be empty")
	}
}

// TestGalleryScrapeResultFields verifies that the scrape result
// struct can be initialized with all expected fields, ensuring
// the contract is stable across providers.
func TestGalleryScrapeResultFields(t *testing.T) {
	r := GalleryScrapeResult{
		SourceURL:   "https://example.com/gallery/1",
		Title:       "Test Gallery",
		Protagonist: "Test Person",
		Description: "A test gallery",
		Category:    "photo",
		Tags:        []string{"tag1", "tag2"},
		CoverURL:    "https://example.com/cover.jpg",
		Images:      []GalleryImageItem{{URL: "https://example.com/img1.jpg", PageIndex: 0, OrderIndex: 0}},
		Videos:      []GalleryVideoItem{{URL: "https://example.com/vid1.mp4"}},
		PageCount:   1,
		ImageCount:  1,
		VideoCount:  1,
	}

	assert.Equal(t, "Test Gallery", r.Title)
	assert.Len(t, r.Images, 1)
	assert.Len(t, r.Videos, 1)
	assert.Equal(t, "https://example.com/img1.jpg", r.Images[0].URL)
}

// TestGalleryZipInfoFields verifies that the ZIP info struct carries
// all fields needed for archive download resolution.
func TestGalleryZipInfoFields(t *testing.T) {
	z := GalleryZipInfo{
		Title:         "Archive",
		FileCount:     50,
		FileSizeText:  "100MB",
		Password:      "secret",
		DownloadURL:   "https://example.com/download.zip",
		Provider:      "mega",
		RequiresLogin: true,
		RequiresEmail: false,
		OuoURL:        "https://ouo.io/abc",
	}

	assert.Equal(t, "Archive", z.Title)
	assert.Equal(t, 50, z.FileCount)
	assert.True(t, z.RequiresLogin)
	assert.NotEmpty(t, z.OuoURL)
}

// TestBlockCheckResultFields verifies that the block check result
// correctly represents blocked and non-blocked states.
func TestBlockCheckResultFields(t *testing.T) {
	blocked := BlockCheckResult{Blocked: true, Reason: "title matches keyword"}
	clear := BlockCheckResult{Blocked: false}

	assert.True(t, blocked.Blocked)
	assert.NotEmpty(t, blocked.Reason)
	assert.False(t, clear.Blocked)
}

// TestCookieDataFields verifies that the cookie data struct carries
// all fields needed for session persistence.
func TestCookieDataFields(t *testing.T) {
	c := CookieData{
		Name:     "session",
		Value:    "abc123",
		Domain:   ".example.com",
		Path:     "/",
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Lax",
		Expires:  1700000000,
	}

	assert.Equal(t, "session", c.Name)
	assert.Equal(t, "abc123", c.Value)
	assert.True(t, c.HTTPOnly)
	assert.True(t, c.Secure)
}

// TestSiteInfoFields verifies that the site info struct carries
// all display metadata needed by the frontend.
func TestSiteInfoFields(t *testing.T) {
	si := SiteInfo{
		ID:      "test",
		Name:    "Test Site",
		NameCn:  "爱妹子",
		NameEn:  "Test Site",
		BaseURL: "https://test.com",
		Enabled: true,
		Type:    "photo",
		Gallery: true,
	}
	assert.True(t, si.Enabled)
	assert.True(t, si.Gallery)
}

// TestSiteModuleConfigFields verifies that the module config struct
// carries all fields needed for dynamic site registration.
func TestSiteModuleConfigFields(t *testing.T) {
	m := SiteModuleConfig{
		ID:      "test",
		NameCn:  "测试",
		NameEn:  "Test",
		BaseURL: "https://test.com",
		Type:    "photo",
		Enabled: true,
		Domains: []string{"https://test.com", "https://alt.test.com"},
	}

	assert.Equal(t, "test", m.ID)
	assert.Len(t, m.Domains, 2)
	assert.True(t, m.Enabled)
}
