package sites

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDataStoreGetModuleConfig verifies that module config lookups return
// the correct configuration for known sites and false for unknown ones,
// preventing silent nil-pointer access in callers that assume a site exists.
func TestDataStoreGetModuleConfig(t *testing.T) {
	ds := NewSiteDataStore()

	cfg, ok := ds.GetModuleConfig("aimeizizi")
	require.True(t, ok)
	assert.Equal(t, "aimeizizi", cfg.ID)
	assert.Equal(t, "����??, cfg.NameCn)
	assert.True(t, cfg.Enabled)

	_, ok = ds.GetModuleConfig("nonexistent")
	assert.False(t, ok)
}

// TestDataStoreGetAllModuleConfigs verifies that all configured sites
// are returned, ensuring the registry has the expected number of modules
// for site-list API responses.
func TestDataStoreGetAllModuleConfigs(t *testing.T) {
	ds := NewSiteDataStore()
	all := ds.GetAllModuleConfigs()
	assert.GreaterOrEqual(t, len(all), 5, "should have at least 5 site modules")
}

// TestDataStoreGetDomains verifies domain list retrieval for routing
// and the empty-list fallback for sites without configured domains.
func TestDataStoreGetDomains(t *testing.T) {
	ds := NewSiteDataStore()

	domains := ds.GetDomains("aimeizizi")
	assert.NotEmpty(t, domains)

	// kanav has empty domains array
	kanavDomains := ds.GetDomains("kanav")
	assert.Empty(t, kanavDomains)

	// unknown site returns nil
	assert.Nil(t, ds.GetDomains("nonexistent"))
}

// TestDataStoreGetPlaceholder verifies placeholder fragment retrieval,
// used to construct fallback thumbnail URLs when real images are missing.
func TestDataStoreGetPlaceholder(t *testing.T) {
	ds := NewSiteDataStore()

	assert.Equal(t, "/static/zde/timg.gif", ds.GetPlaceholder("aimeizizi"))
	assert.Empty(t, ds.GetPlaceholder("kanav"))
	assert.Empty(t, ds.GetPlaceholder("nonexistent"))
}

// TestDataStoreGetPublisherPrefixes verifies publisher prefix retrieval,
// used to strip publisher tags from gallery titles for cleaner display.
func TestDataStoreGetPublisherPrefixes(t *testing.T) {
	ds := NewSiteDataStore()

	prefixes := ds.GetPublisherPrefixes("aimeizizi")
	assert.NotEmpty(t, prefixes)
	assert.Contains(t, prefixes, "[������]")

	assert.Nil(t, ds.GetPublisherPrefixes("kanav"))
	assert.Nil(t, ds.GetPublisherPrefixes("nonexistent"))
}

// TestDataStoreGetTitleSuffixPatterns verifies title suffix pattern
// retrieval, used to clean site branding from gallery titles.
func TestDataStoreGetTitleSuffixPatterns(t *testing.T) {
	ds := NewSiteDataStore()

	patterns := ds.GetTitleSuffixPatterns("aimeizizi")
	assert.NotEmpty(t, patterns)

	patterns2 := ds.GetTitleSuffixPatterns("xsnvshen")
	assert.NotEmpty(t, patterns2)

	assert.Nil(t, ds.GetTitleSuffixPatterns("kanav"))
	assert.Nil(t, ds.GetTitleSuffixPatterns("nonexistent"))
}

// TestDataStoreGetTitleCleanPatterns verifies title clean pattern
// retrieval, used to strip forum section names from thread titles.
func TestDataStoreGetTitleCleanPatterns(t *testing.T) {
	ds := NewSiteDataStore()

	patterns := ds.GetTitleCleanPatterns("sjs")
	assert.NotEmpty(t, patterns)

	assert.Nil(t, ds.GetTitleCleanPatterns("aimeizizi"))
	assert.Nil(t, ds.GetTitleCleanPatterns("nonexistent"))
}

// TestDataStoreGetCategoryLabels verifies category label map retrieval,
// used to map category names to bitmask values for exhentai filtering.
func TestDataStoreGetCategoryLabels(t *testing.T) {
	ds := NewSiteDataStore()

	labels := ds.GetCategoryLabels("exhentai")
	assert.NotEmpty(t, labels)
	assert.Equal(t, 2, labels["Doujinshi"])
	assert.Equal(t, 4, labels["Manga"])

	assert.Nil(t, ds.GetCategoryLabels("aimeizizi"))
	assert.Nil(t, ds.GetCategoryLabels("nonexistent"))
}

// TestDataStoreGetCategoryNames verifies category name map retrieval
// and the string-to-int key conversion, used to display human-readable
// category names from numeric category identifiers.
func TestDataStoreGetCategoryNames(t *testing.T) {
	ds := NewSiteDataStore()

	names := ds.GetCategoryNames("exhentai")
	assert.NotEmpty(t, names)
	assert.Equal(t, "Doujinshi", names[1])
	assert.Equal(t, "Manga", names[2])

	assert.Empty(t, ds.GetCategoryNames("aimeizizi"))
	assert.Nil(t, ds.GetCategoryNames("nonexistent"))
}

// TestDataStoreGetCDNDomains verifies CDN domain retrieval, used to
// construct image and resource URLs for sites that use separate CDN hosts.
func TestDataStoreGetCDNDomains(t *testing.T) {
	ds := NewSiteDataStore()

	cdns := ds.GetCDNDomains("xsnvshen")
	assert.NotEmpty(t, cdns)
	assert.Equal(t, "https://img.xsnvshen.co", cdns["img"])
	assert.Equal(t, "https://res.xsnvshen.co", cdns["res"])

	// Sites without CDN domains return an empty map
	emptyCDNs := ds.GetCDNDomains("aimeizizi")
	assert.Empty(t, emptyCDNs)

	assert.Nil(t, ds.GetCDNDomains("nonexistent"))
}

// TestDataStoreGetCookiePrefix verifies Discuz cookie prefix retrieval,
// used to construct the correct cookie names for forum authentication.
func TestDataStoreGetCookiePrefix(t *testing.T) {
	ds := NewSiteDataStore()

	assert.Equal(t, "SgL6_2132_", ds.GetCookiePrefix("sjs"))
	assert.Empty(t, ds.GetCookiePrefix("aimeizizi"))
	assert.Empty(t, ds.GetCookiePrefix("nonexistent"))
}

// TestDataStoreGetAgeVerifyConfig verifies age verification config
// retrieval, used to submit anti-addiction form data for sites that
// require it. Sites without age verification return false.
func TestDataStoreGetAgeVerifyConfig(t *testing.T) {
	ds := NewSiteDataStore()

	cfg, ok := ds.GetAgeVerifyConfig("xsnvshen")
	require.True(t, ok)
	assert.Equal(t, "simple-submit-response", cfg.Field)
	assert.Equal(t, "���ȷ�Ͻ���{?ɫŮ??, cfg.Value)
	assert.Equal(t, "gcha_sfc_ec22ca15b1", cfg.Cookie)

	_, ok = ds.GetAgeVerifyConfig("aimeizizi")
	assert.False(t, ok)

	_, ok = ds.GetAgeVerifyConfig("nonexistent")
	assert.False(t, ok)
}

// TestDataStoreGetProviderData verifies full provider data retrieval,
// used by site providers to access all site-specific configuration at once.
func TestDataStoreGetProviderData(t *testing.T) {
	ds := NewSiteDataStore()

	pd, ok := ds.GetProviderData("exhentai")
	require.True(t, ok)
	assert.Equal(t, "https://e-hentai.org", pd.BaseEURL)
	assert.Equal(t, "https://exhentai.org", pd.BaseExURL)
	assert.Equal(t, 4, pd.ImageBatchSize)

	_, ok = ds.GetProviderData("nonexistent")
	assert.False(t, ok)
}

// TestDataStoreGetBlockedKeywords verifies blocked title keyword retrieval,
// used to filter out AI-generated content from gallery listings.
func TestDataStoreGetBlockedKeywords(t *testing.T) {
	ds := NewSiteDataStore()

	keywords := ds.GetBlockedKeywords("aimeizizi")
	assert.NotEmpty(t, keywords)
	assert.Contains(t, keywords, "AI")

	// xsnvshen has empty blocked keywords
	emptyKeywords := ds.GetBlockedKeywords("xsnvshen")
	assert.Empty(t, emptyKeywords)

	assert.Nil(t, ds.GetBlockedKeywords("nonexistent"))
}

// TestDataStoreGetBlockedCategories verifies blocked category retrieval,
// used to filter galleries by category labels.
func TestDataStoreGetBlockedCategories(t *testing.T) {
	ds := NewSiteDataStore()

	cats := ds.GetBlockedCategories("aimeizizi")
	assert.NotEmpty(t, cats)
	assert.Contains(t, cats, "AI")

	assert.Nil(t, ds.GetBlockedCategories("nonexistent"))
}

// TestDataStoreGetBlockedProtagonists verifies blocked protagonist
// retrieval, used to filter galleries by protagonist names.
func TestDataStoreGetBlockedProtagonists(t *testing.T) {
	ds := NewSiteDataStore()

	// aimeizizi has empty blocked protagonists
	protagonists := ds.GetBlockedProtagonists("aimeizizi")
	assert.Empty(t, protagonists)

	assert.Nil(t, ds.GetBlockedProtagonists("nonexistent"))
}

// TestDataStoreIsBlockedProtagonistsEnabled verifies the toggle for
// protagonist-based blocking, preventing unintended filtering when
// the feature is disabled.
func TestDataStoreIsBlockedProtagonistsEnabled(t *testing.T) {
	ds := NewSiteDataStore()

	assert.False(t, ds.IsBlockedProtagonistsEnabled("aimeizizi"))
	assert.False(t, ds.IsBlockedProtagonistsEnabled("nonexistent"))
}

// TestDataStoreCanHandle verifies URL-to-site routing, ensuring that
// URLs from configured domains are matched while unknown URLs and
// subdomain suffixes work correctly.
func TestDataStoreCanHandle(t *testing.T) {
	ds := NewSiteDataStore()

	tests := []struct {
		name   string
		siteID string
		url    string
		want   bool
	}{
		{"exact domain match", "aimeizizi", "https://lovecutes.com/gallery/123", true},
		{"www subdomain match", "aimeizizi", "https://www.lovecutes.com/gallery/123", true},
		{"alternate domain match", "aimeizizi", "https://lovecutes.net/gallery/123", true},
		{"unrelated domain", "aimeizizi", "https://example.com/gallery/123", false},
		{"unknown site", "nonexistent", "https://lovecutes.com/gallery/123", false},
		{"site with no domains", "kanav", "https://kanav.ad/video/1", false},
		{"exhentai domain", "exhentai", "https://e-hentai.org/g/123", true},
		{"exhentai alternate", "exhentai", "https://exhentai.org/g/123", true},
		{"sjs domain", "sjs", "https://sjs66.com/thread-123-1-1.html", true},
		{"xsnvshen domain", "xsnvshen", "https://xsnvshen.co/album/123", true},
		{"malformed URL", "aimeizizi", "://invalid-url", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ds.CanHandle(tt.siteID, tt.url))
		})
	}
}

// TestDataStoreNewFromJSONInvalid verifies that malformed JSON panics
// during construction, failing fast at startup rather than serving
// empty configuration silently.
func TestDataStoreNewFromJSONInvalid(t *testing.T) {
	assert.Panics(t, func() {
		newSiteDataStoreFromJSON([]byte("{invalid json"))
	})
}

// TestDataStoreNewFromJSONNoSites verifies that valid JSON with no
// sites map panics, preventing a degenerate configuration from
// silently producing an empty datastore.
func TestDataStoreNewFromJSONNoSites(t *testing.T) {
	assert.Panics(t, func() {
		newSiteDataStoreFromJSON([]byte(`{"version":"2.0","sites":null}`))
	})
}

// TestDataStoreGetSiteDataStore verifies the singleton accessor returns
// a non-nil store on repeated calls, ensuring lazy initialization works.
func TestDataStoreGetSiteDataStore(t *testing.T) {
	ds1 := GetSiteDataStore()
	ds2 := GetSiteDataStore()
	assert.NotNil(t, ds1)
	assert.Same(t, ds1, ds2, "singleton should return the same instance")
}
