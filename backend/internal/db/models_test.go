package db

import (
	"reflect"
	"testing"
)

// TestModelFieldCount verifies that each Go struct has the same number
// of fields as its schema counterpart, catching accidental
// field additions or omissions during the migration.
func TestModelFieldCount(t *testing.T) {
	tests := []struct {
		name     string
		typ      any
		expected int
	}{
		{"DownloadTask", DownloadTask{}, 21},
		{"VideoInfo", VideoInfo{}, 12},
		{"Gallery", Gallery{}, 30},
		{"GalleryImage", GalleryImage{}, 16},
		{"GalleryVideo", GalleryVideo{}, 14},
		{"GalleryDownloadInfo", GalleryDownloadInfo{}, 25},
		{"SniffTask", SniffTask{}, 12},
		{"AppConfig", AppConfig{}, 5},
		{"SiteAccount", SiteAccount{}, 14},
		{"Person", Person{}, 10},
		{"BlocklistRule", BlocklistRule{}, 9},
		{"UserPreference", UserPreference{}, 6},
		{"DagEvent", DagEvent{}, 7},
		{"DagSnapshot", DagSnapshot{}, 5},
		{"DownloadHistory", DownloadHistory{}, 12},
		{"SjsBookmark", SjsBookmark{}, 11},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := reflect.TypeOf(tt.typ).NumField()
			if got != tt.expected {
				t.Errorf("%s: expected %d fields, got %d", tt.name, tt.expected, got)
			}
		})
	}
}

// TestDownloadHistoryIDIsString verifies that DownloadHistory uses a
// string ID (cuid) rather than auto-increment, matching the schema.
func TestDownloadHistoryIDIsString(t *testing.T) {
	dh := DownloadHistory{}
	idField := reflect.TypeOf(dh).Field(0)
	if idField.Type.Kind() != reflect.String {
		t.Errorf("DownloadHistory.ID should be string, got %v", idField.Type.Kind())
	}
}

// TestBigIntFieldsAreInt64 verifies that all BigInt fields
// map to int64 in Go, preventing silent truncation on large file sizes.
func TestBigIntFieldsAreInt64(t *testing.T) {
	tests := []struct {
		name   string
		typ    any
		fields []string
	}{
		{"VideoInfo", VideoInfo{}, []string{"FileSize"}},
		{"Gallery", Gallery{}, []string{"TotalSize", "DownloadedSize"}},
		{"GalleryImage", GalleryImage{}, []string{"FileSize"}},
		{"GalleryVideo", GalleryVideo{}, []string{"FileSize"}},
		{"GalleryDownloadInfo", GalleryDownloadInfo{}, []string{"ActualSize"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			typ := reflect.TypeOf(tt.typ)
			for _, fieldName := range tt.fields {
				field, ok := typ.FieldByName(fieldName)
				if !ok {
					t.Errorf("field %s not found in %s", fieldName, tt.name)
					continue
				}
				if field.Type.Kind() != reflect.Int64 {
					t.Errorf("%s.%s should be int64, got %v", tt.name, fieldName, field.Type.Kind())
				}
			}
		})
	}
}

// TestNullableFieldsArePointers verifies that optional fields
// (marked with ?) map to pointer types in Go, allowing null to be
// distinguished from zero values.
func TestNullableFieldsArePointers(t *testing.T) {
	tests := []struct {
		name   string
		typ    any
		fields []string
	}{
		{"DownloadTask", DownloadTask{}, []string{"Seq"}},
		{"Gallery", Gallery{}, []string{"Seq", "GameCharacters", "PublishTime", "ScrapedAt", "CompletedAt"}},
		{"GalleryImage", GalleryImage{}, []string{"CompletedAt"}},
		{"GalleryVideo", GalleryVideo{}, []string{"CompletedAt"}},
		{"SniffTask", SniffTask{}, []string{"Seq", "CompletedAt"}},
		{"SiteAccount", SiteAccount{}, []string{"LastLoginAt", "LastUsedAt"}},
		{"Person", Person{}, []string{"SourceGame"}},
		{"DagEvent", DagEvent{}, []string{"NodeID"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			typ := reflect.TypeOf(tt.typ)
			for _, fieldName := range tt.fields {
				field, ok := typ.FieldByName(fieldName)
				if !ok {
					t.Errorf("field %s not found in %s", fieldName, tt.name)
					continue
				}
				if field.Type.Kind() != reflect.Ptr {
					t.Errorf("%s.%s should be pointer, got %v", tt.name, fieldName, field.Type.Kind())
				}
			}
		})
	}
}
