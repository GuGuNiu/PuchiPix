package urlutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestReplaceDomain verifies that the domain portion of a URL is
// swapped to the target base domain when the original URL starts with
// a known domain, enabling multi-domain failover without breaking
// article paths.
func TestReplaceDomain(t *testing.T) {
	domains := []string{"https://www.lovecutes.com", "https://xx.knit.bid"}
	tests := []struct {
		name     string
		rawURL   string
		base     string
		expected string
	}{
		{"replace first domain", "https://www.lovecutes.com/article/123/", "https://www.lovecutes.com", "https://www.lovecutes.com/article/123/"},
		{"replace alternate domain", "https://xx.knit.bid/article/123/", "https://www.lovecutes.com", "https://www.lovecutes.com/article/123/"},
		{"unknown domain unchanged", "https://other.com/article/123/", "https://www.lovecutes.com", "https://other.com/article/123/"},
		{"empty url", "", "https://www.lovecutes.com", ""},
		{"empty base", "https://www.lovecutes.com/article/123/", "", "https://www.lovecutes.com/article/123/"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, ReplaceDomain(tt.rawURL, tt.base, domains))
		})
	}
}

// TestReplaceHost verifies that the scheme and host are unconditionally
// replaced while the path and query string are preserved.
func TestReplaceHost(t *testing.T) {
	tests := []struct {
		name       string
		original   string
		newDomain  string
		expected   string
	}{
		{"replace with path", "https://primary.example.com/path/to/file.zip?query=1", "fallback.example.com", "https://fallback.example.com/path/to/file.zip?query=1"},
		{"strip scheme from new domain", "https://primary.example.com/a/b", "https://fallback.example.com", "https://fallback.example.com/a/b"},
		{"no path", "https://primary.example.com", "fallback.example.com", "https://fallback.example.com"},
		{"no scheme returns unchanged", "not-a-url", "fallback.example.com", "not-a-url"},
		{"http scheme upgraded", "http://primary.example.com/x", "fallback.example.com", "https://fallback.example.com/x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, ReplaceHost(tt.original, tt.newDomain))
		})
	}
}
