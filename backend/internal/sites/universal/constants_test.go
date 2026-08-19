package universal

import "testing"

// TestCleanTitle verifies the universal CleanTitle function handles various
// title formats including KanAV's combined suffix pattern.
func TestCleanTitle(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Empty title",
			input:    "",
			expected: "",
		},
		{
			name:     "Clean title - no changes needed",
			input:    "干净的视频标题",
			expected: "干净的视频标题",
		},
		{
			name:     "KanAV combined suffix (hyphen)",
			input:    "视频标题 - KanAV-免费高清中文AV在线看",
			expected: "视频标题",
		},
		{
			name:     "KanAV combined suffix (em dash)",
			input:    "视频标题 — KanAV-免费高清中文AV在线看",
			expected: "视频标题",
		},
		{
			name:     "KanAV simple suffix",
			input:    "视频标题 - KanAV",
			expected: "视频标题",
		},
		{
			name:     "Online play prefix and KanAV suffix",
			input:    "在线播放 - 视频标题 - KanAV-免费高清中文AV在线看",
			expected: "视频标题",
		},
		{
			name:     "Online play suffix",
			input:    "视频标题 - 在线播放",
			expected: "视频标题",
		},
		{
			name:     "Online watch suffix",
			input:    "视频标题 - 在线观看",
			expected: "视频标题",
		},
		{
			name:     "Free suffix",
			input:    "视频标题 - 免费",
			expected: "视频标题",
		},
		{
			name:     "HD suffix",
			input:    "视频标题 - 高清",
			expected: "视频标题",
		},
		{
			name:     "Publisher prefix",
			input:    "秀色站: 视频标题",
			expected: "视频标题",
		},
		{
			name:     "Multiple suffixes",
			input:    "视频标题 - 在线播放 - 高清",
			expected: "视频标题",
		},
		{
			name:     "Title with only suffix",
			input:    " - KanAV-免费高清中文AV在线看",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CleanTitle(tt.input)
			if result != tt.expected {
				t.Errorf("CleanTitle(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}
