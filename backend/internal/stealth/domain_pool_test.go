package stealth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNewDomainPool(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com", "https://b.com"}, "https://publisher.com")
	assert.NotNil(t, pool)
	assert.Equal(t, "test", pool.siteID)
	assert.Equal(t, []string{"https://a.com", "https://b.com"}, pool.staticDomains)
	assert.Equal(t, "https://publisher.com", pool.publisherURL)
}

func TestDomainPoolGetDomains_StaticOnly(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com", "https://b.com"}, "")
	domains := pool.GetDomains()
	assert.Equal(t, []string{"https://a.com", "https://b.com"}, domains)
}

func TestDomainPoolGetDomains_WithPublisher(t *testing.T) {
	// With a publisher URL but no cached data yet, it should return static domains
	// and trigger a background fetch
	pool := NewDomainPool("test", []string{"https://a.com"}, "https://non-existent-publisher-xyz123.com")

	// First call should return static domains immediately (background fetch will fail)
	domains := pool.GetDomains()
	assert.Equal(t, []string{"https://a.com"}, domains)

	// Cache should be empty after failed fetch
	count, _, expired := pool.GetCacheInfo()
	assert.Equal(t, 0, count)
	assert.True(t, expired)
}

func TestDomainPoolGetDomainsForceRefresh_EmptyPublisher(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com", "https://b.com"}, "")
	domains := pool.GetDomainsForceRefresh()
	assert.Equal(t, []string{"https://a.com", "https://b.com"}, domains)
}

func TestDomainPoolSetPublisherURL(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com"}, "")
	pool.SetPublisherURL("https://new-publisher.com")

	// After changing publisher URL, cache should be reset
	count, lastFetch, _ := pool.GetCacheInfo()
	assert.Equal(t, 0, count)
	assert.True(t, lastFetch.IsZero())
}

func TestDomainPoolSetStaticDomains(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com"}, "")
	pool.SetStaticDomains([]string{"https://x.com", "https://y.com"})

	domains := pool.GetDomains()
	assert.Equal(t, []string{"https://x.com", "https://y.com"}, domains)
}

func TestDomainPoolGetCacheInfo(t *testing.T) {
	pool := NewDomainPool("test", []string{"https://a.com"}, "")
	count, lastFetch, expired := pool.GetCacheInfo()
	assert.Equal(t, 0, count)
	assert.True(t, lastFetch.IsZero())
	assert.True(t, expired)
}

func TestDomainScraperExtractDomainsFromHTML(t *testing.T) {
	scraper := NewDomainScraper()

	html := `
	<html>
	<body>
		<a href="https://www.lovecutes.com">Link</a>
		<a href="https://xx.knit.bid">Link</a>
		<a href="https://t.me/channel">Telegram</a>
		<p>Text URL: https://www.lovecutes.net/page/1</p>
	</body>
	</html>
	`

	domains := scraper.ExtractDomainsFromHTML(html)
	assert.Contains(t, domains, "https://www.lovecutes.com")
	assert.Contains(t, domains, "https://xx.knit.bid")
	assert.Contains(t, domains, "https://t.me")
	assert.Contains(t, domains, "https://www.lovecutes.net")
}

func TestDomainScraperExtractDomainsFromHTML_Empty(t *testing.T) {
	scraper := NewDomainScraper()
	domains := scraper.ExtractDomainsFromHTML("")
	assert.Empty(t, domains)
}

func TestNormalizeAndExtractDomain(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"full URL", "https://www.example.com/path", "https://www.example.com"},
		{"http URL", "http://example.com", "http://example.com"},
		{"relative", "/path", ""},
		{"javascript", "javascript:void(0)", ""},
		{"mailto", "mailto:test@test.com", ""},
		{"empty", "", ""},
		{"fragment", "#anchor", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeAndExtractDomain(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractHostname(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"full URL", "https://www.example.com/path", "www.example.com"},
		{"with port", "https://example.com:8080/path", "example.com"},
		{"uppercase", "https://WWW.EXAMPLE.COM", "www.example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractHostname(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestRegisterAndRetrieveDomainPool(t *testing.T) {
	pool := NewDomainPool("test-site", []string{"https://a.com"}, "")
	RegisterDomainPool("test-site", pool)

	retrieved := GetRegisteredDomainPool("test-site")
	assert.NotNil(t, retrieved)
	assert.Equal(t, "test-site", retrieved.siteID)

	// Non-existent site
	assert.Nil(t, GetRegisteredDomainPool("non-existent"))
}

func TestGetRegisteredDomainDomains(t *testing.T) {
	pool := NewDomainPool("test-domains", []string{"https://x.com", "https://y.com"}, "")
	RegisterDomainPool("test-domains", pool)

	domains := GetRegisteredDomainDomains("test-domains")
	assert.Equal(t, []string{"https://x.com", "https://y.com"}, domains)

	// Non-existent site should return nil
	assert.Nil(t, GetRegisteredDomainDomains("non-existent"))
}

func TestDomainPoolMergeDomains(t *testing.T) {
	pool := NewDomainPool("test", nil, "")

	static := []string{"https://a.com", "https://b.com"}
	dynamic := []string{"https://b.com", "https://c.com"}

	merged := pool.mergeDomains(static, dynamic)
	assert.Contains(t, merged, "https://a.com")
	assert.Contains(t, merged, "https://b.com")
	assert.Contains(t, merged, "https://c.com")
	assert.Len(t, merged, 3)

	// Static should come first
	assert.Equal(t, "https://a.com", merged[0])
	assert.Equal(t, "https://b.com", merged[1])
}

func TestDomainPoolFilterSiteDomains(t *testing.T) {
	pool := NewDomainPool("test", []string{
		"https://www.lovecutes.com",
		"https://xx.knit.bid",
	}, "")

	discovered := []string{
		"https://www.lovecutes.com",
		"https://www.lovecutes.net",
		"https://xx.knit.bid",
		"https://t.me",
		"https://google.com",
	}

	filtered := pool.filterSiteDomains(discovered)
	assert.Contains(t, filtered, "https://www.lovecutes.com")
	assert.Contains(t, filtered, "https://www.lovecutes.net")
	assert.Contains(t, filtered, "https://xx.knit.bid")
	assert.NotContains(t, filtered, "https://t.me")
	assert.NotContains(t, filtered, "https://google.com")
}

// Ensure the time package is used (for cache expiry tests)
var _ = time.Time{}
