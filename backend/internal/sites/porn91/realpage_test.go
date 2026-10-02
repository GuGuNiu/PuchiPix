package porn91

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// detailFixture mirrors the shape of a live detail page: the JSON-LD script
// declares a BreadcrumbList at the top level and keeps the VideoObject inside
// its @graph array, and the author is a nested Person object. Matching only
// on a top-level VideoObject is what previously forced the parser onto the
// raw-HTML fallback, where the title was read from the breadcrumb instead.
const detailFixture = `<!DOCTYPE html><html><head>
<meta property="og:title" content="[原创] 巨乳御姐丝袜紧身衣诱惑丝袜黑丝御姐">
<meta property="og:image" content="https://tp.helloye.com/2z4pCgT2c.jpg">
<meta name="keywords" content="好疼,挨罚系列,重复录,女神啪啪,武大郎,91porny, 91porn, 91porn.plus 资源">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","@graph":[
 {"@type":"BreadcrumbList","itemListElement":[
   {"@type":"ListItem","position":1,"name":"首页","item":"https://91porn.plus/"},
   {"@type":"ListItem","position":2,"name":"热门播放","item":"https://91porn.plus/videos"}]},
 {"@type":"VideoObject",
  "name":"[原创] 巨乳御姐丝袜紧身衣诱惑丝袜黑丝御姐",
  "description":"描述占位",
  "url":"https://91porn.plus/video/2z4pCgT2c",
  "uploadDate":"2026-09-28T11:19:33.882Z",
  "thumbnailUrl":["https://tp.helloye.com/2z4pCgT2c.jpg"],
  "duration":"PT07M29S",
  "contentUrl":"https://tm.helloye.com/TOKEN,1790603192/6ab4303151b3f764a9635d6f/index.m3u8",
  "embedUrl":"https://91porn.plus/embed/2z4pCgT2c",
  "interactionStatistic":{"@type":"InteractionCounter","interactionType":{"@type":"WatchAction"},"userInteractionCount":110832},
  "author":{"@type":"Person","name":"babybaby1"}}]}
</script>
</head><body></body></html>`

// extractRawJSONLD returns the first JSON-LD block body from a fixture.
func extractRawJSONLD(t *testing.T, html string) string {
	t.Helper()
	m := JSONLDVideoObjectPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		t.Fatal("fixture has no JSON-LD block")
	}
	return strings.TrimSpace(m[1])
}

func TestDecodeVideoObjectWalksGraph(t *testing.T) {
	raw := extractRawJSONLD(t, detailFixture)

	obj, ok := decodeVideoObject(raw)
	if !ok {
		t.Fatal("decodeVideoObject did not find the VideoObject inside @graph")
	}
	if obj.ContentURL == "" {
		t.Error("ContentURL is empty; the stream URL would be lost")
	}
	if obj.Name == "[原创] 巨乳御姐丝袜紧身衣诱惑丝袜黑丝御姐" {
		return
	}
	t.Errorf("Name = %q, want the video's own name rather than the breadcrumb's", obj.Name)
}

// A page that still publishes a standalone VideoObject must keep working.
func TestDecodeVideoObjectAcceptsFlatBlock(t *testing.T) {
	raw := `{"@context":"https://schema.org","@type":"VideoObject","name":"T","contentUrl":"https://cdn.test/index.m3u8"}`

	obj, ok := decodeVideoObject(raw)
	if !ok {
		t.Fatal("decodeVideoObject rejected a flat VideoObject block")
	}
	if obj.ContentURL != "https://cdn.test/index.m3u8" {
		t.Errorf("ContentURL = %q", obj.ContentURL)
	}
}

func TestDecodeVideoObjectRejectsBlockWithoutStream(t *testing.T) {
	// A graph holding only a breadcrumb must not be accepted as the video.
	raw := `{"@context":"https://schema.org","@type":"BreadcrumbList","@graph":[{"@type":"BreadcrumbList","itemListElement":[]}]}`
	if _, ok := decodeVideoObject(raw); ok {
		t.Error("decodeVideoObject accepted a graph with no VideoObject")
	}
}

func TestScrapeDetailFromHTML(t *testing.T) {
	detail, err := ScrapeDetailFromHTML(detailFixture, "https://91porn.plus/video/2z4pCgT2c")
	if err != nil {
		t.Fatalf("ScrapeDetailFromHTML: %v", err)
	}

	if detail.M3U8URL != "https://tm.helloye.com/TOKEN,1790603192/6ab4303151b3f764a9635d6f/index.m3u8" {
		t.Errorf("M3U8URL = %q", detail.M3U8URL)
	}
	if detail.ID != "2z4pCgT2c" {
		t.Errorf("ID = %q, want 2z4pCgT2c", detail.ID)
	}
	// The author is a nested object; reading it as a string used to abort
	// the decode of the whole block.
	if detail.Author != "babybaby1" {
		t.Errorf("Author = %q, want babybaby1", detail.Author)
	}
	if detail.Views != 110832 {
		t.Errorf("Views = %d, want 110832", detail.Views)
	}
	if detail.DurationSec != 7*60+29 {
		t.Errorf("DurationSec = %d, want %d", detail.DurationSec, 7*60+29)
	}
	if detail.Duration != "07:29" {
		t.Errorf("Duration = %q, want 07:29", detail.Duration)
	}
	if detail.PublishDate != "2026-09-28" {
		t.Errorf("PublishDate = %q, want 2026-09-28", detail.PublishDate)
	}
	if detail.ThumbnailURL != "https://tp.helloye.com/2z4pCgT2c.jpg" {
		t.Errorf("ThumbnailURL = %q", detail.ThumbnailURL)
	}
	if detail.Title == "首页" || detail.Title == "" {
		t.Errorf("Title = %q, want the video title rather than the breadcrumb's first item", detail.Title)
	}
}

// The site publishes no tag markup, so the keywords meta tag is the only
// source, and it is polluted with the site's own SEO keywords.
func TestExtractTagsFiltersBrandKeywords(t *testing.T) {
	got := extractTags(detailFixture)
	want := []string{"好疼", "挨罚系列", "重复录", "女神啪啪", "武大郎"}

	if len(got) != len(want) {
		t.Fatalf("extractTags() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Tags[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestExtractTagsBrandMatchingIsCaseInsensitive(t *testing.T) {
	html := `<meta name="keywords" content="91Porn, 91PORNY, RealTag">`
	got := extractTags(html)
	if len(got) != 1 || got[0] != "RealTag" {
		t.Errorf("extractTags() = %v, want [RealTag]", got)
	}
}

func TestExtractTagsEmpty(t *testing.T) {
	if got := extractTags(`<html></html>`); got != nil {
		t.Errorf("extractTags() = %v, want nil", got)
	}
}

func TestToScrapeResult(t *testing.T) {
	detail, err := ScrapeDetailFromHTML(detailFixture, "https://91porn.plus/video/2z4pCgT2c")
	if err != nil {
		t.Fatalf("ScrapeDetailFromHTML: %v", err)
	}

	out := detail.ToScrapeResult("https://91porn.plus/video/2z4pCgT2c")
	if out.M3U8URL != detail.M3U8URL {
		t.Errorf("M3U8URL = %q", out.M3U8URL)
	}
	if len(out.Actors) != 1 || out.Actors[0] != "babybaby1" {
		t.Errorf("Actors = %v, want [babybaby1]", out.Actors)
	}
	if len(out.Tags) != 5 {
		t.Errorf("Tags = %v, want the 5 non-brand keywords", out.Tags)
	}
}

// An unknown uploader must not become a one-element slice holding "".
func TestToScrapeResultOmitsEmptyActors(t *testing.T) {
	out := (&VideoDetailResult{}).ToScrapeResult("https://91porn.plus/video/abc")
	if out.Actors != nil {
		t.Errorf("Actors = %v, want nil", out.Actors)
	}
}

func TestParseISODurationSeconds(t *testing.T) {
	tests := []struct {
		iso      string
		wantText string
		wantSec  int
	}{
		{"PT07M29S", "07:29", 449},
		{"PT00H11M44S", "11:44", 704},
		{"PT01H00M00S", "01:00:00", 3600},
		{"garbage", "garbage", 0},
	}
	for _, tt := range tests {
		t.Run(tt.iso, func(t *testing.T) {
			text, sec := parseISODurationSeconds(tt.iso)
			if text != tt.wantText || sec != tt.wantSec {
				t.Errorf("parseISODurationSeconds(%q) = (%q, %d), want (%q, %d)", tt.iso, text, sec, tt.wantText, tt.wantSec)
			}
		})
	}
}

// listingFixture mirrors a live listing page: the cards are rendered on the
// client and are absent from the response, so the videos arrive only as an
// ItemList member of the JSON-LD graph. Each entry's thumbnailUrl is a bare
// string here, while the detail page publishes it as an array.
const listingFixture = `<!DOCTYPE html><html><head></head><body>
<app-root></app-root>
<script type="application/ld+json" id="json-ld-website">{"@context":"https://schema.org","@type":"WebSite","name":"91Porn Plus","url":"https://91porn.plus/"}</script>
<script type="application/ld+json" id="json-ld-video-list">{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","@id":"https://91porn.plus/#website","name":"91porn.plus"},
 {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"首页"}]},
 {"@type":"ItemList","name":"当前最热 - Page 2","itemListElement":[
  {"@type":"ListItem","position":1,"item":{"@type":"VideoObject","name":"睡前被肥臀骑到内射","url":"https://91porn.plus/video/nnNJssoYi","description":"d1","uploadDate":"2026-09-28T10:55:33.882Z","embedUrl":"https://91porn.plus/embed/nnNJssoYi","thumbnailUrl":"https://tp.helloye.com/nnNJssoYi.jpg"}},
  {"@type":"ListItem","position":2,"item":{"@type":"VideoObject","name":"反差女大 最后站起来蹬","url":"https://91porn.plus/video/aSz7deTBB","description":"d2","uploadDate":"2026-09-28T10:21:33.882Z","thumbnailUrl":"https://tp.helloye.com/aSz7deTBB.jpg"}}]}]}
</script>
</body></html>`

// The same field is published as a string here and as an array on a detail
// page. A typed slice field would fail the whole listing decode, not just
// that one field.
func TestStringListAcceptsBothRepresentations(t *testing.T) {
	var single stringList
	if err := single.UnmarshalJSON([]byte(`"https://cdn.test/a.jpg"`)); err != nil {
		t.Fatalf("string form: %v", err)
	}
	if len(single) != 1 || single[0] != "https://cdn.test/a.jpg" {
		t.Errorf("string form decoded as %v", single)
	}

	var many stringList
	if err := many.UnmarshalJSON([]byte(`["https://cdn.test/a.jpg","https://cdn.test/b.jpg"]`)); err != nil {
		t.Fatalf("array form: %v", err)
	}
	if len(many) != 2 {
		t.Errorf("array form decoded as %v", many)
	}
}

func TestExtractListingFromJSONLD(t *testing.T) {
	videos := extractListingFromJSONLD(listingFixture, "https://91porn.plus")
	if len(videos) != 2 {
		t.Fatalf("extracted %d videos, want 2", len(videos))
	}

	first := videos[0]
	if first.ID != "nnNJssoYi" {
		t.Errorf("ID = %q, want nnNJssoYi", first.ID)
	}
	if first.Title != "睡前被肥臀骑到内射" {
		t.Errorf("Title = %q", first.Title)
	}
	if first.PageURL != "https://91porn.plus/video/nnNJssoYi" {
		t.Errorf("PageURL = %q", first.PageURL)
	}
	if first.ThumbnailURL != "https://tp.helloye.com/nnNJssoYi.jpg" {
		t.Errorf("ThumbnailURL = %q", first.ThumbnailURL)
	}
	if first.PublishDate != "2026-09-28" {
		t.Errorf("PublishDate = %q", first.PublishDate)
	}

	if second := videos[1]; second.ID != "aSz7deTBB" {
		t.Errorf("second ID = %q", second.ID)
	}
}

func TestScrapeListingFromHTMLUsesURLPageAndRebuildsNext(t *testing.T) {
	result, err := ScrapeListingFromHTML(listingFixture, "https://91porn.plus/videos?page=2&type=hot")
	if err != nil {
		t.Fatalf("ScrapeListingFromHTML: %v", err)
	}

	if result.CurrentPage != 2 {
		t.Errorf("CurrentPage = %d, want 2 read from the URL", result.CurrentPage)
	}
	// The client-rendered pager leaves nothing to parse, so an unknown total
	// must be reported as zero rather than as a number scraped from noise.
	if result.TotalPages != 0 {
		t.Errorf("TotalPages = %d, want 0 when the pager is not in the response", result.TotalPages)
	}
	// A short page means the end of the listing, so no next page is offered.
	if result.HasNextPage {
		t.Error("HasNextPage = true for a partial page")
	}
}

// A full page implies another one exists, because the pager is rendered on
// the client and leaves no next-page marker in the response.
func TestScrapeListingFromHTMLInfersNextPageFromFullPage(t *testing.T) {
	html := fullPageListingFixture(fullListingPageSize)

	result, err := ScrapeListingFromHTML(html, "https://91porn.plus/videos?page=2&type=hot")
	if err != nil {
		t.Fatalf("ScrapeListingFromHTML: %v", err)
	}

	if len(result.Videos) != fullListingPageSize {
		t.Fatalf("videos = %d, want %d", len(result.Videos), fullListingPageSize)
	}
	if !result.HasNextPage {
		t.Error("HasNextPage = false for a full page")
	}
	if result.NextPageURL != "https://91porn.plus/videos?page=3" {
		t.Errorf("NextPageURL = %q, want the next page without the accumulated query", result.NextPageURL)
	}
}

// fullPageListingFixture builds a listing page holding n entries.
func fullPageListingFixture(n int) string {
	var entries strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			entries.WriteString(",")
		}
		fmt.Fprintf(&entries,
			`{"@type":"ListItem","position":%d,"item":{"@type":"VideoObject","name":"v%d","url":"https://91porn.plus/video/id%03d","uploadDate":"2026-09-28T10:00:00.000Z","thumbnailUrl":"https://tp.helloye.com/id%03d.jpg"}}`,
			i+1, i, i, i)
	}
	return `<html><body><script type="application/ld+json">{"@context":"https://schema.org","@graph":[` +
		`{"@type":"ItemList","name":"list","itemListElement":[` + entries.String() + `]}]}</script></body></html>`
}

func TestPageFromURL(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"https://91porn.plus/videos?page=2&type=hot", 2},
		{"https://91porn.plus/videos", 1},
		{"https://91porn.plus/videos?page=", 1},
		{"https://91porn.plus/videos?page=abc", 1},
	}
	for _, tt := range tests {
		if got := pageFromURL(tt.in); got != tt.want {
			t.Errorf("pageFromURL(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

// TestRealPageFixture runs the pipeline against a captured production page.
func TestRealPageFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/91porn-plus/data/detail.html")
	if err != nil {
		t.Skip("no captured page available")
	}
	html := string(raw)
	t.Logf("fixture size: %d bytes", len(html))

	detail, err := ScrapeDetailFromHTML(html, "https://91porn.plus/video/2z4pCgT2c")
	if err != nil {
		t.Fatalf("ScrapeDetailFromHTML: %v", err)
	}

	t.Logf("m3u8      = %s", detail.M3U8URL)
	t.Logf("id        = %s", detail.ID)
	t.Logf("title     = %s", detail.Title)
	t.Logf("author    = %s", detail.Author)
	t.Logf("duration  = %s (%ds)", detail.Duration, detail.DurationSec)
	t.Logf("views     = %d", detail.Views)
	t.Logf("published = %s", detail.PublishDate)
	t.Logf("thumb     = %s", detail.ThumbnailURL)
	t.Logf("tags(%d)  = %v", len(detail.Tags), detail.Tags)

	if detail.M3U8URL == "" {
		t.Error("no M3U8 URL extracted from the real page")
	}
	if detail.Title == "" {
		t.Error("no title extracted from the real page")
	}
	if detail.DurationSec == 0 {
		t.Error("no duration extracted from the real page")
	}
}

func TestRealListingFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/91porn-plus/data/home.html")
	if err != nil {
		t.Skip("no captured listing available")
	}

	result, err := ScrapeListingFromHTML(string(raw), "https://91porn.plus/")
	if err != nil {
		t.Fatalf("ScrapeListingFromHTML: %v", err)
	}

	t.Logf("videos found: %d (page %d of %d, hasNext=%v)",
		len(result.Videos), result.CurrentPage, result.TotalPages, result.HasNextPage)
	for i, v := range result.Videos {
		if i >= 5 {
			break
		}
		t.Logf("  - %s | %s | %s | %s", v.ID, v.Title, v.PublishDate, v.PageURL)
	}

	if len(result.Videos) == 0 {
		t.Fatal("no videos extracted from the real listing page")
	}
}
