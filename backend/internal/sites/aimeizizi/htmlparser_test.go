package aimeizizi

import (
	"regexp"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mustDoc parses an HTML string into a goquery Document, failing the
// test immediately if parsing errors. Keeping this helper centralised
// avoids repeating error-handling boilerplate in every fixture-based test.
func mustDoc(t *testing.T, html string) *goquery.Document {
	t.Helper()
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	require.NoError(t, err)
	return doc
}

// --- ParseArticlePageConfig ---

// TestParseArticlePageConfig_Valid verifies that the JSON embedded in
// the #article-page-config script tag is correctly deserialised into
// the ArticlePageConfig struct, carrying pagination and video metadata
// needed by the scraper to decide page traversal depth.
func TestParseArticlePageConfig_Valid(t *testing.T) {
	html := `<html><head>
		<script id="article-page-config" type="application/json">{"pageId":42,"pagination":{"current_page":1,"total_pages":5,"has_next":true,"has_prev":false},"title":{"baseTitle":"Test"},"video":{"enabled":true,"count":2}}</script>
		</head><body></body></html>`
	doc := mustDoc(t, html)

	cfg := ParseArticlePageConfig(doc)
	require.NotNil(t, cfg)
	assert.Equal(t, 42, cfg.PageID)
	assert.Equal(t, 5, cfg.Pagination.TotalPages)
	assert.True(t, cfg.Pagination.HasNext)
	assert.True(t, cfg.Video.Enabled)
	assert.Equal(t, 2, cfg.Video.Count)
}

// TestParseArticlePageConfig_NoScriptTag ensures a nil result is
// returned when the page has no article-page-config element, so the
// caller can fall back to HTML-based pagination detection.
func TestParseArticlePageConfig_NoScriptTag(t *testing.T) {
	doc := mustDoc(t, `<html><body>no config here</body></html>`)
	assert.Nil(t, ParseArticlePageConfig(doc))
}

// TestParseArticlePageConfig_EmptyContent confirms that an empty
// script tag body yields nil rather than a zero-value struct.
func TestParseArticlePageConfig_EmptyContent(t *testing.T) {
	html := `<html><head><script id="article-page-config"></script></head></html>`
	doc := mustDoc(t, html)
	assert.Nil(t, ParseArticlePageConfig(doc))
}

// TestParseArticlePageConfig_InvalidJSON verifies that malformed JSON
// inside the script tag is silently rejected, preventing a single
// broken page from crashing the entire scrape pipeline.
func TestParseArticlePageConfig_InvalidJSON(t *testing.T) {
	html := `<html><head><script id="article-page-config">{bad json}</script></head></html>`
	doc := mustDoc(t, html)
	assert.Nil(t, ParseArticlePageConfig(doc))
}

// --- ParseGalleryPageHtml ---

// TestParseGalleryPageHtml_BasicMetadata checks that the h1 title,
// raw title, and breadcrumb category are extracted correctly ??these
// are the primary identity fields stored in the database.
func TestParseGalleryPageHtml_BasicMetadata(t *testing.T) {
	html := `<html><head><title>Test Gallery | LoveCutes</title></head><body>
		<h1>Test Gallery</h1>
		<nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/category/photo">Photo</a></nav>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Equal(t, "Test Gallery", result.H1Title)
	assert.Equal(t, "Test Gallery | LoveCutes", result.RawTitle)
	assert.Equal(t, "Photo", result.Category)
}

// TestParseGalleryPageHtml_Images verifies that image URLs are
// extracted from multiple data attributes (data-src, data-original-src,
// etc.) and that placeholder/loading images are filtered out, since
// including them would pollute the download queue with broken links.
func TestParseGalleryPageHtml_Images(t *testing.T) {
	html := `<html><body><article>
		<img data-src="https://example.com/img1.jpg" />
		<img data-original-src="https://example.com/img2.jpg" />
		<img src="https://example.com/static/zde/timg.gif" />
		<img src="/static/images/Loading.gif" />
		<img src="data:image/png;base64,abc" />
		<img src="https://example.com/img3.jpg" />
		</article></body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Len(t, result.Images, 3)
	assert.Equal(t, "https://example.com/img1.jpg", result.Images[0].URL)
	assert.Equal(t, "https://example.com/img2.jpg", result.Images[1].URL)
	assert.Equal(t, "https://example.com/img3.jpg", result.Images[2].URL)
	assert.Equal(t, 0, result.Images[0].PageIndex)
}

// TestParseGalleryPageHtml_CoverURL verifies that the first non-
// placeholder image in the article is selected as the cover, which
// is displayed in gallery cards and search results.
func TestParseGalleryPageHtml_CoverURL(t *testing.T) {
	html := `<html><body><article>
		<img src="https://example.com/static/zde/timg.gif" />
		<img data-src="https://example.com/cover.jpg" />
		</article></body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Equal(t, "https://example.com/cover.jpg", result.CoverURL)
}

// TestParseGalleryPageHtml_Videos_M3u8AndMp4 verifies that both m3u8
// (HLS streaming) and mp4 (direct download) video sources are captured,
// since the downloader needs to handle both protocols.
func TestParseGalleryPageHtml_Videos_M3u8AndMp4(t *testing.T) {
	html := `<html><body>
		<video><source src="https://example.com/video.m3u8" /></video>
		<video><source src="https://example.com/clip.mp4" /></video>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Len(t, result.Videos, 2)
	assert.Contains(t, result.Videos, "https://example.com/video.m3u8")
	assert.Contains(t, result.Videos, "https://example.com/clip.mp4")
}

// TestParseGalleryPageHtml_Videos_FromScript ensures that m3u8 URLs
// embedded in inline JavaScript are also captured, as some pages inject
// video sources dynamically rather than using <source> tags.
func TestParseGalleryPageHtml_Videos_FromScript(t *testing.T) {
	html := `<html><body>
		<script>var player = {url: "https://cdn.example.com/stream.m3u8?token=abc"};</script>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Len(t, result.Videos, 1)
	assert.Contains(t, result.Videos, "https://cdn.example.com/stream.m3u8?token=abc")
}

// TestParseGalleryPageHtml_Videos_Deduplication confirms that the same
// video URL appearing in both a <source> tag and inline script is
// only collected once, preventing redundant download tasks.
func TestParseGalleryPageHtml_Videos_Deduplication(t *testing.T) {
	url := "https://example.com/video.m3u8"
	html := `<html><body>
		<video><source src="` + url + `" /></video>
		<script>var x = "` + url + `";</script>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Len(t, result.Videos, 1)
}

// TestParseGalleryPageHtml_Tags verifies that tag links are extracted
// and deduplicated, since duplicate tags would skew the tag cloud and
// search filtering on the frontend.
func TestParseGalleryPageHtml_Tags(t *testing.T) {
	html := `<html><body>
		<a href="/tag/cute">cute</a>
		<a href="/tag/cute">cute</a>
		<a href="/tag/model">model</a>
		<a href="/tag/">标签</a>
		<a href="/tag/longtag">this-tag-text-is-definitely-over-thirty-chars</a>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Len(t, result.Tags, 2)
	assert.Contains(t, result.Tags, "cute")
	assert.Contains(t, result.Tags, "model")
}

// TestParseGalleryPageHtml_Pagination verifies that the Chinese
// pagination text (第N页 共M页) is correctly parsed, enabling the
// scraper to iterate through all pages of a multi-page gallery.
func TestParseGalleryPageHtml_Pagination(t *testing.T) {
	tests := []struct {
		name        string
		navText     string
		currentPage int
		totalPages  int
	}{
		{"simplified", "第2 页，共5 页", 2, 5},
		{"traditional", "第3 頁，共10 頁", 3, 10},
		{"no spaces", "第1页共3页", 1, 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			html := `<html><body><nav>` + tt.navText + `</nav></body></html>`
			doc := mustDoc(t, html)
			result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
			assert.Equal(t, tt.currentPage, result.CurrentPage)
			assert.Equal(t, tt.totalPages, result.TotalPages)
		})
	}
}

// TestParseGalleryPageHtml_PublishTime_FromJSONLD verifies that the
// upload date from JSON-LD structured data is extracted, which is the
// most reliable publish-time source when available.
func TestParseGalleryPageHtml_PublishTime_FromJSONLD(t *testing.T) {
	html := `<html><body>
		<script type="application/ld+json">{"@type":"VideoObject","uploadDate":"2025-06-15T12:00:00"}</script>
		</body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Equal(t, "2025-06-15", result.PublishTime)
}

// TestParseGalleryPageHtml_PublishTime_FromCoverURL ensures that when
// JSON-LD is absent, the publish date falls back to extracting a
// YYYY/MM/DD pattern from the cover image URL, which many CMSes embed.
func TestParseGalleryPageHtml_PublishTime_FromCoverURL(t *testing.T) {
	html := `<html><body><article>
		<img data-src="https://example.com/uploads/2025/03/20/cover.jpg" />
		</article></body></html>`
	doc := mustDoc(t, html)

	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Equal(t, "2025-03-20", result.PublishTime)
}

// TestParseGalleryPageHtml_NoArticle ensures that when the page has no
// <article> element, the parser still returns a valid (empty) result
// rather than panicking, as the scraper relies on this for graceful
// degradation on malformed pages.
func TestParseGalleryPageHtml_NoArticle(t *testing.T) {
	doc := mustDoc(t, `<html><body><h1>Title</h1></body></html>`)
	result := ParseGalleryPageHtml(doc, 0, "/static/zde/timg.gif")
	assert.Empty(t, result.Images)
	assert.Equal(t, "Title", result.H1Title)
	assert.Equal(t, 1, result.CurrentPage)
	assert.Equal(t, 1, result.TotalPages)
}

// --- ParseSearchResults ---

// TestParseSearchResults verifies that article entries on a listing
// page are parsed into SearchEntry structs with resolved URLs, titles,
// cover images, and dates ??these feed the search results UI.
func TestParseSearchResults(t *testing.T) {
	html := `<html><body>
		<article>
			<a href="/article/123/">Link</a>
			<h2><a href="/article/123/" title="Gallery Alpha">Alpha</a></h2>
			<img data-src="/images/alpha.jpg" />
			<footer><time>2025-01-15</time></footer>
		</article>
		<article>
			<a href="/article/456/">Link</a>
			<h2><a href="/article/456/" title="Gallery Beta">Beta</a></h2>
			<img data-src="https://cdn.example.com/beta.jpg" />
			<footer><time>2025-02-20</time></footer>
		</article>
		</body></html>`
	doc := mustDoc(t, html)

	results := ParseSearchResults(doc, "https://www.lovecutes.com", "/static/zde/timg.gif")
	require.Len(t, results, 2)

	assert.Equal(t, "https://www.lovecutes.com/article/123/", results[0].URL)
	assert.Equal(t, "Gallery Alpha", results[0].Title)
	assert.Equal(t, "https://www.lovecutes.com/images/alpha.jpg", results[0].CoverURL)
	assert.Equal(t, "2025-01-15", results[0].Date)

	assert.Equal(t, "https://www.lovecutes.com/article/456/", results[1].URL)
	assert.Equal(t, "https://cdn.example.com/beta.jpg", results[1].CoverURL)
}

// TestParseSearchResults_Deduplication ensures that duplicate article
// links (e.g. thumbnail + title pointing to the same URL) do not
// produce duplicate search entries.
func TestParseSearchResults_Deduplication(t *testing.T) {
	html := `<html><body>
		<article>
			<a href="/article/123/">Link</a>
			<img data-src="/images/alpha.jpg" />
		</article>
		<article>
			<a href="/article/123/">Link</a>
			<img data-src="/images/alpha2.jpg" />
		</article>
		</body></html>`
	doc := mustDoc(t, html)

	results := ParseSearchResults(doc, "https://www.lovecutes.com", "/static/zde/timg.gif")
	assert.Len(t, results, 1)
}

// TestParseSearchResults_Empty confirms that a page with no articles
// returns an empty slice rather than nil, so the caller can safely
// check len() without nil-pointer concerns.
func TestParseSearchResults_Empty(t *testing.T) {
	doc := mustDoc(t, `<html><body><p>no results</p></body></html>`)
	results := ParseSearchResults(doc, "https://www.lovecutes.com", "/static/zde/timg.gif")
	assert.Empty(t, results)
}

// --- ParseZipInfoFromHtml ---

// TestParseZipInfoFromHtml_Full verifies that all ZIP download fields
// (file count, size, dimensions, password, download URL, provider)
// are extracted from the download info box on the gallery page.
func TestParseZipInfoFromHtml_Full(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-title">Archive Name</div>
			<div class="info-item"><strong>文件数量</strong> 50</div>
			<div class="info-item"><strong>文件大小</strong> 120MB</div>
			<div class="info-item"><strong>图片尺寸</strong> 1920x1080</div>
			<div class="info-item"><strong>密码</strong> <input class="password-input" value="secret123" /></div>
		</div>
		<a class="btn-download" href="https://mediafire.com/download/abc" data-provider="mediafire">
			<span class="download-label">MediaFire Download</span>
		</a>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "Archive Name", info.Title)
	assert.Equal(t, 50, info.FileCount)
	assert.Equal(t, "120MB", info.FileSizeText)
	assert.Equal(t, "1920x1080", info.ImageDimensions)
	assert.Equal(t, "secret123", info.Password)
	assert.Equal(t, "https://mediafire.com/download/abc", info.DownloadURL)
	assert.Equal(t, "MediaFire", info.Provider)
}

// TestParseZipInfoFromHtml_RelativeURL verifies that a relative
// download href is resolved against the provided domain, since many
// sites use relative links for internal download endpoints.
func TestParseZipInfoFromHtml_RelativeURL(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-item"><strong>Files</strong> 10</div>
		</div>
		<a class="btn-download" href="/download/archive.zip" data-provider="local">Download</a>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "https://www.lovecutes.com/download/archive.zip", info.DownloadURL)
}

// TestParseZipInfoFromHtml_RequiresLogin confirms that the login
// requirement is detected from both the button's is-locked class and
// the download notice text, so the frontend can prompt for auth.
func TestParseZipInfoFromHtml_RequiresLogin(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-item"><strong>Files</strong> 10</div>
		</div>
		<a class="btn-download is-locked" href="/auth/login" data-provider="local">Login to Download</a>
		<div class="download-notice-text">Please login to download</div>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.True(t, info.RequiresLogin)
}

// TestParseZipInfoFromHtml_RequiresEmail verifies that email
// verification requirement is detected from the notice text.
func TestParseZipInfoFromHtml_RequiresEmail(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-item"><strong>Files</strong> 10</div>
		</div>
		<div class="download-notice-text">Please 验证 your email to download</div>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.True(t, info.RequiresEmail)
}

// TestParseZipInfoFromHtml_NoDownloadBox confirms that nil is returned
// when the page has neither a download-info-box nor a download-section,
// indicating no archive download is available.
func TestParseZipInfoFromHtml_NoDownloadBox(t *testing.T) {
	doc := mustDoc(t, `<html><body><p>no downloads</p></body></html>`)
	assert.Nil(t, ParseZipInfoFromHtml(doc, "https://www.lovecutes.com"))
}

// TestParseZipInfoFromHtml_EmptyInfoReturnsNil verifies that a
// download box with no meaningful data (no file count, size, or URL)
// returns nil, preventing empty zip info from polluting the result.
func TestParseZipInfoFromHtml_EmptyInfoReturnsNil(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box"><div class="info-title">Empty</div></div>
		</body></html>`
	doc := mustDoc(t, html)
	assert.Nil(t, ParseZipInfoFromHtml(doc, "https://www.lovecutes.com"))
}

// --- OUO URL Detection ---

// TestParseZipInfoFromHtml_OUOFromAnchor verifies that an OUO short link
// embedded in an <a> tag is detected and extracted, enabling the downloader
// to resolve the short link to the actual ZIP file.
func TestParseZipInfoFromHtml_OUOFromAnchor(t *testing.T) {
	html := `<html><body>
		<article>
			<a href="https://ouo.io/abc123">Download ZIP</a>
			<img data-src="https://example.com/img1.jpg" />
		</article>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "https://ouo.io/abc123", info.OuoURL)
	assert.Equal(t, "ouo", info.DownloadSource)
}

// TestParseZipInfoFromHtml_OUOFromScript verifies that an OUO URL
// embedded in a JavaScript script tag is detected, as some pages
// dynamically inject download links via scripts.
func TestParseZipInfoFromHtml_OUOFromScript(t *testing.T) {
	html := `<html><body>
		<script>var downloadLink = "https://ouo.io/xyz789";</script>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "https://ouo.io/xyz789", info.OuoURL)
	assert.Equal(t, "ouo", info.DownloadSource)
}

// TestParseZipInfoFromHtml_OUOFromText verifies that an OUO URL
// appearing in plain text anywhere on the page is detected.
func TestParseZipInfoFromHtml_OUOFromText(t *testing.T) {
	html := `<html><body>
		<p>Download: https://ouo.io/text456</p>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "https://ouo.io/text456", info.OuoURL)
	assert.Equal(t, "ouo", info.DownloadSource)
}

// TestParseZipInfoFromHtml_OUOPressDomain verifies that ouo.press
// short links are also recognized as OUO URLs.
func TestParseZipInfoFromHtml_OUOPressDomain(t *testing.T) {
	html := `<html><body>
		<a href="https://ouo.press/press789">Download</a>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "https://ouo.press/press789", info.OuoURL)
	assert.Equal(t, "ouo", info.DownloadSource)
}

// TestParseZipInfoFromHtml_OUOWithDownloadBox verifies that when both
// a download box and an OUO link exist, both are captured.
func TestParseZipInfoFromHtml_OUOWithDownloadBox(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-title">Archive Name</div>
			<div class="info-item"><strong>文件数量</strong> 50</div>
		</div>
		<a class="btn-download" href="https://ouo.io/combined123" data-provider="ouo">
			<span class="download-label">Download</span>
		</a>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Equal(t, "Archive Name", info.Title)
	assert.Equal(t, 50, info.FileCount)
	assert.Equal(t, "https://ouo.io/combined123", info.OuoURL)
	assert.Equal(t, "ouo", info.DownloadSource)
}

// TestParseZipInfoFromHtml_NoOUOWhenNoLink verifies that when no OUO
// link exists, the OuoURL field remains empty.
func TestParseZipInfoFromHtml_NoOUOWhenNoLink(t *testing.T) {
	html := `<html><body>
		<div class="download-info-box">
			<div class="info-item"><strong>Files</strong> 10</div>
		</div>
		<a class="btn-download" href="https://mediafire.com/download/abc" data-provider="mediafire">Download</a>
		</body></html>`
	doc := mustDoc(t, html)

	info := ParseZipInfoFromHtml(doc, "https://www.lovecutes.com")
	require.NotNil(t, info)
	assert.Empty(t, info.OuoURL)
	assert.Equal(t, "https://mediafire.com/download/abc", info.DownloadURL)
}

// TestExtractOuoURL verifies the extractOuoURL helper function directly.
func TestExtractOuoURL(t *testing.T) {
	tests := []struct {
		name string
		html string
		want string
	}{
		{
			name: "anchor_tag",
			html: `<a href="https://ouo.io/test1">Link</a>`,
			want: "https://ouo.io/test1",
		},
		{
			name: "script_tag",
			html: `<script>var x = "https://ouo.io/test2";</script>`,
			want: "https://ouo.io/test2",
		},
		{
			name: "plain_text",
			html: `<p>URL: https://ouo.io/test3</p>`,
			want: "https://ouo.io/test3",
		},
		{
			name: "ouo_press",
			html: `<a href="https://ouo.press/test4">Link</a>`,
			want: "https://ouo.press/test4",
		},
		{
			name: "no_ouo",
			html: `<a href="https://example.com/file.zip">Link</a>`,
			want: "",
		},
		{
			name: "www_prefix",
			html: `<a href="https://www.ouo.io/test5">Link</a>`,
			want: "https://www.ouo.io/test5",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := mustDoc(t, `<html><body>`+tt.html+`</body></html>`)
			got := extractOuoURL(doc)
			assert.Equal(t, tt.want, got)
		})
	}
}

// --- Constants functions ---

// TestExtractArticleID verifies that the numeric article ID is
// extracted from various URL formats, as this ID drives the
// multi-page URL construction in the scraper.
func TestExtractArticleID(t *testing.T) {
	tests := []struct {
		url  string
		want string
	}{
		{"https://www.lovecutes.com/article/12345/", "12345"},
		{"https://www.lovecutes.com/article/67890/page/2/", "67890"},
		{"https://www.lovecutes.com/article/999", "999"},
		{"https://www.lovecutes.com/category/photo", ""},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractArticleID(tt.url))
		})
	}
}

// TestExtractDomainFromUrl verifies that the scheme+host prefix is
// extracted when the URL starts with a known domain, which the
// scraper uses to reorder domain priority during failover.
func TestExtractDomainFromUrl(t *testing.T) {
	domains := []string{"https://www.lovecutes.com", "https://xx.knit.bid"}
	assert.Equal(t, "https://www.lovecutes.com", ExtractDomainFromUrl("https://www.lovecutes.com/article/123/", domains))
	assert.Equal(t, "https://xx.knit.bid", ExtractDomainFromUrl("https://xx.knit.bid/article/123/", domains))
	assert.Equal(t, "", ExtractDomainFromUrl("https://unknown.com/article/123/", domains))
}

// TestCleanTitleImpl verifies that publisher prefixes and site suffix
// patterns are stripped from raw titles, producing clean titles for
// display and search indexing.
func TestCleanTitleImpl(t *testing.T) {
	suffixPatterns := []*regexp.Regexp{
		regexp.MustCompile(`\s*[|\-]\s*(爱妹子|LoveCutes)\s*$`),
	}
	prefixes := []string{"[爱妹子]", "【爱妹子吧】", "[LoveCutes]"}

	tests := []struct {
		name    string
		input   string
		want    string
	}{
		{"plain title", "My Gallery", "My Gallery"},
		{"prefix removal", "[爱妹子] My Gallery", "My Gallery"},
		{"bracket prefix removal", "【爱妹子吧】My Gallery", "My Gallery"},
		{"suffix removal", "My Gallery | 爱妹子", "My Gallery"},
		{"prefix and suffix", "[LoveCutes] My Gallery - LoveCutes", "My Gallery"},
		{"empty input", "", ""},
		{"only prefix", "[爱妹子]", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := cleanTitleImpl(tt.input, suffixPatterns, prefixes)
			assert.Equal(t, tt.want, got)
		})
	}
}

// TestRemovePublisherPrefix verifies that known publisher prefixes
// are stripped, leaving the actual gallery title intact.
func TestRemovePublisherPrefix(t *testing.T) {
	prefixes := []string{"[爱妹子]", "【爱妹子吧】"}
	assert.Equal(t, "My Title", removePublisherPrefix("[爱妹子] My Title", prefixes))
	assert.Equal(t, "My Title", removePublisherPrefix("【爱妹子吧】My Title", prefixes))
	assert.Equal(t, "Unknown Title", removePublisherPrefix("Unknown Title", prefixes))
}

// --- Helper functions ---

// TestFirstNonEmpty verifies that the first non-empty string in a
// variadic list is returned, which is used to check multiple image
// data attributes in priority order.
func TestFirstNonEmpty(t *testing.T) {
	assert.Equal(t, "a", firstNonEmpty("a", "b", "c"))
	assert.Equal(t, "b", firstNonEmpty("", "b", "c"))
	assert.Equal(t, "c", firstNonEmpty("", "", "c"))
	assert.Equal(t, "", firstNonEmpty("", "", ""))
	assert.Equal(t, "", firstNonEmpty())
}

// TestAtoiSafe verifies that numeric strings are converted to
// integers without panicking on non-numeric input, as pagination
// text may contain unexpected characters.
func TestAtoiSafe(t *testing.T) {
	assert.Equal(t, 42, atoiSafe("42"))
	assert.Equal(t, 123, atoiSafe("123"))
	assert.Equal(t, 0, atoiSafe(""))
	assert.Equal(t, 0, atoiSafe("abc"))
	assert.Equal(t, 42, atoiSafe("page 42"))
}

// TestResolveURL verifies that relative URLs are resolved against
// the base URL, while absolute URLs are returned unchanged, which is
// critical for constructing correct image and link URLs from scraped
// HTML that may use either format.
func TestResolveURL(t *testing.T) {
	base := "https://www.lovecutes.com"
	assert.Equal(t, "https://example.com/img.jpg", resolveURL("https://example.com/img.jpg", base))
	assert.Equal(t, "http://example.com/img.jpg", resolveURL("http://example.com/img.jpg", base))
	assert.Equal(t, "https://cdn.example.com/img.jpg", resolveURL("//cdn.example.com/img.jpg", base))
	assert.Equal(t, "https://www.lovecutes.com/article/123", resolveURL("/article/123", base))
	assert.Equal(t, "relative/path", resolveURL("relative/path", base))
}
