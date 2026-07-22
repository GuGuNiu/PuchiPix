package aimeizizi

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/sites"
)

// mockBlocklistChecker is a minimal BlocklistChecker implementation
// for testing CheckBlockedAsync, allowing the test to control whether
// user-defined blocklist rules report a match.
type mockBlocklistChecker struct {
	blocked bool
	reason  string
	err     error
}

func (m *mockBlocklistChecker) CheckUserRules(_ context.Context, _ string, _ map[string]string) (sites.BlockCheckResult, error) {
	if m.err != nil {
		return sites.BlockCheckResult{}, m.err
	}
	return sites.BlockCheckResult{Blocked: m.blocked, Reason: m.reason}, nil
}

// newTestProvider creates a Provider wired to the real SiteDataStore
// (loaded from the embedded JSON), ensuring tests exercise the actual
// configuration data that production code will use.
func newTestProvider(t *testing.T, blocklist sites.BlocklistChecker) *Provider {
	t.Helper()
	ds := sites.GetSiteDataStore()
	require.NotNil(t, ds)
	return NewProvider(ds, blocklist)
}

// --- Construction ---

// TestNewProvider verifies that the provider is constructed with all
// site data pre-loaded from the SiteDataStore, ensuring no runtime
// lookups are needed in hot paths.
func TestNewProvider(t *testing.T) {
	p := newTestProvider(t, nil)
	assert.Equal(t, "aimeizizi", p.SiteID())
	assert.NotEmpty(t, p.domains)
	assert.NotEmpty(t, p.baseURL)
	assert.NotEmpty(t, p.placeholder)
	assert.NotEmpty(t, p.publisherPrefixes)
	assert.NotEmpty(t, p.suffixPatterns)
}

// TestProviderGetDomains verifies that the configured domain list is
// returned, which the scraper uses for multi-domain failover.
func TestProviderGetDomains(t *testing.T) {
	p := newTestProvider(t, nil)
	domains := p.GetDomains()
	assert.NotEmpty(t, domains)
	for _, d := range domains {
		assert.NotEmpty(t, d)
	}
}

// TestProviderGetPlaceholder verifies that the placeholder image
// fragment is returned, used to filter out loading GIFs from the
// image download queue.
func TestProviderGetPlaceholder(t *testing.T) {
	p := newTestProvider(t, nil)
	assert.NotEmpty(t, p.GetPlaceholder())
}

// --- CanHandle ---

// TestProviderCanHandle verifies that URLs matching configured
// aimeizizi domains are recognised, as CanHandle is the entry point
// for the site registry's URL-based provider routing.
func TestProviderCanHandle(t *testing.T) {
	p := newTestProvider(t, nil)

	tests := []struct {
		url  string
		want bool
	}{
		{"https://www.lovecutes.com/article/123/", true},
		{"https://lovecutes.com/article/123/", true},
		{"https://xx.knit.bid/article/456/", true},
		{"https://www.lovecutes.net/article/789/", true},
		{"https://other.com/article/123/", false},
		{"https://exhentai.org/g/123/", false},
		{"not-a-url", false},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			assert.Equal(t, tt.want, p.CanHandle(tt.url))
		})
	}
}

// --- CleanTitle ---

// TestProviderCleanTitle verifies that the provider's CleanTitle
// strips publisher prefixes and site suffixes using patterns loaded
// from the SiteDataStore, producing clean titles for storage.
func TestProviderCleanTitle(t *testing.T) {
	p := newTestProvider(t, nil)
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"plain", "My Gallery", "My Gallery"},
		{"with suffix", "My Gallery | 爱妹子", "My Gallery"},
		{"with prefix", "[爱妹子] My Gallery", "My Gallery"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, p.CleanTitle(tt.input))
		})
	}
}

// --- CheckContentBlocked ---

// TestProviderCheckContentBlocked_BlockedKeyword verifies that a
// title containing a blocked keyword (loaded from SiteDataStore)
// is flagged as blocked, preventing AI-generated content from
// entering the download pipeline.
func TestProviderCheckContentBlocked_BlockedKeyword(t *testing.T) {
	p := newTestProvider(t, nil)
	result := p.CheckContentBlocked("AI Nudes Gallery", "", "")
	assert.True(t, result.Blocked)
	assert.Contains(t, result.Reason, "title contains")
}

// TestProviderCheckContentBlocked_BlockedCategory verifies that a
// category matching a blocked category keyword is flagged.
func TestProviderCheckContentBlocked_BlockedCategory(t *testing.T) {
	p := newTestProvider(t, nil)
	result := p.CheckContentBlocked("Clean Title", "AI", "")
	assert.True(t, result.Blocked)
	assert.Contains(t, result.Reason, "category contains")
}

// TestProviderCheckContentBlocked_NotBlocked verifies that clean
// content passes the filter without being flagged.
func TestProviderCheckContentBlocked_NotBlocked(t *testing.T) {
	p := newTestProvider(t, nil)
	result := p.CheckContentBlocked("Beautiful Gallery", "Photo", "ModelA")
	assert.False(t, result.Blocked)
}

// TestProviderCheckContentBlocked_EmptyInputs verifies that empty
// title and category do not cause false positives or panics.
func TestProviderCheckContentBlocked_EmptyInputs(t *testing.T) {
	p := newTestProvider(t, nil)
	result := p.CheckContentBlocked("", "", "")
	assert.False(t, result.Blocked)
}

// --- CheckBlockedAsync ---

// TestCheckBlockedAsync_DefaultBlocked verifies that when the
// built-in keyword check blocks content, the blocklist is not
// consulted, as the default check is authoritative.
func TestCheckBlockedAsync_DefaultBlocked(t *testing.T) {
	bl := &mockBlocklistChecker{blocked: false}
	p := newTestProvider(t, bl)

	result, err := p.CheckBlockedAsync(context.Background(), "AI Nudes", "", "")
	require.NoError(t, err)
	assert.True(t, result.Blocked)
}

// TestCheckBlockedAsync_BlocklistMatch verifies that when the default
// check passes, the user-defined blocklist is consulted and can block
// content based on user preferences.
func TestCheckBlockedAsync_BlocklistMatch(t *testing.T) {
	bl := &mockBlocklistChecker{blocked: true, reason: "user rule match"}
	p := newTestProvider(t, bl)

	result, err := p.CheckBlockedAsync(context.Background(), "Clean Title", "Photo", "ModelA")
	require.NoError(t, err)
	assert.True(t, result.Blocked)
	assert.Equal(t, "user rule match", result.Reason)
}

// TestCheckBlockedAsync_NoBlocklist verifies that when no blocklist
// is configured and the default check passes, content is allowed.
func TestCheckBlockedAsync_NoBlocklist(t *testing.T) {
	p := newTestProvider(t, nil)

	result, err := p.CheckBlockedAsync(context.Background(), "Clean Title", "Photo", "ModelA")
	require.NoError(t, err)
	assert.False(t, result.Blocked)
}

// --- NormalizeURL ---

// TestProviderNormalizeURL verifies that URLs from alternate domains
// are normalised to the base URL, ensuring consistent URL storage
// regardless of which mirror domain the user pasted.
func TestProviderNormalizeURL(t *testing.T) {
	p := newTestProvider(t, nil)

	normalised := p.NormalizeURL("https://xx.knit.bid/article/123/")
	assert.Contains(t, normalised, "/article/123/")
	assert.Equal(t, p.baseURL, normalised[:len(p.baseURL)])
}

// TestProviderNormalizeURL_UnknownDomain verifies that URLs from
// unknown domains are returned unchanged.
func TestProviderNormalizeURL_UnknownDomain(t *testing.T) {
	p := newTestProvider(t, nil)
	original := "https://unknown.com/article/123/"
	assert.Equal(t, original, p.NormalizeURL(original))
}

// --- IsListingPage ---

// TestProviderIsListingPage verifies that article URLs are identified
// as gallery pages (not listing pages), while all other URLs are
// treated as listing pages, as the scraper only fetches galleries
// from article pages.
func TestProviderIsListingPage(t *testing.T) {
	p := newTestProvider(t, nil)
	assert.False(t, p.IsListingPage("https://www.lovecutes.com/article/123/"))
	assert.True(t, p.IsListingPage("https://www.lovecutes.com/category/photo"))
	assert.True(t, p.IsListingPage("https://www.lovecutes.com/"))
}

// --- ResolveURL ---

// TestProviderResolveURL verifies that the provider resolves URLs
// correctly for all formats (absolute, protocol-relative,
// root-relative, empty), as the scraper depends on this to build
// correct image download URLs from scraped HTML attributes.
func TestProviderResolveURL(t *testing.T) {
	p := newTestProvider(t, nil)
	domain := "https://www.lovecutes.com"

	assert.Equal(t, "https://cdn.example.com/img.jpg",
		p.ResolveURL("https://cdn.example.com/img.jpg", domain))
	assert.Equal(t, "https://cdn.example.com/img.jpg",
		p.ResolveURL("//cdn.example.com/img.jpg", domain))
	assert.Equal(t, "https://www.lovecutes.com/article/123",
		p.ResolveURL("/article/123", domain))
	assert.Equal(t, "", p.ResolveURL("", domain))
	assert.Equal(t, "relative/path",
		p.ResolveURL("relative/path", domain))
}

// --- ExtractProtagonist ---

// TestProviderExtractProtagonist verifies that the aimeizizi provider
// returns an empty protagonist, as this site does not tag models by
// name ??protagonist extraction is left to other providers or manual
// user input.
func TestProviderExtractProtagonist(t *testing.T) {
	p := newTestProvider(t, nil)
	assert.Empty(t, p.ExtractProtagonist("Any Title", []string{"tag1", "tag2"}))
}

// --- ExtractDescription ---

// TestProviderExtractDescription verifies that the description is
// derived from the title by removing the protagonist name, providing
// a default description for galleries that lack a dedicated abstract.
func TestProviderExtractDescription(t *testing.T) {
	p := newTestProvider(t, nil)

	assert.Equal(t, "", p.ExtractDescription("", ""))
	assert.Equal(t, "My Gallery", p.ExtractDescription("My Gallery", ""))
	assert.Equal(t, "Beautiful Photo",
		p.ExtractDescription("ModelA - Beautiful Photo", "ModelA"))
}

// --- BuildSearchURL ---

// TestProviderBuildSearchURL verifies that the search URL is
// constructed with the best available domain and URL-encoded query,
// as the Search method depends on this to fetch listing pages.
func TestProviderBuildSearchURL(t *testing.T) {
	p := newTestProvider(t, nil)
	url := p.BuildSearchURL("cute girls")
	assert.NotEmpty(t, url)
	assert.Contains(t, url, "?s=")
	assert.Contains(t, url, "cute+girls")
}
