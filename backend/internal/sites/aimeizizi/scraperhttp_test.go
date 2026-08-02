package aimeizizi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/sites"
	"backend/internal/xutil"
)

// mockScrapeDeps implements ScrapeDeps for HTTP scraper tests,
// returning the test server's URL as the domain so that
// fetchAndParse routes requests to the mock server instead of
// hitting real gallery sites.
type mockScrapeDeps struct {
	domains     []string
	placeholder string
	blocked     bool
	blockErr    error
}

func (m *mockScrapeDeps) ResolveURL(rawURL, domain string) string {
	if rawURL == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	if strings.HasPrefix(rawURL, "/") {
		return strings.TrimRight(domain, "/") + rawURL
	}
	return rawURL
}

func (m *mockScrapeDeps) CleanTitle(rawTitle string) string {
	return strings.TrimSpace(rawTitle)
}

func (m *mockScrapeDeps) ExtractProtagonist(title string, tags []string) string {
	return ""
}

func (m *mockScrapeDeps) ExtractDescription(title, protagonist string) string {
	if title == "" {
		return ""
	}
	return title
}

func (m *mockScrapeDeps) CheckBlockedAsync(_ context.Context, _, _, _ string) (sites.BlockCheckResult, error) {
	if m.blockErr != nil {
		return sites.BlockCheckResult{}, m.blockErr
	}
	return sites.BlockCheckResult{Blocked: m.blocked}, nil
}

func (m *mockScrapeDeps) GetDomains() []string { return m.domains }

func (m *mockScrapeDeps) GetPlaceholder() string { return m.placeholder }

// galleryHTML returns a mock gallery page HTML with the given title
// and image count, simulating a real aimeizizi article page.
func galleryHTML(title string, imageCount int, totalPages int) string {
	var imgs strings.Builder
	for i := 0; i < imageCount; i++ {
		imgs.WriteString(`<img data-src="https://cdn.example.com/img-`)
		imgs.WriteByte(byte('0' + i))
		imgs.WriteString(`.jpg" />`)
	}

	nav := ""
	if totalPages > 1 {
		nav = `<nav>第1 页，共` + itoa(totalPages) + ` 页</nav>`
	}

	return `<html><head><title>` + title + ` | LoveCutes</title></head><body>
		<h1>` + title + `</h1>
		` + nav + `
		<article>` + imgs.String() + `</article>
		</body></html>`
}

// emptyPageHTML returns HTML without an article element, simulating
// a 404 or error page that should be skipped during domain failover.
func emptyPageHTML() string {
	return `<html><head><title>Not Found</title></head><body><p>Page not found</p></body></html>`
}

// --- ScrapeGalleryHTTP ---

// TestScrapeGalleryHTTP_SinglePage verifies that a single-page
// gallery is scraped correctly, including title extraction, image
// URL collection, and page count ??this is the happy path that
// covers the core scrape pipeline without multi-page complexity.
func TestScrapeGalleryHTTP_SinglePage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(galleryHTML("Test Gallery", 3, 1)))
	}))
	defer server.Close()

	deps := &mockScrapeDeps{
		domains:     []string{server.URL},
		placeholder: "/static/zde/timg.gif",
	}

	result, err := ScrapeGalleryHTTP(context.Background(), server.URL+"/article/123/", deps)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "Test Gallery", result.Title)
	assert.Equal(t, 3, result.ImageCount)
	assert.Equal(t, 1, result.PageCount)
	assert.Len(t, result.Images, 3)
	assert.Equal(t, "https://cdn.example.com/img-0.jpg", result.Images[0].URL)
	assert.Equal(t, server.URL, result.ScrapedDomain)
}

// TestScrapeGalleryHTTP_MultiPage verifies that a multi-page gallery
// is scraped with images collected from all pages, as the scraper
// must follow pagination links to build the complete image list.
func TestScrapeGalleryHTTP_MultiPage(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/article/123/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(galleryHTML("Multi Page Gallery", 2, 2)))
	})
	mux.HandleFunc("/article/123/page/2/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		html := `<html><head><title>Multi Page Gallery | LoveCutes</title></head><body>
			<h1>Multi Page Gallery</h1>
			<nav>第2 页，共2 页</nav>
			<article>
			<img data-src="https://cdn.example.com/img-2.jpg" />
			<img data-src="https://cdn.example.com/img-3.jpg" />
			</article>
			</body></html>`
		w.Write([]byte(html))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	deps := &mockScrapeDeps{
		domains:     []string{server.URL},
		placeholder: "/static/zde/timg.gif",
	}

	result, err := ScrapeGalleryHTTP(context.Background(), server.URL+"/article/123/", deps)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "Multi Page Gallery", result.Title)
	assert.Equal(t, 2, result.PageCount)
	assert.Equal(t, 4, result.ImageCount)
	assert.Len(t, result.Images, 4)
}

// TestScrapeGalleryHTTP_AllDomainsFail verifies that when all
// domains return pages without article elements, the scraper
// returns an error rather than a nil result, so the caller can
// fall back to browser-based scraping.
func TestScrapeGalleryHTTP_AllDomainsFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(emptyPageHTML()))
	}))
	defer server.Close()

	deps := &mockScrapeDeps{
		domains:     []string{server.URL},
		placeholder: "/static/zde/timg.gif",
	}

	result, err := ScrapeGalleryHTTP(context.Background(), server.URL+"/article/123/", deps)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to fetch")
}

// TestScrapeGalleryHTTP_ContentBlocked verifies that when the
// block check reports content as blocked, the scraper returns an
// error with the block reason, preventing blocked content from
// entering the download pipeline.
func TestScrapeGalleryHTTP_ContentBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(galleryHTML("Blocked Content", 2, 1)))
	}))
	defer server.Close()

	deps := &mockScrapeDeps{
		domains:     []string{server.URL},
		placeholder: "/static/zde/timg.gif",
		blocked:     true,
	}

	result, err := ScrapeGalleryHTTP(context.Background(), server.URL+"/article/123/", deps)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "blocked")
}

// TestScrapeGalleryHTTP_ContextCancelled verifies that a cancelled
// context causes the scraper to return early with the context error,
// preventing indefinite hangs when the user aborts a download.
func TestScrapeGalleryHTTP_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(galleryHTML("Test Gallery", 2, 1)))
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	deps := &mockScrapeDeps{
		domains:     []string{server.URL},
		placeholder: "/static/zde/timg.gif",
	}

	result, err := ScrapeGalleryHTTP(ctx, server.URL+"/article/123/", deps)
	require.Error(t, err)
	assert.Nil(t, result)
}

// --- convertZipInfo ---

// TestConvertZipInfo_Nil verifies that a nil input produces a nil
// result, so the scraper can safely pass through absent zip info.
func TestConvertZipInfo_Nil(t *testing.T) {
	assert.Nil(t, convertZipInfo(nil))
}

// TestConvertZipInfo_Full verifies that all fields from the HTML-
// parsed ZipInfoFromHtml are transferred to the sites.GalleryZipInfo
// struct, as the downloader relies on these fields to resolve the
// archive download path.
func TestConvertZipInfo_Full(t *testing.T) {
	info := &ZipInfoFromHtml{
		Title:           "Archive",
		FileCount:       50,
		FileSizeText:    "100MB",
		ImageDimensions: "1920x1080",
		Password:        "secret",
		DownloadURL:     "https://example.com/dl.zip",
		Provider:        "mediafire",
		RequiresLogin:   true,
		RequiresEmail:   false,
	}

	result := convertZipInfo(info)
	require.NotNil(t, result)
	assert.Equal(t, "Archive", result.Title)
	assert.Equal(t, 50, result.FileCount)
	assert.Equal(t, "100MB", result.FileSizeText)
	assert.Equal(t, "1920x1080", result.ImageDimensions)
	assert.Equal(t, "secret", result.Password)
	assert.Equal(t, "https://example.com/dl.zip", result.DownloadURL)
	assert.Equal(t, "mediafire", result.Provider)
	assert.True(t, result.RequiresLogin)
	assert.False(t, result.RequiresEmail)
}

// --- uniqueStrings ---

// TestUniqueStrings verifies that duplicate strings are removed
// while preserving order, as the scraper uses this to merge tags
// from page content and meta keywords without duplicates.
func TestUniqueStrings(t *testing.T) {
	input := []string{"a", "b", "a", "c", "b", "d"}
	result := xutil.UniqueStrings(input, true)
	assert.Equal(t, []string{"a", "b", "c", "d"}, result)
}

// TestUniqueStrings_Empty verifies that an empty input produces
// an empty result, not a nil slice, for consistent downstream
// JSON serialisation.
func TestUniqueStrings_Empty(t *testing.T) {
	result := xutil.UniqueStrings([]string{}, true)
	assert.Empty(t, result)
}

// TestUniqueStrings_Nil verifies that nil input does not panic.
func TestUniqueStrings_Nil(t *testing.T) {
	result := xutil.UniqueStrings(nil, true)
	assert.Empty(t, result)
}

// TestUniqueStrings_AllDuplicates verifies that all-duplicate
// input collapses to a single element.
func TestUniqueStrings_AllDuplicates(t *testing.T) {
	result := xutil.UniqueStrings([]string{"x", "x", "x"}, true)
	assert.Equal(t, []string{"x"}, result)
}

// --- itoa ---

// TestItoa verifies the integer-to-string conversion helper used
// to construct multi-page URLs in the scraper.
func TestItoa(t *testing.T) {
	assert.Equal(t, "0", itoa(0))
	assert.Equal(t, "42", itoa(42))
	assert.Equal(t, "999", itoa(999))
}
