package titleparser

import (
	"testing"
)

func TestExtractVariant(t *testing.T) {
	tests := []struct {
		name    string
		ctx     VariantContext
		want    string
		wantType VariantType
		wantNil bool
	}{
		{
			name: "Latin suffix variant",
			ctx: VariantContext{
				Title:      "星之迟迟Hoshilily - 碧蓝航线 信浓",
				Segment:    "星之迟迟Hoshilily",
				Protagonist: "星之迟迟",
			},
			want:     "Hoshilily",
			wantType: VariantLatinSuffix,
		},
		{
			name: "exact match no variant",
			ctx: VariantContext{
				Title:      "星之迟迟 - 尤娜兔女郎",
				Segment:    "星之迟迟",
				Protagonist: "星之迟迟",
			},
			want:     "星之迟迟",
			wantType: VariantExactMatch,
		},
		{
			name: "underscore variant not matched (canonical lacks _)",
			ctx: VariantContext{
				Title:      "KANEKO_咔喵 - 武藏同人",
				Segment:    "KANEKO_咔喵",
				Protagonist: "KANEKO咔喵",
			},
			wantNil: true, // Prefix mismatch: "KANEKO咔喵" ⊄ "KANEKO_咔喵"
		},
		{
			name: "empty protagonist",
			ctx: VariantContext{
				Title:      "test",
				Segment:    "test",
				Protagonist: "",
			},
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := ExtractVariant(tt.ctx)
			if tt.wantNil {
				if c != nil {
					t.Errorf("expected nil, got %+v", c)
				}
				return
			}
			if c == nil {
				t.Fatal("expected candidate, got nil")
			}
			if c.Variant != tt.want {
				t.Errorf("variant = %q, want %q", c.Variant, tt.want)
			}
			if c.Type != tt.wantType {
				t.Errorf("type = %q, want %q", c.Type, tt.wantType)
			}
		})
	}
}

func TestScoreVariant(t *testing.T) {
	c := VariantCandidate{
		ModelName: "星之迟迟",
		Variant:   "Hoshilily",
		Type:      VariantLatinSuffix,
	}

	s := ScoreVariant(c, 2, 2, 2)
	if s.Action != "auto" {
		t.Errorf("freq=2 excl=1.0 pos=1.0 → expected auto, got %s (score=%.2f)", s.Action, s.Score)
	}
	t.Logf("score: %.2f action=%s freq=%d excl=%.2f pos=%.2f len=%.2f",
		s.Score, s.Action, s.Frequency, s.Exclusivity, s.PositionRate, s.LengthRatio)

	// Low frequency should be review
	s2 := ScoreVariant(c, 1, 3, 0)
	if s2.Action != "review" && s2.Action != "discard" {
		t.Errorf("freq=1 → expected review/discard, got %s (score=%.2f)", s2.Action, s2.Score)
	}
}

func TestScoreCandidates(t *testing.T) {
	contexts := []VariantContext{
		{Title: "星之迟迟Hoshilily - 鸣潮 长离", Segment: "星之迟迟Hoshilily", Protagonist: "星之迟迟"},
		{Title: "星之迟迟Hoshilily - 碧蓝航线 信浓", Segment: "星之迟迟Hoshilily", Protagonist: "星之迟迟"},
	}

	scores := ScoreCandidates(contexts)
	if len(scores) == 0 {
		t.Fatal("expected scores, got none")
	}

	for _, s := range scores {
		t.Logf("variant=%q type=%s score=%.2f action=%s freq=%d",
			s.Candidate.Variant, s.Candidate.Type, s.Score, s.Action, s.Frequency)
		if s.Candidate.Variant == "Hoshilily" && s.Action != "auto" {
			t.Errorf("Hoshilily should be auto (freq=2, excl=1.0), got %s score=%.2f", s.Action, s.Score)
		}
	}
}
