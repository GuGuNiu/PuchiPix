package titleparser

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/mozillazg/go-pinyin"
)

// Similarity scoring matrix for model name matching against title segments.
//
// Each match type has a base score. Position bonuses are additive and
// reflect where in the segment the match occurs — matches at the segment
// head (prefix) receive a bonus; inline matches are neutral; tail matches
// receive a slight penalty since model names rarely appear at the end of
// a mixed segment.
//
//	Match type       | Base score
//	Exact name       |   1.00
//	Exact alias      |   0.92
//	Name substring   |   0.78
//	Alias substring  |   0.72
//	Pinyin full      |   0.65
//	Pinyin partial   |   0.48
//
//	Position         | Bonus
//	Head (prefix)    |  +0.08
//	Inline (middle)  |   0.00
//	Tail (suffix)    |  -0.06
const (
	scoreExactName  = 1.00
	scoreExactAlias = 0.92
	scoreSubName    = 0.78
	scoreSubAlias   = 0.72
	scorePinyinFull = 0.65
	scorePinyinPart = 0.48

	headBonus   = 0.08
	inlineBonus = 0.00
	tailPenalty = -0.06

	matchThreshold = 0.50
)

// matchCandidate bundles a model name with its computed similarity score.
type matchCandidate struct {
	name  string
	score float64
}

// pinyinArgs is the shared argument configuration for PinyinPro calls.
// Normal style without tones is preferred for matching — tones would
// create false negatives when segment text omits tone marks.
var pinyinArgs = &pinyin.Args{Style: pinyin.Normal}

// scoredMatch runs the full similarity-matrix pipeline for a single
// segment against all loaded models. Returns the best candidate whose
// score exceeds matchThreshold, or ("", false) if none qualify.
//
// The pipeline evaluates three match dimensions in priority order:
//   - Exact match: the full segment equals a model name or alias
//   - Substring match: a model name or alias appears within the segment
//   - Pinyin match: the model's PinyinPro-computed syllables appear
func (p *Parser) scoredMatch(seg string) (string, bool) {
	lower := strings.ToLower(seg)
	var best matchCandidate

	p.evalExactMatch(lower, &best)
	p.evalSubMatch(lower, &best)
	p.evalPinyinMatch(lower, seg, &best)

	if best.score < matchThreshold {
		return "", false
	}
	return best.name, true
}

func (p *Parser) evalExactMatch(segLower string, best *matchCandidate) {
	if m, ok := p.models[segLower]; ok {
		updateBest(best, matchCandidate{m.Name, scoreExactName})
		return
	}
	if name, ok := p.modelAliasIndex[segLower]; ok {
		updateBest(best, matchCandidate{name, scoreExactAlias})
	}
}

func (p *Parser) evalSubMatch(segLower string, best *matchCandidate) {
	for key, m := range p.models {
		if utf8.RuneCountInString(key) < 2 {
			continue
		}
		if !strings.Contains(segLower, key) {
			continue
		}
		score := scoreSubName + positionBonus(segLower, key)
		updateBest(best, matchCandidate{m.Name, clampScore(score)})
	}

	for alias, name := range p.modelAliasIndex {
		if utf8.RuneCountInString(alias) < 2 {
			continue
		}
		if !strings.Contains(segLower, alias) {
			continue
		}
		score := scoreSubAlias + positionBonus(segLower, alias)
		updateBest(best, matchCandidate{name, clampScore(score)})
	}
}

func (p *Parser) evalPinyinMatch(segLower, segOriginal string, best *matchCandidate) {
	for _, m := range p.models {
		if m.Pinyin == "" {
			continue
		}

		compactStored := strings.ReplaceAll(strings.ToLower(m.Pinyin), " ", "")
		if len(compactStored) < 3 {
			continue
		}

		// Stored-pinyin check: the compact form appears in the segment.
		if strings.Contains(segLower, compactStored) {
			pos := strings.Index(segLower, compactStored)
			score := scorePinyinFull + pinyinPosBonus(pos, len(segLower), len(compactStored))
			updateBest(best, matchCandidate{m.Name, clampScore(score)})
			continue
		}

		// PinyinPro check: compute pinyin for the segment's Chinese portion
		// and compare against the model's stored pinyin.
		if pinyinProMatch(segLower, compactStored) {
			updateBest(best, matchCandidate{m.Name, scorePinyinPart})
		}
	}
}

// pinyinProMatch uses the go-pinyin library to convert the segment text
// to pinyin and checks whether the model's compact pinyin appears within
// the computed result. This handles cases where the segment contains
// Chinese characters not present in the stored pinyin field.
func pinyinProMatch(segLower, compactModelPinyin string) bool {
	segPy := pinyin.LazyPinyin(segLower, pinyin.NewArgs())
	if len(segPy) == 0 {
		return false
	}
	compact := strings.Join(segPy, "")
	return len(compact) >= 3 && strings.Contains(compact, compactModelPinyin)
}

// positionBonus returns a position-based adjustment for substring matches.
//
//	Head (prefix): the matched text starts at byte offset 0 → +headBonus
//	Tail (suffix): the match ends at the segment boundary → +tailPenalty
//	Inline:        neither head nor tail → +inlineBonus (zero)
func positionBonus(seg, sub string) float64 {
	idx := strings.Index(seg, sub)
	if idx < 0 {
		return inlineBonus
	}
	if idx == 0 {
		return headBonus
	}
	if idx+len(sub) == len(seg) {
		return tailPenalty
	}
	return inlineBonus
}

// pinyinPosBonus is the position-bonus variant for pinyin matches where
// the match position is already known as a byte offset.
func pinyinPosBonus(pos, segLen, matchLen int) float64 {
	if pos == 0 {
		return headBonus
	}
	if pos+matchLen == segLen {
		return tailPenalty
	}
	return inlineBonus
}

func updateBest(best *matchCandidate, c matchCandidate) {
	if c.score > best.score {
		best.name = c.name
		best.score = c.score
	}
}

func clampScore(s float64) float64 {
	return math.Round(s*100) / 100
}

var (
	plausibleNameRE    = regexp.MustCompile(`[\p{Han}\p{Latin}]`)
	plausibleCountRE   = regexp.MustCompile(`(?i)^\d+[pP](\d+[vV])?$`)
	plausibleSizeRE    = regexp.MustCompile(`(?i)^\d+(\.\d+)?\s*[KMGT]?B\]?$|^\[\d+(\.\d+)?\s*[KMGT]?B\]$`)
	plausibleProductRE = regexp.MustCompile(`(?i)^[A-Za-z]{2,}\.\d{2,}$`)
)

// isPlausibleModelName checks whether a segment could be an unknown
// model name. This enables the parser to discover models that are not
// yet in the database — a critical capability since the model database
// covers only a fraction of all possible cosplayers.
//
// A segment is considered plausible if it contains Han or Latin
// characters, is not purely numeric or punctuation, has 2-40 runes,
// does not match cosplay-tag patterns (including compound prefixes
// like "JK制服", "Cos福利"), and is not a photo count or file size.
func isPlausibleModelName(seg string) bool {
	seg = strings.TrimSpace(seg)
	runes := utf8.RuneCountInString(seg)
	if runes < 2 || runes > 40 {
		return false
	}

	if !plausibleNameRE.MatchString(seg) {
		return false
	}

	if plausibleCountRE.MatchString(seg) {
		return false
	}

	if plausibleSizeRE.MatchString(seg) {
		return false
	}

	if plausibleProductRE.MatchString(seg) {
		return false
	}

	if matchesCosplayPreamble(seg) {
		return false
	}

	return true
}

// cosplaySubTerms lists cosplay-related keywords that indicate a
// segment is metadata/description rather than a model name when
// they appear alongside metadata markers (underscores, digits, #).
var cosplaySubTerms = []string{"私拍", "合集", "写真", "图包", "套图", "福利", "同人"}

// hasMetadataMarkers checks whether a segment contains patterns
// typical of auto-generated metadata: underscore-digit, underscore-hash,
// or photo/video count suffixes. These rarely appear in genuine model
// names and help distinguish description segments from unknown models.
//
// Examples:
//
//	"白虎私拍合集_#01"  → true  (_# followed by digits)
//	"NAGISA魔物喵"      → false (no metadata markers)
//	"北村写真部"        → false (contains "写真" but no metadata markers)
var metadataMarkerRE = regexp.MustCompile(`[_\s]\d+|_\s*#\d+|(?i)_\d*[pPvV]`)

// matchesCosplayPreamble checks whether the segment starts with a
// known cosplay-preamble word followed by a non-letter character
// or end of string. This filters out segments like "Cos福利与日常视图"
// or "JK制服：少女秩序" that begin with tag-like prefixes.
//
// Additionally checks for cosplay-related keywords appearing as
// substrings when the segment also contains metadata markers
// (e.g. "白虎私拍合集_#01" → rejected because it contains "私拍"/"合集"
// AND the metadata pattern "_#01").
func matchesCosplayPreamble(seg string) bool {
	lower := strings.ToLower(seg)
	preambles := []string{"cosplay", "coser", "cos", "jk", "jk制服", "cos福利", "福利", "写真", "私拍", "合集", "图包", "同人", "套图"}
	for _, p := range preambles {
		if lower == p {
			return true
		}
		if strings.HasPrefix(lower, p) {
			rest := lower[len(p):]
			if rest == "" || !isAlphaNum(rune(rest[0])) {
				return true
			}
		}
	}

	// Defense-in-depth: reject description-like segments that contain
	// cosplay keywords AND metadata markers (e.g. "白虎私拍合集_#01").
	// A segment with metadata markers is almost certainly auto-generated
	// metadata, not a model name — even if a cosplay keyword appears
	// mid-segment rather than at the start.
	if metadataMarkerRE.MatchString(lower) {
		for _, term := range cosplaySubTerms {
			if strings.Contains(lower, term) {
				return true
			}
		}
	}

	return false
}

func isAlphaNum(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}
