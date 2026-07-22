package sites

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockProvider is a minimal SiteProvider implementation for registry tests.
type mockProvider struct {
	id        string
	canHandle func(string) bool
}

func (m *mockProvider) SiteID() string       { return m.id }
func (m *mockProvider) CanHandle(url string) bool { return m.canHandle(url) }
func (m *mockProvider) ScrapeGallery(ctx context.Context, url string) (*GalleryScrapeResult, error) { return nil, nil }
func (m *mockProvider) ScrapeGalleryHTTP(ctx context.Context, url string) (*GalleryScrapeResult, error) { return nil, nil }
func (m *mockProvider) Search(ctx context.Context, query string, page int) ([]SiteSearchResult, error) { return nil, nil }
func (m *mockProvider) BuildSearchURL(keyword string) string             { return "" }
func (m *mockProvider) CleanTitle(rawTitle string) string                { return rawTitle }
func (m *mockProvider) CheckContentBlocked(title, category, protagonist string) BlockCheckResult { return BlockCheckResult{} }
func (m *mockProvider) NormalizeURL(url string) string                   { return url }
func (m *mockProvider) IsListingPage(url string) bool                    { return false }

// TestSiteRegistryRegisterAndGet verifies that a registered provider
// can be retrieved by its site ID.
func TestSiteRegistryRegisterAndGet(t *testing.T) {
	reg := NewSiteRegistry()
	p := &mockProvider{id: "test-site", canHandle: func(string) bool { return false }}
	reg.Register(p)

	got, ok := reg.GetProvider("test-site")
	assert.True(t, ok)
	assert.Equal(t, "test-site", got.SiteID())
}

// TestSiteRegistryGetProviderNotFound verifies that looking up an
// unregistered ID returns false.
func TestSiteRegistryGetProviderNotFound(t *testing.T) {
	reg := NewSiteRegistry()
	_, ok := reg.GetProvider("nonexistent")
	assert.False(t, ok)
}

// TestSiteRegistryUnregister verifies that unregistering a provider
// removes it from the registry.
func TestSiteRegistryUnregister(t *testing.T) {
	reg := NewSiteRegistry()
	p := &mockProvider{id: "test-site", canHandle: func(string) bool { return false }}
	reg.Register(p)
	reg.Unregister("test-site")

	_, ok := reg.GetProvider("test-site")
	assert.False(t, ok)
}

// TestSiteRegistryGetProviderByUrl verifies that URL-based provider
// lookup matches the first provider whose CanHandle returns true.
func TestSiteRegistryGetProviderByUrl(t *testing.T) {
	reg := NewSiteRegistry()
	p1 := &mockProvider{id: "site-a", canHandle: func(url string) bool { return strings.Contains(url, "site-a.com") }}
	p2 := &mockProvider{id: "site-b", canHandle: func(url string) bool { return strings.Contains(url, "site-b.com") }}
	reg.Register(p1)
	reg.Register(p2)

	got, ok := reg.GetProviderByUrl("https://site-b.com/gallery/123")
	require.True(t, ok)
	assert.Equal(t, "site-b", got.SiteID())
}

// TestSiteRegistryGetAllProviders verifies that all registered
// providers are returned.
func TestSiteRegistryGetAllProviders(t *testing.T) {
	reg := NewSiteRegistry()
	reg.Register(&mockProvider{id: "a", canHandle: func(string) bool { return false }})
	reg.Register(&mockProvider{id: "b", canHandle: func(string) bool { return false }})

	all := reg.GetAllProviders()
	assert.Len(t, all, 2)
}

// TestSiteRegistryGetModuleByUrl verifies that a module is matched
// by its base URL or domain.
func TestSiteRegistryGetModuleByUrl(t *testing.T) {
	reg := NewSiteRegistry()
	reg.InitDefaultModules()

	mod, ok := reg.GetModuleByUrl("https://www.xsnvshen.co/gallery/123")
	require.True(t, ok)
	assert.Equal(t, "xsnvshen", mod.ID)
}

// TestSiteDataStoreModules verifies that the unified data source
// includes all expected site IDs.
func TestSiteDataStoreModules(t *testing.T) {
	modules := GetSiteDataStore().GetAllModuleConfigs()
	ids := make(map[string]bool)
	for _, m := range modules {
		ids[m.ID] = true
	}

	for _, expected := range []string{"aimeizizi", "exhentai", "sjs", "xsnvshen", "universal", "kanav"} {
		assert.True(t, ids[expected], "expected site %s in data store modules", expected)
	}
}

// TestSiteRegistryGetEnabledProviders verifies that only providers
// with enabled modules are returned.
func TestSiteRegistryGetEnabledProviders(t *testing.T) {
	reg := NewSiteRegistry()
	reg.RegisterModule(SiteModuleConfig{ID: "enabled-site", Enabled: true})
	reg.RegisterModule(SiteModuleConfig{ID: "disabled-site", Enabled: false})

	reg.Register(&mockProvider{id: "enabled-site", canHandle: func(string) bool { return false }})
	reg.Register(&mockProvider{id: "disabled-site", canHandle: func(string) bool { return false }})

	enabled := reg.GetEnabledProviders()
	assert.Len(t, enabled, 1)
	assert.Equal(t, "enabled-site", enabled[0].SiteID())
}

// TestSiteRegistryGetSiteInfos verifies that site infos are built
// only for providers that have a registered module.
func TestSiteRegistryGetSiteInfos(t *testing.T) {
	reg := NewSiteRegistry()
	reg.RegisterModule(SiteModuleConfig{
		ID:      "test",
		NameCn:  "����",
		NameEn:  "Test",
		BaseURL: "https://test.com",
		Type:    "photo",
		Enabled: true,
	})
	reg.Register(&mockProvider{id: "test", canHandle: func(string) bool { return false }})

	infos := reg.GetSiteInfos()
	assert.Len(t, infos, 1)
	assert.Equal(t, "test", infos[0].ID)
	assert.True(t, infos[0].Gallery)
}

// TestExtractHost verifies URL host extraction.
func TestExtractHost(t *testing.T) {
	tests := []struct {
		url      string
		expected string
	}{
		{"https://www.example.com/path", "www.example.com"},
		{"http://localhost:8080", "localhost"},
		{"invalid", ""},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			result := extractHost(tt.url)
			assert.Equal(t, tt.expected, result)
		})
	}
}
