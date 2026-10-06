package titleparser

import (
	"reflect"
	"testing"
)

func TestRemoveActorsFromTagsRemovesAliases(t *testing.T) {
	parser := newMetadataTestParser()
	got := parser.RemoveActorsFromTags([]string{"Aya Nanjo", "COS", "刻晴", "剧情"}, []string{"南条彩", "刻晴"})
	if want := []string{"COS", "剧情"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RemoveActorsFromTags() = %#v, want %#v", got, want)
	}
}
