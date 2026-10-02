package titleparser

import (
	"reflect"
	"testing"
)

func newMetadataTestParser() *Parser {
	parser := New()
	parser.LoadModels([]ModelEntry{{
		Name:    "南条彩",
		Pinyin:  "nanami aya",
		Aliases: []string{"Aya Nanjo"},
	}})
	parser.LoadGameCharacters([]GameCharEntry{{
		Name:     "刻晴",
		Pinyin:   "ke qing",
		Aliases:  []string{"Keqing"},
		GameName: "原神",
	}})
	return parser
}

func TestNormalizeActorsCanonicalizesAliases(t *testing.T) {
	parser := newMetadataTestParser()
	got := parser.NormalizeActors([]string{" Ａｙａ　Ｎａｎｊｏ ", "Keqing"}, "")
	if want := []string{"南条彩", "刻晴"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeActors() = %#v, want %#v", got, want)
	}
}

func TestRecognizeModelsMarksOnlyKnownMatches(t *testing.T) {
	parser := newMetadataTestParser()
	known := parser.Parse("Aya Nanjo - 2026")
	if !known.KnownMatch || !reflect.DeepEqual(known.RecognizedModels, []string{"南条彩"}) {
		t.Fatalf("known parse = %+v", known)
	}

	unknown := parser.Parse("美女合集 日常")
	if unknown.KnownMatch {
		t.Fatalf("unknown title must not be marked as a known model: %+v", unknown)
	}

	partial := parser.Parse("Aya Nanjo & Unknown")
	if !partial.KnownMatch || !reflect.DeepEqual(partial.RecognizedModels, []string{"南条彩"}) {
		t.Fatalf("partial known parse = %+v", partial)
	}
}

func TestRecognizeModelsReturnsCopy(t *testing.T) {
	parser := newMetadataTestParser()
	models := parser.RecognizeModels("Aya Nanjo 写真")
	models[0] = "changed"
	if got := parser.RecognizeModels("Aya Nanjo 写真"); !reflect.DeepEqual(got, []string{"南条彩"}) {
		t.Fatalf("RecognizeModels() leaked internal state: %#v", got)
	}
}
