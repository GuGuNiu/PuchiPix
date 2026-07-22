package db

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestTableNamesConsistency verifies that every table name constant
// matches a non-empty snake_case string, preventing silent typos
// from breaking SQL queries at runtime.
func TestTableNamesConsistency(t *testing.T) {
	tests := []struct {
		name     string
		value    string
	}{
		{"TableDownloadTask", TableDownloadTask},
		{"TableVideoInfo", TableVideoInfo},
		{"TableGallery", TableGallery},
		{"TableGalleryImage", TableGalleryImage},
		{"TableGalleryVideo", TableGalleryVideo},
		{"TableGalleryDownloadInfo", TableGalleryDownloadInfo},
		{"TableSniffTask", TableSniffTask},
		{"TableAppConfig", TableAppConfig},
		{"TableSiteAccount", TableSiteAccount},
		{"TablePerson", TablePerson},
		{"TableBlocklistRule", TableBlocklistRule},
		{"TableUserPreference", TableUserPreference},
		{"TableDagEvent", TableDagEvent},
		{"TableDagSnapshot", TableDagSnapshot},
		{"TableDownloadHistory", TableDownloadHistory},
		{"TableSjsBookmark", TableSjsBookmark},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.value, "table name must not be empty")
			assert.False(t, strings.ToLower(tt.value) != tt.value, "table name should be lowercase snake_case")
		})
	}
}

// TestTableNamesUniqueness ensures no two constants share the same
// table name, which would cause ambiguous queries or migration conflicts.
func TestTableNamesUniqueness(t *testing.T) {
	all := []string{
		TableDownloadTask, TableVideoInfo, TableGallery, TableGalleryImage,
		TableGalleryVideo, TableGalleryDownloadInfo, TableSniffTask,
		TableAppConfig, TableSiteAccount, TablePerson, TableBlocklistRule,
		TableUserPreference, TableDagEvent, TableDagSnapshot,
		TableDownloadHistory, TableSjsBookmark,
	}
	seen := make(map[string]bool, len(all))
	for _, name := range all {
		assert.False(t, seen[name], "duplicate table name: %s", name)
		seen[name] = true
	}
}
