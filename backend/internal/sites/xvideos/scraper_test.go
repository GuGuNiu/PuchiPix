package xvideos

import (
	"reflect"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

// detailFixture is a trimmed copy of a live XVIDEOS detail page. The parts
// that matter: the categories and keyword tags live in the HTML5Player
// configuration object, the credited pornstars in the label list, and the
// stream URLs in the html5player setter calls.
const detailFixture = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Yuuka Kaede's Intense Japanese Blowjob and Toy Play">
<meta property="og:image" content="https://thumb-cdn77.xvideos-cdn.com/275a2580/xv_15_t.jpg">
<meta property="og:duration" content="454">
</head><body>
<h2 class="page-title">Yuuka Kaede's Intense Japanese Blowjob and Toy Play
<span class="duration">7 min</span><span class="video-hd-mark">720p</span></h2>
<div class="video-metadata video-tags-list ordered-label-list cropped"><ul>
<li class="main-uploader"><a href="/avtits" class="btn label main uploader-tag"><span class="name">AV Tits</span></a></li>
<li class="model"><a href="/models/daijo-model" class="btn label profile is-pornstar" data-id="842618617"><span class="model-star-sub icon-f icf-star-o"></span><span class="name">Daijo</span></a></li>
<li class="model"><a href="/models/hiroshi-owada" class="btn label profile is-pornstar" data-id="798786811"><span class="name">Hiroshi Owada</span></a></li>
<li class="model"><a href="/models/yuuka-kaede" class="btn label profile is-pornstar" data-id="798786812"><span class="name">Yuuka Kaede</span></a></li>
<li class="view-more-li"><a href="#">More</a></li>
</ul></div>
<div id="v-actions-container"><div id="v-actions"><div id="v-views"><span class="icon-f icf-eye"></span><strong class="mobile-hide">1,898</strong><strong class="mobile-show-inline">2k</strong></div></div></div>
<script>
var xv_video_data = {"uploadDate":"2026-09-27T10:39:19+00:00"};
var html5player = new HTML5Player('html5video', '92089939', {"categories":"asian_woman,japanese,blowjob","keywords":"av tits,av,tits,avtits,daijo,hiroshi owada,yuuka kaede,blowjob,asian","tracker":"","is_channel":1});
html5player.setVideoTitle('Yuuka Kaede&#039;s Intense Japanese Blowjob and Toy Play');
html5player.setEncodedIdVideo('omdieok464f');
html5player.setUploaderName('avtits');
html5player.setIdCDN('21');
html5player.setVideoUrlLow('https://mp4-cdn77.xvideos-cdn.com/275a2580/6/mp4_sd.mp4?secure=TOK,1790604011');
html5player.setVideoUrlHigh('https://mp4-cdn77.xvideos-cdn.com/275a2580/6/mp4_sd.mp4?secure=TOK,1790604011');
html5player.setVideoHLS('https://hls-cdn77.xvideos-cdn.com/TOK,1790604011/275a2580-af72-45fb-bf6d-cd5b00f82835/6/hls.m3u8');
html5player.setThumbUrl('https://thumb-cdn77.xvideos-cdn.com/275a2580/xv_15_t.jpg');
</script>
</body></html>`

// listingFixture is a trimmed copy of a live XVIDEOS listing page. Cards
// carry data-id/data-eid and render the duration as "7 min", not a clock.
const listingFixture = `<html><body>
<div id="video_omdieok464f" data-id="92089939" data-eid="omdieok464f" data-idcdn="21" class="frame-block thumb-block">
 <div class="thumb-inside"><div class="thumb"><a href="/video.omdieok464f/56013400/0/yuuka_kaede_s_intense_japanese_blowjob">
  <img data-src="https://thumb1.jpg"></a></div></div>
 <div class="thumb-under"><p class="title"><a href="/video.omdieok464f/56013400/0/yuuka_kaede_s_intense_japanese_blowjob" title="Yuuka Kaede Intense">Yuuka Kaede Intense<span class="duration">7 min</span></a></p>
 <p class="metadata"><span class="bg"><span class="duration">7 min</span><span><a href="/avtits"><span class="name">AV Tits</span></a><span> 2.1k <span>Views</span></span></span></span></p></div>
</div>
<div id="video_omcbbiu7702" data-id="92060452" data-eid="omcbbiu7702" data-idcdn="23" class="frame-block thumb-block">
 <div class="thumb-inside"><div class="thumb"><a href="/video.omcbbiu7702/56013400/0/ginger_milf">
  <img data-src="https://thumb2.jpg"></a></div></div>
 <div class="thumb-under"><p class="title"><a href="/video.omcbbiu7702/56013400/0/ginger_milf" title="Ginger Milf">Ginger Milf<span class="duration">1 h 13 min</span></a></p>
 <p class="metadata"><span class="bg"><span class="duration">1 h 13 min</span><span><a href="/kabysnow"><span class="name">Kabysnow</span></a></span></span></p></div>
</div>
</body></html>`

func TestExtractEncodedID(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"dotted form", "https://www.xvideos.com/video.omdieok464f/slug", "omdieok464f"},
		{"dotted form with path segments", "https://www.xvideos.com/video.omdieok464f/56013400/0/slug", "omdieok464f"},
		// The numeric form is still served; the old regex missed it entirely.
		{"numeric form", "https://www.xvideos.com/video65982001/what_s_her_name", "65982001"},
		{"embed form", "https://www.xvideos.com/embedframe/omdieok464f", "omdieok464f"},
		{"mirror domain", "https://www.xvideos.es/video.ucuvbkfda4e/slug", "ucuvbkfda4e"},
		{"language subdomain", "https://de.xvideos.com/video4588838/slug", "4588838"},
		{"listing page", "https://www.xvideos.com/best/week/1", ""},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractEncodedID(tt.url); got != tt.want {
				t.Errorf("ExtractEncodedID(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestParsePlayerConfig(t *testing.T) {
	cfg := parsePlayerConfig(detailFixture)
	if cfg == nil {
		t.Fatal("parsePlayerConfig returned nil; the taxonomy would be lost")
	}
	if want := "asian_woman,japanese,blowjob"; cfg.Categories != want {
		t.Errorf("Categories = %q, want %q", cfg.Categories, want)
	}
	if !strings.Contains(cfg.Keywords, "yuuka kaede") {
		t.Errorf("Keywords = %q, want it to contain the tag list", cfg.Keywords)
	}
}

func TestSplitCSVFields(t *testing.T) {
	got := splitCSVFields("asian_woman, japanese ,blowjob,,asian_woman")
	want := []string{"asian_woman", "japanese", "blowjob"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("splitCSVFields() = %v, want %v", got, want)
	}
	if got := splitCSVFields("   "); got != nil {
		t.Errorf("splitCSVFields(blank) = %v, want nil", got)
	}
}

func TestExtractPlayerMetadataCategoriesAndTags(t *testing.T) {
	result := &VideoDetailResult{}
	extractPlayerMetadata(detailFixture, result)

	wantCats := []string{"asian_woman", "japanese", "blowjob"}
	if !reflect.DeepEqual(result.Categories, wantCats) {
		t.Errorf("Categories = %v, want %v", result.Categories, wantCats)
	}

	if len(result.Tags) == 0 {
		t.Fatal("Tags is empty; the player config keyword list was not read")
	}
	if result.Tags[0] != "av tits" {
		t.Errorf("Tags[0] = %q, want %q", result.Tags[0], "av tits")
	}
}

func TestExtractPornstars(t *testing.T) {
	got := extractPornstars(detailFixture)
	want := []string{"Daijo", "Hiroshi Owada", "Yuuka Kaede"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("extractPornstars() = %v, want %v (the uploader and view-more items excluded)", got, want)
	}
}

func TestExtractPornstarsEmpty(t *testing.T) {
	if got := extractPornstars(`<html><div class="video-tags-list"><ul><li class="main-uploader"><span class="name">Chan</span></li></ul></div></html>`); got != nil {
		t.Errorf("extractPornstars() = %v, want nil when nothing is flagged as a pornstar", got)
	}
}

func TestExtractMetadataFromJSONLD(t *testing.T) {
	result := &VideoDetailResult{}
	extractMetadataFromJSONLD(detailFixture, result)

	// og:duration is published in whole seconds and must survive the
	// missing JSON-LD block.
	if result.DurationSec != 454 {
		t.Errorf("DurationSec = %d, want 454", result.DurationSec)
	}
	if result.Duration != "07:34" {
		t.Errorf("Duration = %q, want 07:34", result.Duration)
	}
	if result.PublishDate != "2026-09-27" {
		t.Errorf("PublishDate = %q, want 2026-09-27", result.PublishDate)
	}
	if result.Views != 1898 {
		t.Errorf("Views = %d, want 1898", result.Views)
	}
}

func TestExtractTitle(t *testing.T) {
	got := extractTitle(detailFixture, "")
	want := "Yuuka Kaede's Intense Japanese Blowjob and Toy Play"
	if got != want {
		t.Errorf("extractTitle() = %q, want %q", got, want)
	}
}

// The page heading carries the duration and resolution spans alongside the
// title; they must not leak into it.
func TestExtractTitleFromPageHeadingDropsSpans(t *testing.T) {
	html := `<h2 class="page-title">Some Title <span class="duration">7 min</span><span class="video-hd-mark">720p</span></h2>`
	if got := extractTitle(html, ""); got != "Some Title" {
		t.Errorf("extractTitle() = %q, want %q", got, "Some Title")
	}
}

func TestExtractStreamURLs(t *testing.T) {
	result := &VideoDetailResult{}
	extractMetadataFromJSONLD(detailFixture, result)

	hls := `https://hls-cdn77.xvideos-cdn.com/TOK,1790604011/275a2580-af72-45fb-bf6d-cd5b00f82835/6/hls.m3u8`
	if m := HLSURLPattern.FindStringSubmatch(detailFixture); len(m) < 2 || m[1] != hls {
		t.Errorf("HLS regex matched %v, want %q", m, hls)
	}
	if m := MP4URLPattern.FindStringSubmatch(detailFixture); len(m) < 2 || !strings.HasSuffix(m[1], "mp4_sd.mp4?secure=TOK,1790604011") {
		t.Errorf("MP4 regex matched %v", m)
	}
	if m := VideoUUIDPattern.FindStringSubmatch(hls); len(m) < 2 || m[1] != "275a2580-af72-45fb-bf6d-cd5b00f82835" {
		t.Errorf("UUID regex matched %v", m)
	}
}

func TestLegacyFLVURL(t *testing.T) {
	html := `<script>var cfg = "flv_url=https%3A%2F%2Fcdn.xvideos.com%2Fx.flv&quality=1";</script>`
	if m := LegacyFLVURLPattern.FindStringSubmatch(html); len(m) < 2 || m[1] != "https%3A%2F%2Fcdn.xvideos.com%2Fx.flv" {
		t.Errorf("LegacyFLVURLPattern matched %v", m)
	}
}

func TestInlineErrorDetection(t *testing.T) {
	html := `<html><body><h1 class="inlineError">This video has been removed</h1></body></html>`
	m := InlineErrorPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		t.Fatal("InlineErrorPattern did not match; a removed video would surface as 'no video source found'")
	}
	if strings.TrimSpace(m[1]) != "This video has been removed" {
		t.Errorf("error text = %q", m[1])
	}
	if InlineErrorPattern.MatchString(detailFixture) {
		t.Error("InlineErrorPattern matched a healthy page")
	}
}

func TestToScrapeResult(t *testing.T) {
	result := &VideoDetailResult{}
	extractPlayerMetadata(detailFixture, result)

	out := result.ToScrapeResult("https://www.xvideos.com/video.omdieok464f/slug")

	if len(out.Categories) != 3 {
		t.Errorf("Categories = %v, want the 3 player-config categories", out.Categories)
	}
	want := []string{"Daijo", "Hiroshi Owada", "Yuuka Kaede"}
	if !reflect.DeepEqual(out.Actors, want) {
		t.Errorf("Actors = %v, want %v", out.Actors, want)
	}
}

// An empty uploader must not become a one-element slice holding "".
func TestToScrapeResultOmitsEmptyActors(t *testing.T) {
	out := (&VideoDetailResult{}).ToScrapeResult("https://www.xvideos.com/video.abc/slug")
	if out.Actors != nil {
		t.Errorf("Actors = %v, want nil when neither a pornstar nor an uploader is known", out.Actors)
	}
}

func TestToScrapeResultFallsBackToUploaderAsActor(t *testing.T) {
	out := (&VideoDetailResult{VideoMetadata: VideoMetadata{Uploader: "avtits"}}).
		ToScrapeResult("https://www.xvideos.com/video.abc/slug")
	if !reflect.DeepEqual(out.Actors, []string{"avtits"}) {
		t.Errorf("Actors = %v, want [avtits]", out.Actors)
	}
}

func TestParseCardDuration(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		// Current cards use a natural-language label, not a clock value.
		{"7 min", 420},
		{"1 h 13 min", 4380},
		{"1 min", 60},
		{"2 h", 7200},
		// The older template used a clock value.
		{"11:30", 690},
		{"01:02:03", 3723},
		{"", 0},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := parseCardDuration(tt.in); got != tt.want {
				t.Errorf("parseCardDuration(%q) = %d, want %d", tt.in, got, tt.want)
			}
		})
	}
}

func TestExtractVideosFromListing(t *testing.T) {
	videos := extractVideosFromDocument(mustParse(t, listingFixture), "https://www.xvideos.com")
	if len(videos) != 2 {
		t.Fatalf("extracted %d videos, want 2", len(videos))
	}

	first := videos[0]
	if first.EncodedID != "omdieok464f" {
		t.Errorf("EncodedID = %q, want omdieok464f", first.EncodedID)
	}
	if first.VideoID != "92089939" {
		t.Errorf("VideoID = %q, want 92089939", first.VideoID)
	}
	if first.CDNID != "21" {
		t.Errorf("CDNID = %q, want 21", first.CDNID)
	}
	if first.ThumbnailURL != "https://thumb1.jpg" {
		t.Errorf("ThumbnailURL = %q", first.ThumbnailURL)
	}
	if first.DurationSec != 420 {
		t.Errorf("DurationSec = %d, want 420 for the \"7 min\" label", first.DurationSec)
	}
	if first.Title != "Yuuka Kaede Intense" {
		t.Errorf("Title = %q, want %q", first.Title, "Yuuka Kaede Intense")
	}
	if first.Uploader != "AV Tits" {
		t.Errorf("Uploader = %q, want AV Tits", first.Uploader)
	}

	if second := videos[1]; second.DurationSec != 4380 {
		t.Errorf("second DurationSec = %d, want 4380 for the \"1 h 13 min\" label", second.DurationSec)
	}
}

func TestExtractViews(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"1,898", 1898},
		{"2.1k", 21},
		{"307.8k", 3078},
		{"1.6M", 16},
		{"", 0},
	}
	for _, tt := range tests {
		if got := ExtractViews(tt.in); got != tt.want {
			t.Errorf("ExtractViews(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestParseISODuration(t *testing.T) {
	tests := []struct {
		iso      string
		wantText string
		wantSec  int
	}{
		{"PT00H11M44S", "11:44", 704},
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

func mustParse(t *testing.T, html string) *goquery.Document {
	t.Helper()
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return doc
}
