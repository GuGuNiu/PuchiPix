package api

import "testing"

func TestStripPersonFromTitle(t *testing.T) {
	tests := []struct {
		name     string
		title    string
		person   string
		expected string
	}{
		{
			name:     "gallery title with protagonist prefix",
			title:    "Machi馬吉 - Kafka卡芙卡 星穹铁道 21P1V",
			person:   "Machi馬吉",
			expected: "Kafka卡芙卡 星穹铁道 21P1V",
		},
		{
			name:     "title with em-dash separator",
			title:    "珟_珏Dita — 美味圣诞B档 176P",
			person:   "珟_珏Dita",
			expected: "美味圣诞B档 176P",
		},
		{
			name:     "title equals person name only",
			title:    "Machi馬吉",
			person:   "Machi馬吉",
			expected: "Machi馬吉", // should not return empty
		},
		{
			name:     "title does not start with person",
			title:    "Kafka卡芙卡 星穹铁道",
			person:   "Machi馬吉",
			expected: "Kafka卡芙卡 星穹铁道",
		},
		{
			name:     "empty title",
			title:    "",
			person:   "Someone",
			expected: "",
		},
		{
			name:     "empty person",
			title:    "Some Title",
			person:   "",
			expected: "Some Title",
		},
		{
			name:     "comma-separated persons, first matches",
			title:    "ActorA - Some Content",
			person:   "ActorA, ActorB",
			expected: "Some Content",
		},
		{
			name:     "comma-separated persons, second matches",
			title:    "ActorB - Some Content",
			person:   "ActorA, ActorB",
			expected: "Some Content",
		},
		{
			name:     "Chinese name with dash",
			title:    "面饼仙儿 - 碧蓝航线 柴郡 礼服",
			person:   "面饼仙儿",
			expected: "碧蓝航线 柴郡 礼服",
		},
		{
			name:     "title with colon separator",
			title:    "清水由乃: 米哈拉",
			person:   "清水由乃",
			expected: "米哈拉",
		},
		{
			name:     "video title that doesn't contain actor",
			title:    "青岛大学生被掌掴臀部仍迎合抽插",
			person:   "善場まみ",
			expected: "青岛大学生被掌掴臀部仍迎合抽插",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := StripPersonFromTitle(tt.title, tt.person)
			if result != tt.expected {
				t.Errorf("StripPersonFromTitle(%q, %q) = %q, want %q", tt.title, tt.person, result, tt.expected)
			}
		})
	}
}
