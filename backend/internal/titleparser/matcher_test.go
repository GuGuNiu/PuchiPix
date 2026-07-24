package titleparser

import (
	"testing"
)

func TestScoredMatch(t *testing.T) {
	p := New()
	p.LoadModels([]ModelEntry{
		{Name: "NAGISA魔物喵", Pinyin: "NAGISA mowumiao", Aliases: []string{"NAGISA", "魔物喵"}},
		{Name: "Yiko湿润兔", Pinyin: "Yiko shiruntu", Aliases: []string{"Yiko", "湿润兔"}},
		{Name: "黏黏团子兔", Pinyin: "niannian tuanzitu", Aliases: []string{"黏黏团子", "团子兔"}},
		{Name: "蠢沫沫", Pinyin: "chun momo", Aliases: []string{"蠢沫", "沫沫"}},
	})

	tests := []struct {
		name    string
		segment string
		wantOK  bool
		want    string
	}{
		{
			name:    "exact name match",
			segment: "nagisa魔物喵",
			wantOK:  true,
			want:    "NAGISA魔物喵",
		},
		{
			name:    "exact alias match",
			segment: "NAGISA",
			wantOK:  true,
			want:    "NAGISA魔物喵",
		},
		{
			name:    "substring match with head bonus",
			segment: "黏黏团子兔奇遇记",
			wantOK:  true,
			want:    "黏黏团子兔",
		},
		{
			name:    "inline substring match",
			segment: "作品-黏黏团子兔-合集",
			wantOK:  true,
			want:    "黏黏团子兔",
		},
		{
			name:    "pinyin full match stored field",
			segment: "chunmomo奇遇记",
			wantOK:  true,
			want:    "蠢沫沫",
		},
		{
			name:    "no match returns false",
			segment: "randomtext",
			wantOK:  false,
			want:    "",
		},
		{
			name:    "single char alias filtered out",
			segment: "秋山兔女郎",
			wantOK:  false,
			want:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := p.scoredMatch(tt.segment)
			if ok != tt.wantOK {
				t.Errorf("ok: got %v, want %v (name=%q)", ok, tt.wantOK, got)
			}
			if got != tt.want {
				t.Errorf("name: got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPinyinProMatch(t *testing.T) {
	p := New()
	p.LoadModels([]ModelEntry{
		{Name: "蠢沫沫", Pinyin: "chun momo", Aliases: []string{"蠢沫", "沫沫"}},
		{Name: "咬一口兔娘", Pinyin: "yaoyikou tuniang", Aliases: []string{"兔娘", "ovo"}},
	})

	tests := []struct {
		name    string
		segment string
		want    string
		wantOK  bool
	}{
		{
			name:    "PinyinPro converts Chinese chars to match stored pinyin",
			segment: "chunmomo的写真集",
			want:    "蠢沫沫",
			wantOK:  true,
		},
		{
			name:    "PinyinPro partial match when Chinese segment contains model sounds",
			segment: "蠢沫沫",
			want:    "蠢沫沫",
			wantOK:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := p.scoredMatch(tt.segment)
			if ok != tt.wantOK {
				t.Errorf("ok: got %v, want %v", ok, tt.wantOK)
			}
			if got != tt.want {
				t.Errorf("name: got %q, want %q", got, tt.want)
			}
		})
	}
}

func BenchmarkScoredMatch(b *testing.B) {
	p := New()
	p.LoadModels([]ModelEntry{
		{Name: "NAGISA魔物喵", Pinyin: "NAGISA mowumiao", Aliases: []string{"NAGISA", "魔物喵"}},
		{Name: "Yiko湿润兔", Pinyin: "Yiko shiruntu", Aliases: []string{"Yiko", "湿润兔"}},
		{Name: "黏黏团子兔", Pinyin: "niannian tuanzitu", Aliases: []string{"黏黏团子", "团子兔"}},
		{Name: "蠢沫沫", Pinyin: "chun momo", Aliases: []string{"蠢沫", "沫沫"}},
	})

	seg := "黏黏团子兔 - 2026年06月作品"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.scoredMatch(seg)
	}
}

func BenchmarkSmartSegment(b *testing.B) {
	p := New()
	title := "Yuuhui玉汇《升舱服务》128P2V空姐写真"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.smartSegment(title)
	}
}

func TestIsPlausibleModelName(t *testing.T) {
	tests := []struct {
		seg  string
		want bool
	}{
		{"雪晴Astra", true},
		{"过期米线线喵", true},
		{"Buckwheat777", true},
		{"徐若兮", true},
		{"霜月shimo", true},
		{"Irisuare", true},
		{"", false},
		{"123", false},
		{"Cosplay", false},
		{"cos", false},
		{"JK", false},
		{"108P3V", false},
		{"写真", false},
		{"-", false},
		// Cosplay keywords + metadata markers → rejected
		{"白虎私拍合集_#01", false},
		{"女仆私拍_34P", false},
		// Pure model names (no metadata markers) → accepted
		{"北村写真部", true}, // contains "写真" but no metadata markers
		{"刺卜(连连)", true},
	}

	for _, tt := range tests {
		got := isPlausibleModelName(tt.seg)
		if got != tt.want {
			t.Errorf("isPlausibleModelName(%q) = %v, want %v", tt.seg, got, tt.want)
		}
	}
}

func TestUnknownModelExtraction(t *testing.T) {
	p := New()
	// Load only 1 model — the other names in titles won't match
	p.LoadModels([]ModelEntry{
		{Name: "NAGISA魔物喵", Pinyin: "NAGISA mowumiao", Aliases: []string{"NAGISA", "魔物喵"}},
	})

	tests := []struct {
		title string
		want  string
	}{
		{"雪晴Astra - 刻晴恶魔拘束睡衣", "雪晴Astra"},
		{"过期米线线喵 - 涩涩学姐：学姐制服黑丝大尺度私房 55P", "过期米线线喵"},
		{"霜月shimo - NIKKE灰姑娘女仆装VOL.2：白丝高跟鞋质感很在线 33P", "霜月shimo"},
		{"徐若兮 - R18 秀人网新人首套：肉丝美胸 82P", "徐若兮"},
		{"NAGISA魔物喵 - 女仆之夜", "NAGISA魔物喵"},
		{"TML.004 秋山兔女郎", ""}, // No separator, no known model
	}

	for _, tt := range tests {
		result := p.Parse(tt.title)
		if result.Protagonist != tt.want {
			t.Errorf("Parse(%q).Protagonist = %q, want %q", tt.title, result.Protagonist, tt.want)
		}
	}
}
