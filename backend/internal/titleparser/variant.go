package titleparser

import (
	"math"
	"strings"
	"unicode/utf8"
)

// VariantType classifies the relationship between a canonical model name
// and a discovered variant in the title text.
type VariantType string

const (
	VariantLatinSuffix  VariantType = "LatinSuffix"
	VariantCJKSuffix    VariantType = "CJKSuffix"
	VariantUnderscoreSep VariantType = "UnderscoreSep"
	VariantExactMatch   VariantType = "ExactMatch"
	VariantUnknown      VariantType = "Unknown"
)

// VariantCandidate holds a discovered variant with its metadata.
type VariantCandidate struct {
	ModelName string
	Variant   string
	Type      VariantType
}

// VariantScore holds the scored result for a candidate after cross-
// gallery validation.
type VariantScore struct {
	Candidate     VariantCandidate
	Frequency     int
	Exclusivity   float64
	PositionRate  float64
	LengthRatio   float64
	Score         float64
	Action        string // "auto" | "review" | "discard"
}

// VariantDiscoveryConfig controls thresholds for the scoring matrix.
type VariantDiscoveryConfig struct {
	AutoThreshold   float64
	ReviewThreshold float64
	MinFrequency    int
	MaxGalleries    int
}

// DefaultVariantConfig returns production-ready thresholds.
func DefaultVariantConfig() VariantDiscoveryConfig {
	return VariantDiscoveryConfig{
		AutoThreshold:   0.70,
		ReviewThreshold: 0.40,
		MinFrequency:    2,
		MaxGalleries:    500,
	}
}

// VariantContext holds the per-gallery context needed to extract a variant.
type VariantContext struct {
	Title        string
	Segment      string
	Protagonist   string
}

// ExtractVariant examines a gallery's title segment and protagonist to
// discover a variant. Returns nil if no variant is found.
func ExtractVariant(ctx VariantContext) *VariantCandidate {
	if ctx.Protagonist == "" || ctx.Segment == "" {
		return nil
	}

	lowerProto := strings.ToLower(ctx.Protagonist)
	lowerSeg := strings.ToLower(ctx.Segment)

	if !strings.HasPrefix(lowerSeg, lowerProto) {
		return nil
	}

	suffix := ctx.Segment[len(ctx.Protagonist):]
	if suffix == "" {
		return &VariantCandidate{
			ModelName: ctx.Protagonist,
			Variant:   ctx.Protagonist,
			Type:      VariantExactMatch,
		}
	}

	vt := classifyVariantType(suffix)
	return &VariantCandidate{
		ModelName: ctx.Protagonist,
		Variant:   strings.TrimSpace(suffix),
		Type:      vt,
	}
}

func classifyVariantType(suffix string) VariantType {
	if strings.HasPrefix(suffix, "_") {
		return VariantUnderscoreSep
	}

	hasCJK := false
	hasLatin := false
	for _, r := range suffix {
		if isCJK(r) {
			hasCJK = true
		} else if r <= 127 && ((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			hasLatin = true
		}
	}

	if hasLatin && !hasCJK {
		return VariantLatinSuffix
	}
	if hasCJK && !hasLatin {
		return VariantCJKSuffix
	}
	return VariantUnknown
}

// ── Scoring matrix ──

// ScoreVariant computes the confidence score for a variant using the
// four-dimensional weighted matrix:
//
//	score = 0.40 × freq_norm + 0.30 × exclusivity + 0.20 × position + 0.10 × length
func ScoreVariant(candidate VariantCandidate, freq int, totalOccurrences int, headPositions int) VariantScore {
	cfg := DefaultVariantConfig()

	freqNorm := math.Min(float64(freq)/float64(cfg.MinFrequency), 1.0)

	exclusivity := 1.0
	if totalOccurrences > 0 {
		exclusivity = float64(freq) / float64(totalOccurrences)
	}

	positionRate := 0.0
	if freq > 0 {
		positionRate = float64(headPositions) / float64(freq)
	}

	lenRatio := 1.0
	if utf8.RuneCountInString(candidate.Variant) > 0 {
		canonLen := float64(utf8.RuneCountInString(candidate.ModelName))
		varLen := float64(utf8.RuneCountInString(candidate.Variant))
		if canonLen > 0 {
			lenRatio = varLen / canonLen
		}
	}
	lenNorm := 1.0
	if lenRatio < 0.05 || lenRatio > 5.0 {
		lenNorm = 0.0
	} else if lenRatio < 0.1 || lenRatio > 2.0 {
		lenNorm = 0.5
	}

	score := 0.40*freqNorm + 0.30*exclusivity + 0.20*positionRate + 0.10*lenNorm
	score = math.Round(score*100) / 100

	action := "discard"
	if score >= cfg.AutoThreshold {
		action = "auto"
	} else if score >= cfg.ReviewThreshold {
		action = "review"
	}

	return VariantScore{
		Candidate:    candidate,
		Frequency:    freq,
		Exclusivity:  math.Round(exclusivity*100) / 100,
		PositionRate: math.Round(positionRate*100) / 100,
		LengthRatio:  math.Round(lenRatio*100) / 100,
		Score:        score,
		Action:       action,
	}
}

// ── Batch scoring over multiple gallery contexts ──

// ScoreCandidates takes a list of variant contexts (one per gallery for
// the same model) and computes the aggregated variant score.
func ScoreCandidates(candidates []VariantContext) []VariantScore {
	type aggregate struct {
		candidate      VariantCandidate
		freq           int
		headPositions  int
		totalOccurrences int
	}

	groups := make(map[string]*aggregate)
	for _, ctx := range candidates {
		c := ExtractVariant(ctx)
		if c == nil {
			continue
		}

		key := c.ModelName + "||" + c.Variant
		ag, ok := groups[key]
		if !ok {
			ag = &aggregate{candidate: *c}
			groups[key] = ag
		}
		ag.freq++
		ag.totalOccurrences++

		if isHeadPosition(ctx.Title, ctx.Segment) {
			ag.headPositions++
		}
	}

	// Compute total occurrences across all variants for exclusivity
	modelTotals := make(map[string]int)
	for _, ag := range groups {
		modelTotals[ag.candidate.ModelName] += ag.freq
	}

	var scores []VariantScore
	for _, ag := range groups {
		score := ScoreVariant(ag.candidate, ag.freq, modelTotals[ag.candidate.ModelName], ag.headPositions)
		scores = append(scores, score)
	}
	return scores
}

func isHeadPosition(title, segment string) bool {
	idx := strings.Index(title, segment)
	return idx == 0 || (idx > 0 && !isAlphaNum(rune(title[idx-1])))
}
