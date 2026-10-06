package xutil

import (
	"reflect"
	"testing"
)

func TestCleanMetadataLists(t *testing.T) {
	tags := CleanTagList([]string{" ＣＯＳ， cos ", "Alice", "alice", "unknown", "兔女郎\n写真"})
	if want := []string{"COS", "Alice", "兔女郎", "写真"}; !reflect.DeepEqual(tags, want) {
		t.Fatalf("CleanTagList() = %#v, want %#v", tags, want)
	}

	actors := CleanActorList([]string{"演员： Xinxinzi ", "xinxinzi", "上传者", "Bob & Alice"})
	if want := []string{"Xinxinzi", "Bob", "Alice"}; !reflect.DeepEqual(actors, want) {
		t.Fatalf("CleanActorList() = %#v, want %#v", actors, want)
	}

	filtered := RemoveMetadataValues([]string{"Alice", " ａｌｉｃｅ ", "兔女郎"}, []string{"ALICE"})
	if want := []string{"兔女郎"}; !reflect.DeepEqual(filtered, want) {
		t.Fatalf("RemoveMetadataValues() = %#v, want %#v", filtered, want)
	}
}

func TestMergeMetadataNormalizesAndDeduplicates(t *testing.T) {
	got := MergeMetadata(
		[]string{"ＣＯＳ", "剧情"},
		[]string{"cos", "多人"},
	)
	if want := []string{"COS", "剧情", "多人"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("MergeMetadata() = %#v, want %#v", got, want)
	}
}
