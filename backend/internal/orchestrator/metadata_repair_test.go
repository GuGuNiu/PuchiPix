package orchestrator

import (
	"reflect"
	"testing"

	"backend/internal/sites"
)

func TestNormalizeGalleryMetadataRemovesRecognizedAliases(t *testing.T) {
	result := &sites.GalleryScrapeResult{
		Title:       "Aya Nanjo - 原神 刻晴 写真",
		Protagonist: "站点作者",
		Tags:        []string{"Aya Nanjo", "COS", "刻晴", "剧情"},
	}
	normalizeGalleryMetadata(result, newGalleryMetadataTestParser())
	if want := []string{"COS", "剧情"}; !reflect.DeepEqual(result.Tags, want) {
		t.Fatalf("tags = %#v, want %#v", result.Tags, want)
	}
}
