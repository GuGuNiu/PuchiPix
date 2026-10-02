package titleparser

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/mozillazg/go-pinyin"

	"backend/internal/xutil"
)

// Scoring matrix for model name matching. Base scores decrease from exact
// name (1.0) through alias, substring, and pinyin matches. Position bonuses
// reward head-of-segment matches and penalize tail matches.
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

type matchCandidate struct {
	name       string
	score      float64
	sourceKey  string
	sourceType string
}

const (
	matchSourceName   = "name"
	matchSourceAlias  = "alias"
	matchSourcePinyin = "pinyin"
)

// scoredMatch runs the similarity-matrix pipeline for a single segment
// against all loaded models. Returns the best candidate exceeding
// matchThreshold, or ("", false) if none qualify.
func (p *Parser) scoredMatch(seg string) (string, bool) {
	lower := xutil.MetadataKey(seg)
	var best matchCandidate

	p.evalExactMatch(lower, &best)
	p.evalSubMatch(lower, &best)
	p.evalPinyinMatch(lower, seg, &best)

	if best.score < matchThreshold {
		return "", false
	}

	// Alias matches need corroboration to avoid false positives from
	// generic aliases such as "SU", "Sally" or "Yuki" appearing inside
	// unrelated names. Substring and pinyin alias matches always require
	// it, and exact matches require it when the alias is at most 2 runes
	// and the segment is longer than the alias itself. Longer exact
	// alias matches ("NAGISA", "shimo") are trusted as-is.
	if best.sourceType == matchSourceAlias {
		if best.score < scoreExactAlias {
			if !p.crossValidate(seg, best.name, best.sourceKey) {
				return "", false
			}
		}
		if best.score >= scoreExactAlias && utf8.RuneCountInString(best.sourceKey) == 2 && len(lower) > len(best.sourceKey) {
			if !p.crossValidate(seg, best.name, best.sourceKey) {
				return "", false
			}
		}
	}

	return best.name, true
}

func (p *Parser) crossValidate(seg, modelName, matchedAlias string) bool {
	lower := xutil.MetadataKey(seg)

	m, ok := p.models[xutil.MetadataKey(modelName)]
	if !ok {
		return false
	}

	if strings.Contains(lower, strings.ToLower(m.Name)) {
		return true
	}

	// Compare case-insensitively to skip the same alias that triggered
	// the match (index stores lowercase keys, original alias may differ).
	matchedLower := strings.ToLower(matchedAlias)
	for _, alias := range m.Aliases {
		if strings.ToLower(alias) == matchedLower {
			continue
		}
		if utf8.RuneCountInString(alias) < 2 {
			continue
		}
		if strings.Contains(lower, strings.ToLower(alias)) {
			return true
		}
	}

	return false
}

func (p *Parser) evalExactMatch(segLower string, best *matchCandidate) {
	if m, ok := p.models[segLower]; ok {
		updateBest(best, matchCandidate{m.Name, scoreExactName, m.Name, matchSourceName})
		return
	}
	if name, ok := p.modelAliasIndex[segLower]; ok {
		// Reject single-character aliases, they are too generic to identify a person.
		if utf8.RuneCountInString(segLower) >= 2 {
			updateBest(best, matchCandidate{name, scoreExactAlias, segLower, matchSourceAlias})
		}
	}
}

func (p *Parser) evalSubMatch(segLower string, best *matchCandidate) {
	// The prefix index narrows candidates to keys sharing a 2-rune window
	// with the segment, avoiding a full scan over every loaded model.
	candidateSet := make(map[string]bool)
	substrings := extractPrefixes(segLower, 2)
	for _, sub := range substrings {
		if candidates, ok := p.modelPrefixIndex[sub]; ok {
			for _, c := range candidates {
				candidateSet[c] = true
			}
		}
		if candidates, ok := p.aliasPrefixIndex[sub]; ok {
			for _, c := range candidates {
				candidateSet[c] = true
			}
		}
	}

	for key := range candidateSet {
		if !strings.Contains(segLower, key) {
			continue
		}
		if m, ok := p.models[key]; ok {
			if utf8.RuneCountInString(key) < 2 {
				continue
			}
			score := scoreSubName + positionBonus(segLower, key)
			updateBest(best, matchCandidate{m.Name, clampScore(score), key, matchSourceName})
		} else if name, ok := p.modelAliasIndex[key]; ok {
			if utf8.RuneCountInString(key) < 2 {
				continue
			}
			score := scoreSubAlias + positionBonus(segLower, key)
			updateBest(best, matchCandidate{name, clampScore(score), key, matchSourceAlias})
		}
	}
}

func (p *Parser) evalPinyinMatch(segLower, segOriginal string, best *matchCandidate) {
	if !containsHan(segLower) {
		return
	}

	// Compute once and reuse across all model comparisons to avoid O(N) pinyin calls
	segPy := pinyin.LazyPinyin(segLower, pinyin.NewArgs())
	compactSegPy := strings.Join(segPy, "")
	if len(compactSegPy) < 3 {
		return
	}

	for _, m := range p.models {
		if m.Pinyin == "" {
			continue
		}

		compactStored := strings.ReplaceAll(strings.ToLower(m.Pinyin), " ", "")
		if len(compactStored) < 3 {
			continue
		}

		if strings.Contains(segLower, compactStored) {
			pos := strings.Index(segLower, compactStored)
			score := scorePinyinFull + pinyinPosBonus(pos, len(segLower), len(compactStored))
			updateBest(best, matchCandidate{m.Name, clampScore(score), compactStored, matchSourcePinyin})
			continue
		}

		if len(compactSegPy) >= 3 && strings.Contains(compactSegPy, compactStored) {
			updateBest(best, matchCandidate{m.Name, scorePinyinPart, compactStored, matchSourcePinyin})
		}
	}
}

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
	if c.score > best.score || (c.score == best.score && best.name != "" && c.name < best.name) {
		best.name = c.name
		best.score = c.score
		best.sourceKey = c.sourceKey
		best.sourceType = c.sourceType
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

// isPlausibleModelName checks whether a segment could be an unknown model
// name, enabling discovery of models not yet in the database. A segment is
// plausible if it contains Han or Latin characters, has 2-40 runes, and is
// not a photo count, file size, product code, or cosplay-tag pattern.
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

var cosplaySubTerms = []string{"私拍", "合集", "写真", "图包", "套图", "福利", "同人"}

// metadataMarkerRE matches auto-generated metadata patterns: underscore-digit,
// underscore-hash, or photo/video count suffixes that rarely appear in model names.
var metadataMarkerRE = regexp.MustCompile(`[_\s]\d+|_\s*#\d+|(?i)_\d*[pPvV]`)

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

	// A cosplay keyword only marks a description segment when the segment
	// also carries an auto-generated metadata marker, otherwise real model
	// names containing the keyword would be discarded.
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

func containsHan(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}
