package kanav

import (
	"testing"
)

// TestExtractVideoID tests the video ID extraction from URLs.
func TestExtractVideoID(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		expected string
	}{
		{
			name:     "Standard detail URL",
			url:      "https://v1.kanav.work/index.php/vod/play/id/120743/sid/1/nid/1.html",
			expected: "120743",
		},
		{
			name:     "Relative URL",
			url:      "/index.php/vod/play/id/12345/sid/1/nid/1.html",
			expected: "12345",
		},
		{
			name:     "URL with query params",
			url:      "/index.php/vod/play/id/99999/sid/1/nid/1.html?ref=home",
			expected: "99999",
		},
		{
			name:     "Type page URL (also has id pattern)",
			url:      "https://v1.kanav.work/index.php/vod/type/id/4.html",
			expected: "4", // The pattern matches /id/4 in this URL too
		},
		{
			name:     "Empty URL",
			url:      "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractVideoID(tt.url)
			if result != tt.expected {
				t.Errorf("ExtractVideoID(%q) = %q, want %q", tt.url, result, tt.expected)
			}
		})
	}
}

// TestExtractViews tests the views extraction from text.
func TestExtractViews(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected int
	}{
		{
			name:     "Standard views",
			text:     "1234 Views",
			expected: 1234,
		},
		{
			name:     "Views with comma",
			text:     "1,234,567 Views",
			expected: 1234567,
		},
		{
			name:     "Zero views",
			text:     "0 Views",
			expected: 0,
		},
		{
			name:     "No views text",
			text:     "国产AV",
			expected: 0,
		},
		{
			name:     "Empty string",
			text:     "",
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractViews(tt.text)
			if result != tt.expected {
				t.Errorf("ExtractViews(%q) = %d, want %d", tt.text, result, tt.expected)
			}
		})
	}
}

// TestExtractDate tests the date extraction from text.
func TestExtractDate(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected string
	}{
		{
			name:     "Standard date format",
			text:     "视频标题 2026 / 08 / 03",
			expected: "2026-08-03",
		},
		{
			name:     "Date without spaces",
			text:     "2026/08/03",
			expected: "2026-08-03",
		},
		{
			name:     "Single digit month/day",
			text:     "2026 / 8 / 3",
			expected: "2026-08-03",
		},
		{
			name:     "No date in text",
			text:     "Just a title without date",
			expected: "",
		},
		{
			name:     "Empty string",
			text:     "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractDate(tt.text)
			if result != tt.expected {
				t.Errorf("ExtractDate(%q) = %q, want %q", tt.text, result, tt.expected)
			}
		})
	}
}

// TestExtractPageNumber tests the page number extraction from URLs.
func TestExtractPageNumber(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		expected int
	}{
		{
			name:     "Page 2 URL",
			url:      "https://v1.kanav.work/index.php/vod/show/by/time/id/4/page/2.html",
			expected: 2,
		},
		{
			name:     "Page 10 URL",
			url:      "/index.php/vod/show/by/time/id/4/page/10.html",
			expected: 10,
		},
		{
			name:     "First page (no page in URL)",
			url:      "https://v1.kanav.work/index.php/vod/show/by/time/id/4.html",
			expected: 1,
		},
		{
			name:     "Invalid page number",
			url:      "/page/abc.html",
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractPageNumber(tt.url)
			if result != tt.expected {
				t.Errorf("ExtractPageNumber(%q) = %d, want %d", tt.url, result, tt.expected)
			}
		})
	}
}

// TestBuildListingURL tests the listing URL construction.
func TestBuildListingURL(t *testing.T) {
	tests := []struct {
		name       string
		baseURL    string
		categoryID int
		sort       SortType
		page       int
		expected   string
	}{
		{
			name:       "First page",
			baseURL:    "https://v1.kanav.work",
			categoryID: 4,
			sort:       SortTypeTime,
			page:       1,
			expected:   "https://v1.kanav.work/index.php/vod/show/by/time/id/4.html",
		},
		{
			name:       "Page 2",
			baseURL:    "https://v1.kanav.work",
			categoryID: 4,
			sort:       SortTypeTime,
			page:       2,
			expected:   "https://v1.kanav.work/index.php/vod/show/by/time/id/4/page/2.html",
		},
		{
			name:       "Hits sort",
			baseURL:    "https://v1.kanav.work",
			categoryID: 1,
			sort:       SortTypeHits,
			page:       1,
			expected:   "https://v1.kanav.work/index.php/vod/show/by/hits/id/1.html",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BuildListingURL(tt.baseURL, tt.categoryID, tt.sort, tt.page)
			if result != tt.expected {
				t.Errorf("BuildListingURL() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// TestBuildDetailURL tests the detail URL construction.
func TestBuildDetailURL(t *testing.T) {
	tests := []struct {
		name     string
		baseURL  string
		videoID  string
		expected string
	}{
		{
			name:     "Standard detail URL",
			baseURL:  "https://v1.kanav.work",
			videoID:  "120743",
			expected: "https://v1.kanav.work/index.php/vod/play/id/120743/sid/1/nid/1.html",
		},
		{
			name:     "Different base URL",
			baseURL:  "https://kanav.ad",
			videoID:  "12345",
			expected: "https://kanav.ad/index.php/vod/play/id/12345/sid/1/nid/1.html",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BuildDetailURL(tt.baseURL, tt.videoID)
			if result != tt.expected {
				t.Errorf("BuildDetailURL() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// TestGetCategoryByID tests the category lookup.
func TestGetCategoryByID(t *testing.T) {
	tests := []struct {
		name         string
		id           int
		expectedName string
		expectedOk   bool
	}{
		{
			name:         "Valid category - 国产AV",
			id:           4,
			expectedName: "国产AV",
			expectedOk:   true,
		},
		{
			name:         "Valid category - 中文字幕",
			id:           1,
			expectedName: "中文字幕",
			expectedOk:   true,
		},
		{
			name:         "Invalid category",
			id:           999,
			expectedName: "",
			expectedOk:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cat, ok := GetCategoryByID(tt.id)
			if ok != tt.expectedOk {
				t.Errorf("GetCategoryByID(%d) ok = %v, want %v", tt.id, ok, tt.expectedOk)
			}
			if ok && cat.Name != tt.expectedName {
				t.Errorf("GetCategoryByID(%d) name = %q, want %q", tt.id, cat.Name, tt.expectedName)
			}
		})
	}
}

// TestProviderCanHandle tests the provider's CanHandle logic.
func TestProviderCanHandle(t *testing.T) {
	// This would require a mock data store
	// For now, we just test the URL patterns
	tests := []struct {
		name     string
		url      string
		expected bool
	}{
		{
			name:     "KanAV domain",
			url:      "https://v1.kanav.work/index.php/vod/play/id/123.html",
			expected: true,
		},
		{
			name:     "KanAV alternate domain",
			url:      "https://kanav.ad/index.php/vod/type/id/4.html",
			expected: true,
		},
		{
			name:     "Non-KanAV domain",
			url:      "https://example.com/video/123",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// This is a placeholder - actual test would use a real provider
			// with a mock data store
			_ = tt
		})
	}
}

// TestIsListingPage tests the listing page detection.
func TestIsListingPage(t *testing.T) {
	// Create a provider for testing
	p := &Provider{
		baseURL: "https://v1.kanav.work",
	}

	tests := []struct {
		name     string
		url      string
		expected bool
	}{
		{
			name:     "Category type page",
			url:      "https://v1.kanav.work/index.php/vod/type/id/4.html",
			expected: true,
		},
		{
			name:     "Sorted listing page",
			url:      "https://v1.kanav.work/index.php/vod/show/by/time/id/4.html",
			expected: true,
		},
		{
			name:     "Search page",
			url:      "https://v1.kanav.work/index.php/vod/search.html?wd=test",
			expected: true,
		},
		{
			name:     "Label page",
			url:      "https://v1.kanav.work/index.php/label/hot.html",
			expected: true,
		},
		{
			name:     "Detail page",
			url:      "https://v1.kanav.work/index.php/vod/play/id/12345/sid/1/nid/1.html",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := p.IsListingPage(tt.url)
			if result != tt.expected {
				t.Errorf("IsListingPage(%q) = %v, want %v", tt.url, result, tt.expected)
			}
		})
	}
}

// TestCleanTitle tests the title cleaning function.
func TestCleanTitle(t *testing.T) {
	p := &Provider{}

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Title with combined KanAV suffix",
			input:    "视频标题 - KanAV-免费高清中文AV在线看",
			expected: "视频标题",
		},
		{
			name:     "Title with simple KanAV suffix",
			input:    "视频标题 - KanAV",
			expected: "视频标题",
		},
		{
			name:     "Title with subtitle suffix",
			input:    "视频标题[中文字幕]",
			expected: "视频标题",
		},
		{
			name:     "Title with online watch suffix",
			input:    "视频标题 - 在线观看",
			expected: "视频标题",
		},
		{
			name:     "Title with em dash separator",
			input:    "视频标题 — KanAV-免费高清中文AV在线看",
			expected: "视频标题",
		},
		{
			name:     "Title with leading online play prefix (kanav CleanTitle does not strip prefix - that is done by universal CleanTitle)",
			input:    "在线播放 - 视频标题 - KanAV-免费高清中文AV在线看",
			expected: "在线播放 - 视频标题",
		},
		{
			name:     "Clean title",
			input:    "干净的视频标题",
			expected: "干净的视频标题",
		},
		{
			name:     "Empty title",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := p.CleanTitle(tt.input)
			if result != tt.expected {
				t.Errorf("CleanTitle(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// BenchmarkExtractVideoID benchmarks the video ID extraction.
func BenchmarkExtractVideoID(b *testing.B) {
	url := "https://v1.kanav.work/index.php/vod/play/id/120743/sid/1/nid/1.html"
	for i := 0; i < b.N; i++ {
		ExtractVideoID(url)
	}
}

// BenchmarkExtractViews benchmarks the views extraction.
func BenchmarkExtractViews(b *testing.B) {
	text := "1,234,567 Views"
	for i := 0; i < b.N; i++ {
		ExtractViews(text)
	}
}
