package orchestrator

import (
	"reflect"
	"testing"

	"backend/internal/sites"
	"backend/internal/titleparser"
)

func newGalleryMetadataTestParser() *titleparser.Parser {
	parser := titleparser.New()
	parser.LoadModels([]titleparser.ModelEntry{{
		Name:    "南条彩",
		Pinyin:  "nanami aya",
		Aliases: []string{"Aya Nanjo"},
	}})
	parser.LoadGameCharacters([]titleparser.GameCharEntry{{
		Name:     "刻晴",
		Pinyin:   "ke qing",
		Aliases:  []string{"Keqing"},
		GameName: "原神",
	}})
	return parser
}

func TestNormalizeGalleryMetadataUsesKnownRecognition(t *testing.T) {
	result := &sites.GalleryScrapeResult{
		Title:       "Aya Nanjo - 原神 刻晴 写真",
		Protagonist: "站点作者",
		Tags:        []string{"Aya Nanjo", "Aya Nanjo - 原神 刻晴 写真", "COS", "刻晴", "剧情"},
	}
	actors, gameCharacters := normalizeGalleryMetadata(result, newGalleryMetadataTestParser())

	if result.Protagonist != "南条彩" {
		t.Fatalf("protagonist = %q", result.Protagonist)
	}
	if want := []string{"南条彩"}; !reflect.DeepEqual(actors, want) {
		t.Fatalf("actors = %#v, want %#v", actors, want)
	}
	if want := []string{"刻晴"}; !reflect.DeepEqual(gameCharacters, want) {
		t.Fatalf("game characters = %#v, want %#v", gameCharacters, want)
	}
	if want := []string{"COS", "剧情"}; !reflect.DeepEqual(result.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", result.Tags, want)
	}
}

func TestNormalizeGalleryMetadataKeepsProviderActorWhenTitleUnknown(t *testing.T) {
	result := &sites.GalleryScrapeResult{
		Title:       "美女合集 日常",
		Protagonist: "站点模特",
		Tags:        []string{"站点模特", "写真"},
	}
	actors, gameCharacters := normalizeGalleryMetadata(result, newGalleryMetadataTestParser())

	if result.Protagonist != "站点模特" {
		t.Fatalf("protagonist = %q", result.Protagonist)
	}
	if want := []string{"站点模特"}; !reflect.DeepEqual(actors, want) {
		t.Fatalf("actors = %#v, want %#v", actors, want)
	}
	if len(gameCharacters) != 0 {
		t.Fatalf("game characters = %#v", gameCharacters)
	}
	if want := []string{"写真"}; !reflect.DeepEqual(result.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", result.Tags, want)
	}
}

func TestMarshalMetadataListUsesJSONArray(t *testing.T) {
	if got := marshalMetadataList(nil); got != "[]" {
		t.Fatalf("marshalMetadataList(nil) = %q", got)
	}
	if got := marshalMetadataList([]string{"红色", "兔女郎"}); got != `["红色","兔女郎"]` {
		t.Fatalf("marshalMetadataList() = %q", got)
	}
}

func TestVideoStrategyEscalatesAfterHTTPFailures(t *testing.T) {
	selector := NewStrategySelector()
	if got := selector.Select(SelectStrategyInput{SiteID: "kanav", TaskType: TaskTypeVideo}); got != StrategyAuto {
		t.Fatalf("initial video strategy = %q", got)
	}
	if got := selector.Select(SelectStrategyInput{SiteID: "kanav", TaskType: TaskTypeVideo, HasWaf: true}); got != StrategyChromedp {
		t.Fatalf("WAF video strategy = %q", got)
	}
	if got := selector.Select(SelectStrategyInput{SiteID: "kanav", TaskType: TaskTypeVideo, HTTPRetryCount: 2}); got != StrategyChromedp {
		t.Fatalf("retried video strategy = %q", got)
	}
}
