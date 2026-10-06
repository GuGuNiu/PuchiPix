package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"backend/internal/downloader/video"
	"backend/internal/sites"
	"backend/internal/sites/universal"
	"backend/internal/titleparser"
)

func TestNormalizeVideoMetadataRecognizesAndCleansActors(t *testing.T) {
	parser := titleparser.New()
	parser.LoadModels([]titleparser.ModelEntry{{
		Name:    "南条彩",
		Pinyin:  "nanami aya",
		Aliases: []string{"Aya Nanjo"},
	}})
	result := &sites.ScrapeResult{
		Title:  "Ａｙａ　Ｎａｎｊｏ 写真",
		Tags:   []string{"Aya Nanjo", "Aya Nanjo 写真", " ＣＯＳ，cos ", "剧情", "unknown"},
		Actors: []string{"演员： Aya Nanjo", "Aya Nanjo"},
	}

	normalizeVideoMetadata(result, parser)

	if result.Title != "Aya Nanjo 写真" {
		t.Fatalf("title = %q", result.Title)
	}
	if want := []string{"COS", "剧情"}; !reflect.DeepEqual(result.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", result.Tags, want)
	}
	if want := []string{"南条彩"}; !reflect.DeepEqual(result.Actors, want) {
		t.Fatalf("actors = %#v, want %#v", result.Actors, want)
	}
}

func TestMergeVideoMetadataPreservesValidData(t *testing.T) {
	parser := titleparser.New()
	parser.LoadModels([]titleparser.ModelEntry{{
		Name:    "南条彩",
		Pinyin:  "nanami aya",
		Aliases: []string{"Aya Nanjo"},
	}})
	task := video.DownloadTaskInput{
		Title:  "有效标题",
		Tags:   []string{"剧情", "COS"},
		Actors: []string{"Aya Nanjo"},
	}
	scraped := &sites.ScrapeResult{
		Title:  "Attention Required! | Cloudflare",
		Tags:   []string{"cos", "多人", "Aya Nanjo"},
		Actors: []string{"Aya Nanjo", "Alice"},
	}

	mergeVideoMetadata(&task, scraped, parser)

	if task.Title != "有效标题" {
		t.Fatalf("title = %q, want valid title", task.Title)
	}
	if want := []string{"剧情", "COS", "多人"}; !reflect.DeepEqual(task.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", task.Tags, want)
	}
	if want := []string{"南条彩", "Alice"}; !reflect.DeepEqual(task.Actors, want) {
		t.Fatalf("actors = %#v, want %#v", task.Actors, want)
	}
}

func TestCleanTitleRejectsWAFPages(t *testing.T) {
	if got := universal.CleanTitle("Attention Required! | Cloudflare"); got != "" {
		t.Fatalf("Cloudflare title = %q", got)
	}
	if got := universal.CleanTitle("在线播放 - 正常标题 - KanAV-免费高清中文AV在线看"); got != "正常标题" {
		t.Fatalf("clean title = %q", got)
	}
}

func TestHTTPScrapeExtractsGenericTagsAndActors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		if request.URL.Path == "/tags-only" {
			_, _ = response.Write([]byte(`<html><head><title>标签页</title></head><body><div class="tag-list"><a>剧情</a><a>多人</a></div></body></html>`))
			return
		}
		_, _ = response.Write([]byte(`<!doctype html>
<html><head><title>在线播放 - Aya Nanjo 写真 - KanAV-免费高清中文AV在线看</title></head>
<body><div class="tags"><a>剧情</a><a>Aya Nanjo</a></div><div class="actors"><a>Aya Nanjo</a></div>
<script>var player_aaaa = {"url":"https://cdn.example.com/video/index.m3u8"};</script></body></html>`))
	}))
	defer server.Close()

	result, err := universal.ScrapePageHTTP(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("scrape page: %v", err)
	}
	parser := titleparser.New()
	parser.LoadModels([]titleparser.ModelEntry{{
		Name:    "南条彩",
		Pinyin:  "nanami aya",
		Aliases: []string{"Aya Nanjo"},
	}})
	normalizeVideoMetadata(result, parser)

	if result.M3U8URL != "https://cdn.example.com/video/index.m3u8" {
		t.Fatalf("m3u8 = %q", result.M3U8URL)
	}
	if want := []string{"剧情"}; !reflect.DeepEqual(result.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", result.Tags, want)
	}
	if want := []string{"南条彩"}; !reflect.DeepEqual(result.Actors, want) {
		t.Fatalf("actors = %#v, want %#v", result.Actors, want)
	}

	quick, err := universal.QuickMetadataScrape(context.Background(), server.URL+"/tags-only")
	if err != nil {
		t.Fatalf("quick metadata scrape: %v", err)
	}
	if quick.Protagonist != "" {
		t.Fatalf("tags must not be classified as actors: %q", quick.Protagonist)
	}
}
