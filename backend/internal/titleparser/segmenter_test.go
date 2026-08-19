package titleparser

import (
	"testing"
)

func TestSmartSegment(t *testing.T) {
	p := New()
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "Chinese book title marks",
			input: "Yuuhui玉汇《升舱服务》128P2V空姐写真",
			want:  []string{"Yuuhui玉汇", "升舱服务", "128P2V空姐写真"},
		},
		{
			name:  "no paired delimiters falls back to legacy",
			input: "NAGISA魔物喵 - 女仆之夜",
			want:  []string{"NAGISA魔物喵", "女仆之夜"},
		},
		{
			name:  "unmatched opening bracket is split by regex",
			input: "模特《未闭合标题",
			want:  []string{"模特", "未闭合标题"},
		},
		{
			name:  "unmatched closing bracket is split by regex",
			input: "模特》无开头标题 - 作品名",
			want:  []string{"模特", "无开头标题", "作品名"},
		},
		{
			name:  "pipe separator with paired delimiters",
			input: "模特A｜模特B《作品名》",
			want:  []string{"模特A", "模特B", "作品名"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := p.smartSegment(tt.input)
			if len(got) != len(tt.want) {
				t.Errorf("segment count: got %d, want %d\n  got:  %v\n  want: %v", len(got), len(tt.want), got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("segment[%d]: got %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestSmartSegmentEmpty(t *testing.T) {
	p := New()
	if got := p.smartSegment(""); len(got) != 0 {
		t.Errorf("empty input: got %d segments, want 0", len(got))
	}
}

func TestSmartSegmentNoOp(t *testing.T) {
	p := New()
	got := p.smartSegment("simple title no delimiters")
	if len(got) != 1 || got[0] != "simple title no delimiters" {
		t.Errorf("no-op: got %v, want [simple title no delimiters]", got)
	}
}
