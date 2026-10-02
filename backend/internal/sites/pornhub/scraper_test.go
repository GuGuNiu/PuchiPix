package pornhub

import (
	"reflect"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

// detailFixture is a trimmed copy of a live PORNHUB detail page. The
// structure that matters: the player config is a flashvars_N JSON object
// whose mediaDefinitions carry the HLS renditions plus one get_media MP4
// endpoint, and the taxonomy is exposed through data-label attributes.
const detailFixture = `<!DOCTYPE html><html><head>
<meta name="twitter:title" content="Amateur Raw Interracial Sex Casting First Video for Cute 20 year old Latina">
<meta property="og:image" content="https://pix-cdn77.phncdn.com/c6371/videos/202608/24/60041855/original.jpg">
<script type="application/ld+json">
{
    "@context": "https://schema.org/",
    "@type": "VideoObject",
    "name": "Amateur Raw Interracial Sex Casting First Video for Cute 20 year old Latina",
    "duration": "PT00H17M39S",
    "uploadDate": "2026-08-24T15:52:36+00:00",
    "author": "Andres XXX Acosta",
    "interactionStatistic": [
        { "@type": "InteractionCounter", "interactionType": "https://schema.org/WatchAction", "userInteractionCount": 459294 },
        { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": 1037 }
    ]
}
</script>
<script>
var MODEL_PROFILE = {"username":"Andres XXX Acosta","modelProfileLink":"\/model\/andres-xxx-acosta"};
var flashvars_1234 = {"mediaDefinitions":[
 {"group":1,"height":1080,"width":1920,"defaultQuality":false,"format":"hls","videoUrl":"https:\/\/hv-h.phncdn.com\/hls\/c6251\/videos\/202608\/24\/60041855\/1080P_4000K_60041855.mp4\/master.m3u8?h=AAA%3D&e=1790595947&f=1","quality":"1080"},
 {"group":1,"height":720,"width":1280,"defaultQuality":true,"format":"hls","videoUrl":"https:\/\/hv-h.phncdn.com\/hls\/c6251\/videos\/202608\/24\/60041855\/720P_4000K_60041855.mp4\/master.m3u8?h=BBB%3D&e=1790595947&f=1","quality":"720"},
 {"group":1,"height":480,"width":854,"defaultQuality":false,"format":"hls","videoUrl":"https:\/\/hv-h.phncdn.com\/hls\/c6251\/videos\/202608\/24\/60041855\/480P_2000K_60041855.mp4\/master.m3u8?h=CCC%3D&e=1790595947&f=1","quality":"480"},
 {"group":1,"height":240,"width":426,"defaultQuality":false,"format":"hls","videoUrl":"https:\/\/hv-h.phncdn.com\/hls\/c6251\/videos\/202608\/24\/60041855\/240P_1000K_60041855.mp4\/master.m3u8?h=DDD%3D&e=1790595947&f=1","quality":"240"},
 {"group":1,"format":"mp4","videoUrl":"https:\/\/www.pornhub.com\/video\/get_media?s=eyJrIjoiZmQ3ODU4YSJ9&v=6a8c673a68504&e=0&t=p"}
],"video_title":"Amateur Raw Interracial Sex Casting First Video for Cute 20 year old Latina","video_duration":1059,"image_url":"https:\/\/pix-cdn77.phncdn.com\/c6371\/videos\/202608\/24\/60041855\/original.jpg","uploaderLink":"<a rel=\"\" href=\"\/model\/mobilepovbynicogrey\" title=\"MobilePOVbyNicoGrey\">MobilePOVbyNicoGrey<\/a>","channelTitle":null,"views":"1.6M","isVR":0};
</script>
</head><body>
<a data-event="video_underplayer" data-label="category" class="item" href="/categories/teen">18-25</a>
<a data-event="video_underplayer" data-label="category" class="item" href="/video?c=3">Amateur</a>
<a data-event="video_underplayer" data-label="category" class="item" href="/video?c=11">Brunette</a>
<a data-event="video_underplayer" data-label="category" class="item" href="/hd">HD Porn</a>
<a data-event="video_underplayer" data-label="tag" class="item isTag" href="/video/search?search=first+time">first time</a>
<a data-event="video_underplayer" data-label="tag" class="item isTag" href="/video/search?search=amateur+latina">amateur latina</a>
<a data-event="video_underplayer" data-label="tag" class="item isTag" href="/video/search?search=casting">casting</a>
</body></html>`

// listingFixture is a trimmed copy of a live /video listing page card set.
const listingFixture = `<html><body><ul>
<li class="videoBox" data-video-vkey="6a8c673a68504">
  <div class="thumb"><a href="/view_video.php?viewkey=6a8c673a68504"><img data-thumb_url="https://thumb1.jpg" alt="First"></a></div>
  <div class="marker-overlap"><var class="duration">17:39</var><span class="views"><var>1.6M</var></span></div>
  <span class="username"><a href="/model/x">MobilePOV</a></span>
</li>
<li class="videoBox" data-video-vkey="6aad2df8a1b75">
  <div class="thumb"><a href="/view_video.php?viewkey=6aad2df8a1b75"><img data-thumb_url="https://thumb2.jpg" alt="Second"></a></div>
  <div class="marker-overlap"><var class="duration">04:05</var><span class="views"><var>12.3k</var></span></div>
  <span class="username"><a href="/users/y">Someone</a></span>
</li>
</ul></body></html>`

func TestExtractViewKey(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"legacy view_video URL", "https://www.pornhub.com/view_video.php?viewkey=ph5f4a1b2c3d4e5", "ph5f4a1b2c3d4e5"},
		{"new watch URL", "https://www.pornhub.com/watch/ph5f4a1b2c3d4e5", "ph5f4a1b2c3d4e5"},
		{"URL with extra params", "https://www.pornhub.com/view_video.php?viewkey=ph612ab34cd56ef&t=comments", "ph612ab34cd56ef"},
		{"mirror host", "https://pornhubpremium.com/view_video.php?viewkey=ph5e4acdae54a82", "ph5e4acdae54a82"},
		{"listing page URL", "https://www.pornhub.com/video/search?search=test", ""},
		{"empty URL", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractViewKey(tt.url); got != tt.want {
				t.Errorf("ExtractViewKey(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestExtractMediaURLsFromFlashvars(t *testing.T) {
	result := &VideoDetailResult{}
	extractMediaURLs(detailFixture, result)

	// The site's default quality wins, not the highest one.
	if want := "https://hv-h.phncdn.com/hls/c6251/videos/202608/24/60041855/720P_4000K_60041855.mp4/master.m3u8?h=BBB%3D&e=1790595947&f=1"; result.M3U8URL != want {
		t.Errorf("M3U8URL = %q, want the default-quality rendition %q", result.M3U8URL, want)
	}

	if len(result.M3U8Candidates) != 4 {
		t.Fatalf("M3U8Candidates = %d, want 4", len(result.M3U8Candidates))
	}
	if got := result.M3U8Candidates[0].Title; got != "720p" {
		t.Errorf("first candidate title = %q, want %q", got, "720p")
	}

	// Escaped slashes must be decoded, otherwise the URL cannot be fetched.
	if got := result.M3U8Candidates[0].URL; got == "" || got[:5] != "https" {
		t.Errorf("candidate URL was not unescaped: %q", got)
	}

	// The mp4 rendition is an endpoint, not a file, so it must not be
	// mistaken for a direct link.
	if result.MP4URL != "" {
		t.Errorf("MP4URL = %q, want empty because the mp4 rendition is a get_media endpoint", result.MP4URL)
	}
	if result.GetMediaURL == "" {
		t.Error("GetMediaURL is empty, want the /video/get_media endpoint")
	}
}

func TestExtractMediaURLsPrefersHighestLegacyQuality(t *testing.T) {
	html := `<script>var flashvars_9 = {"quality_480p":"https:\/\/ev.phncdn.com\/videos\/a\/480.mp4?val=x",
	"quality_1080p":"https:\/\/ev.phncdn.com\/videos\/a\/1080.mp4?val=x"};</script>`

	result := &VideoDetailResult{}
	extractMediaURLs(html, result)

	if want := "https://ev.phncdn.com/videos/a/1080.mp4?val=x"; result.MP4URL != want {
		t.Errorf("MP4URL = %q, want %q", result.MP4URL, want)
	}
}

func TestExtractMediaURLsNoFlashvars(t *testing.T) {
	result := &VideoDetailResult{}
	extractMediaURLs(`<html><body>no player here</body></html>`, result)

	if result.M3U8URL != "" || result.MP4URL != "" || result.GetMediaURL != "" {
		t.Errorf("expected no sources, got m3u8=%q mp4=%q getMedia=%q",
			result.M3U8URL, result.MP4URL, result.GetMediaURL)
	}
}

func TestExtractTitle(t *testing.T) {
	got := extractTitle(detailFixture)
	want := "Amateur Raw Interracial Sex Casting First Video for Cute 20 year old Latina"
	if got != want {
		t.Errorf("extractTitle() = %q, want %q", got, want)
	}
}

// The JSON-LD interactionStatistic is an array on current pages; a typed
// struct field would abort the whole unmarshal and lose the title.
func TestParseJSONLDHandlesInteractionStatisticArray(t *testing.T) {
	obj := parseJSONLD(detailFixture)
	if obj == nil {
		t.Fatal("parseJSONLD returned nil")
	}
	if obj.Name == "" {
		t.Error("Name is empty; the interactionStatistic array broke the unmarshal")
	}
	if len(obj.InteractionStatistic) != 2 {
		t.Fatalf("InteractionStatistic len = %d, want 2", len(obj.InteractionStatistic))
	}
	if got := obj.InteractionStatistic[0].UserInteractionCount; got != 459294 {
		t.Errorf("first interaction count = %d, want 459294 (the WatchAction counter)", got)
	}
}

func TestExtractMetadataFromJSONLD(t *testing.T) {
	result := &VideoDetailResult{}
	extractMetadataFromJSONLD(detailFixture, result)

	if result.PublishDate != "2026-08-24" {
		t.Errorf("PublishDate = %q, want 2026-08-24", result.PublishDate)
	}
	if result.DurationSec != 17*60+39 {
		t.Errorf("DurationSec = %d, want %d", result.DurationSec, 17*60+39)
	}
	if result.Duration != "17:39" {
		t.Errorf("Duration = %q, want 17:39", result.Duration)
	}
	if result.Views != 459294 {
		t.Errorf("Views = %d, want 459294", result.Views)
	}
}

func TestExtractDurationFallsBackToFlashvars(t *testing.T) {
	html := `<script>var flashvars_1 = {"video_duration":1059};</script>`
	result := &VideoDetailResult{}
	extractMetadataFromJSONLD(html, result)

	if result.DurationSec != 1059 {
		t.Errorf("DurationSec = %d, want 1059", result.DurationSec)
	}
	if result.Duration != "17:39" {
		t.Errorf("Duration = %q, want 17:39", result.Duration)
	}
}

func TestExtractUploaderPrefersModelProfile(t *testing.T) {
	result := &VideoDetailResult{}
	extractModelProfile(detailFixture, result)
	if result.Uploader != "Andres XXX Acosta" {
		t.Errorf("MODEL_PROFILE username = %q, want %q", result.Uploader, "Andres XXX Acosta")
	}
	if result.UploaderURL != "/model/andres-xxx-acosta" {
		t.Errorf("UploaderURL = %q, want /model/andres-xxx-acosta", result.UploaderURL)
	}

	extractUploader(detailFixture, result)
	if result.Uploader != "Andres XXX Acosta" {
		t.Errorf("extractUploader() = %q, want the model profile name", result.Uploader)
	}
}

func TestExtractUploaderFallsBackToUploaderLinkAnchor(t *testing.T) {
	html := `<script>var flashvars_1 = {"uploaderLink":"<a rel=\"\" href=\"\/model\/nobody\">MobilePOVbyNicoGrey<\/a>"};</script>`
	if got := extractUploader(html, &VideoDetailResult{}); got != "MobilePOVbyNicoGrey" {
		t.Errorf("extractUploader() = %q, want MobilePOVbyNicoGrey", got)
	}
}

func TestExtractUploaderFallsBackToJSONLDAuthor(t *testing.T) {
	html := `<script type="application/ld+json">{"@type":"VideoObject","name":"T","author":"Channel Nine"}</script>`
	if got := extractUploader(html, &VideoDetailResult{}); got != "Channel Nine" {
		t.Errorf("extractUploader() = %q, want Channel Nine", got)
	}
}

func TestExtractUploaderEmpty(t *testing.T) {
	if got := extractUploader(`<html></html>`, &VideoDetailResult{}); got != "" {
		t.Errorf("extractUploader() = %q, want empty", got)
	}
}

func TestExtractTagsFromDataLabel(t *testing.T) {
	got := extractTags(detailFixture)
	want := []string{"first time", "amateur latina", "casting"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("extractTags() = %v, want %v", got, want)
	}
}

func TestExtractCategoriesFromDataLabel(t *testing.T) {
	got := extractCategories(detailFixture)
	want := []string{"18-25", "Amateur", "Brunette", "HD Porn"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("extractCategories() = %v, want %v", got, want)
	}
}

// Category chips and tag chips share the same container, so a tag-only
// selector must not pick up the categories and vice versa.
func TestLabelsDoNotBleedIntoEachOther(t *testing.T) {
	doc := detailFixture
	if got := extractTags(doc); contains(got, "Amateur") {
		t.Errorf("extractTags() leaked a category: %v", got)
	}
	if got := extractCategories(doc); contains(got, "casting") {
		t.Errorf("extractCategories() leaked a tag: %v", got)
	}
}

func TestExtractLabelsEmpty(t *testing.T) {
	if got := extractTags(`<html></html>`); got != nil {
		t.Errorf("extractTags() = %v, want nil", got)
	}
	if got := extractCategories(`<html></html>`); got != nil {
		t.Errorf("extractCategories() = %v, want nil", got)
	}
}

func TestExtractCast(t *testing.T) {
	html := `<a data-label="pornstar" href="/pornstar/x">Jenna</a>` +
		`<a data-label="pornstar" href="/pornstar/y">Mia</a>`
	got := extractCast(html)
	want := []string{"Jenna", "Mia"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("extractCast() = %v, want %v", got, want)
	}
}

func TestResolvePublishDateFallsBackToMediaPath(t *testing.T) {
	result := &VideoDetailResult{
		M3U8URL: "https://hv-h.phncdn.com/hls/c6251/videos/202608/24/60041855/1080P.mp4/master.m3u8",
	}
	if got := resolvePublishDate(result); got != "2026-08-24" {
		t.Errorf("resolvePublishDate() = %q, want 2026-08-24", got)
	}

	result.PublishDate = "2020-01-01"
	if got := resolvePublishDate(result); got != "2020-01-01" {
		t.Errorf("resolvePublishDate() = %q, want the already-set 2020-01-01", got)
	}
}

func TestToScrapeResult(t *testing.T) {
	result := &VideoDetailResult{}
	extractMediaURLs(detailFixture, result)
	extractMetadataFromJSONLD(detailFixture, result)
	extractModelProfile(detailFixture, result)
	extractUploader(detailFixture, result)
	result.Tags = extractTags(detailFixture)
	result.Categories = extractCategories(detailFixture)

	out := result.ToScrapeResult("https://www.pornhub.com/view_video.php?viewkey=6a8c673a68504")

	if out.M3U8URL != result.M3U8URL {
		t.Errorf("M3U8URL = %q, want %q", out.M3U8URL, result.M3U8URL)
	}
	if len(out.Categories) != 4 {
		t.Errorf("Categories = %v, want the 4 category chips", out.Categories)
	}
	if len(out.M3U8Candidates) != 3 {
		t.Errorf("M3U8Candidates = %d, want 3 (the primary is excluded)", len(out.M3U8Candidates))
	}
}

// An empty uploader must not become a one-element slice holding "", which
// downstream normalization would treat as an actor named nothing.
func TestToScrapeResultOmitsEmptyActors(t *testing.T) {
	out := (&VideoDetailResult{}).ToScrapeResult("https://www.pornhub.com/view_video.php?viewkey=x")
	if out.Actors != nil {
		t.Errorf("Actors = %v, want nil when no performer and no uploader is known", out.Actors)
	}
}

func TestToScrapeResultFallsBackToUploaderAsActor(t *testing.T) {
	out := (&VideoDetailResult{VideoMetadata: VideoMetadata{Uploader: "SomeChannel"}}).
		ToScrapeResult("https://www.pornhub.com/view_video.php?viewkey=x")
	if !reflect.DeepEqual(out.Actors, []string{"SomeChannel"}) {
		t.Errorf("Actors = %v, want [SomeChannel]", out.Actors)
	}
}

func TestToScrapeResultPrefersCastOverUploader(t *testing.T) {
	out := (&VideoDetailResult{VideoMetadata: VideoMetadata{
		Uploader: "SomeChannel",
		Cast:     []string{"Jenna"},
	}}).ToScrapeResult("https://www.pornhub.com/view_video.php?viewkey=x")
	if !reflect.DeepEqual(out.Actors, []string{"Jenna"}) {
		t.Errorf("Actors = %v, want [Jenna]; the uploader channel is not a performer", out.Actors)
	}
}

func TestExtractVideosFromListing(t *testing.T) {
	videos := extractVideosFromDocument(mustParse(t, listingFixture), "https://www.pornhub.com")
	if len(videos) != 2 {
		t.Fatalf("extracted %d videos, want 2", len(videos))
	}

	first := videos[0]
	if first.ViewKey != "6a8c673a68504" {
		t.Errorf("ViewKey = %q, want 6a8c673a68504", first.ViewKey)
	}
	if first.PageURL != "https://www.pornhub.com/view_video.php?viewkey=6a8c673a68504" {
		t.Errorf("PageURL = %q", first.PageURL)
	}
	if first.ThumbnailURL != "https://thumb1.jpg" {
		t.Errorf("ThumbnailURL = %q, want https://thumb1.jpg", first.ThumbnailURL)
	}
	if first.DurationSec != 17*60+39 {
		t.Errorf("DurationSec = %d, want %d", first.DurationSec, 17*60+39)
	}
	if first.Views != 16 {
		t.Errorf("Views = %d, want 16 (1.6M)", first.Views)
	}
	if first.Uploader != "MobilePOV" {
		t.Errorf("Uploader = %q, want MobilePOV", first.Uploader)
	}
}

func TestExtractVideosDeduplicates(t *testing.T) {
	// Both selectors match the same cards; the result must not double up.
	videos := extractVideosFromDocument(mustParse(t, listingFixture), "https://www.pornhub.com")
	seen := make(map[string]bool)
	for _, v := range videos {
		if seen[v.ViewKey] {
			t.Errorf("duplicate viewkey %q", v.ViewKey)
		}
		seen[v.ViewKey] = true
	}
}

func TestIsAntiBotPage(t *testing.T) {
	tests := []struct {
		name string
		html string
		want bool
	}{
		{"clean page", detailFixture, false},
		{"RNKEY interstitial", `<script>document.cookie = 'RNKEY=abc';</script>`, true},
		{"body onload go", `<body onload="go()">`, true},
		{"forced reload", `<script>document.location.reload(true)</script>`, true},
		{"benign reload", `<script>location.reload();addClogCookie()</script>`, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsAntiBotPage(tt.html); got != tt.want {
				t.Errorf("IsAntiBotPage() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAgeGateCookiesPresent(t *testing.T) {
	// Every cookie the age disclaimer sets must be present, otherwise the
	// interstitial is served and no stream exists on the page.
	for _, c := range []string{"age_verified=1", "accessAgeDisclaimerPH=1", "accessAgeDisclaimerUK=1", "accessPH=1", "platform=pc"} {
		if !containsSubstring(AgeGateCookies, c) {
			t.Errorf("AgeGateCookies is missing %q; the disclaimer interstitial would be served", c)
		}
	}
}

func TestPickBestQuality(t *testing.T) {
	links := map[string]string{"240p": "a", "1080p": "b", "480p": "c"}
	if got := pickBestQuality(links); got != "b" {
		t.Errorf("pickBestQuality() = %q, want the 1080p entry", got)
	}
	if got := pickBestQuality(nil); got != "" {
		t.Errorf("pickBestQuality(nil) = %q, want empty", got)
	}
}

func TestParseISODuration(t *testing.T) {
	tests := []struct {
		iso      string
		wantText string
		wantSec  int
	}{
		{"PT00H17M39S", "17:39", 1059},
		{"PT11M30S", "11:30", 690},
		{"PT01H00M00S", "01:00:00", 3600},
		{"garbage", "garbage", 0},
	}
	for _, tt := range tests {
		t.Run(tt.iso, func(t *testing.T) {
			text, sec := parseISODuration(tt.iso)
			if text != tt.wantText || sec != tt.wantSec {
				t.Errorf("parseISODuration(%q) = (%q, %d), want (%q, %d)", tt.iso, text, sec, tt.wantText, tt.wantSec)
			}
		})
	}
}

func TestExtractViews(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"1.6M", 16},
		{"1,898", 1898},
		{"307.8k", 3078},
		{"", 0},
	}
	for _, tt := range tests {
		if got := ExtractViews(tt.in); got != tt.want {
			t.Errorf("ExtractViews(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func containsSubstring(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}

// mustParse parses an HTML fixture or fails the test.
func mustParse(t *testing.T, html string) *goquery.Document {
	t.Helper()
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return doc
}
