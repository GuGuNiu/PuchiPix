// Package titleparser provides a multi-stage title parsing pipeline
// for extracting protagonist names, descriptions, and game characters
// from cosplay gallery titles. It is designed as a shared base-tool
// layer, usable by all site providers.
//
// Pipeline stages:
//   1. Preprocessing  – strip publisher prefixes/suffixes, brackets
//   2. Segmentation   – split title by known delimiters
//   3. Classification – match each segment against model/character DBs
//   4. Multi-person   – detect dual-person patterns (与/和)
//   5. Assembly       – produce final protagonist, description, gameChars
package titleparser

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

// ── Public types ──

// ParseResult holds the output of title parsing.
type ParseResult struct {
	Protagonist    string   // recognized model/character name(s), joined by "与"
	Description    string   // remaining part of title after removing protagonist
	GameCharacters []string // game character names found in title
	Segments       []string // raw segments split from title
	Confidence     float64  // 0.0–1.0 matching confidence
}

// ModelEntry is a read-only view of a cosplay model for matching.
type ModelEntry struct {
	Name    string   `json:"name"`
	Pinyin  string   `json:"pinyin"`
	Aliases []string `json:"aliases"`
}

// GameCharEntry is a read-only view of a game character for matching.
type GameCharEntry struct {
	Name      string   `json:"name"`
	Pinyin    string   `json:"pinyin"`
	Aliases   []string `json:"aliases"`
	GameName  string   `json:"game_name"`
	GameEn    string   `json:"game_name_en"`
}

// ── Internal types ──

// segInfo holds classification results for a single title segment.
type segInfo struct {
	text       string
	isModel    bool
	modelName  string   // canonical model name
	isGameChar bool
	gameChars  []string // game character names
	isCount    bool     // photo/video count
	isCosTag   bool     // cosplay tag
	isDesc     bool     // description fragment
}

// ── Parser interface ──

// Parser is the title parsing engine. It requires model and character
// data to be loaded via LoadModels / LoadGameCharacters before use.
type Parser struct {
	mu     sync.RWMutex
	models map[string]*ModelEntry     // keyed by lowercase name
	chars  map[string]*GameCharEntry  // keyed by lowercase name

	// index aliases → canonical name for fast lookup
	modelAliasIndex map[string]string // lowercase alias → canonical name
	charAliasIndex  map[string]string // lowercase alias → canonical name

	// Pre-compiled patterns
	separatorRE       *regexp.Regexp
	photoCountRE      *regexp.Regexp
	videoCountRE      *regexp.Regexp
	dualPersonRE      *regexp.Regexp
	gameRE            *regexp.Regexp
	cosplayTagRE      *regexp.Regexp
}

// New creates a ready-to-use Parser with pre-compiled patterns.
// Call LoadModels / LoadGameCharacters before parsing.
func New() *Parser {
	return &Parser{
		models:         make(map[string]*ModelEntry),
		chars:          make(map[string]*GameCharEntry),
		modelAliasIndex: make(map[string]string),
		charAliasIndex:  make(map[string]string),
		separatorRE:     regexp.MustCompile(`\s*[-–—]\s*|_\s*-\s*_|\s*[|｜]\s*|[《》：:]`),
		photoCountRE:    regexp.MustCompile(`(?i)^\d+[Pp](\d+[Vv])?(_?\d+[Pp](\d+[Vv])?)*$`),
		videoCountRE:    regexp.MustCompile(`(?i)^\d+[Vv]$`),
		dualPersonRE:    regexp.MustCompile(`^[与和]\s*(\S.+)`),
		cosplayTagRE:    regexp.MustCompile(`(?i)(Cosplay|COS|写真合集|写真|图包|同人|福利|套图)$`),
	}
}

// ── Data loading ──

// LoadModels populates the parser's model database from a slice of entries.
// Thread-safe; can be called at any time.
func (p *Parser) LoadModels(models []ModelEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range models {
		m := &models[i]
		key := strings.ToLower(m.Name)
		p.models[key] = m
		for _, alias := range m.Aliases {
			ak := strings.ToLower(alias)
			if ak == "" || ak == key {
				continue
			}
			if _, exists := p.modelAliasIndex[ak]; !exists {
				p.modelAliasIndex[ak] = m.Name
			}
		}
	}
}

// LoadGameCharacters populates the parser's game character database.
// Thread-safe; can be called at any time.
func (p *Parser) LoadGameCharacters(chars []GameCharEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range chars {
		c := &chars[i]
		key := strings.ToLower(c.Name)
		p.chars[key] = c
		for _, alias := range c.Aliases {
			ak := strings.ToLower(alias)
			if ak == "" || ak == key {
				continue
			}
			if _, exists := p.charAliasIndex[ak]; !exists {
				p.charAliasIndex[ak] = c.Name
			}
		}
	}
}

// ── Main entry point ──

// Parse runs the full parsing pipeline on a title.
// rawTitle should already have publisher prefixes/suffixes stripped.
func (p *Parser) Parse(rawTitle string) *ParseResult {
	if strings.TrimSpace(rawTitle) == "" {
		return &ParseResult{}
	}

	p.mu.RLock()
	defer p.mu.RUnlock()

	result := &ParseResult{Confidence: 0}

	// Stage 1: Remove brackets [xxx] and cosplay preamble prefixes
	title := regexp.MustCompile(`^\[.*?\]\s*`).ReplaceAllString(rawTitle, "")
	title = StripCosplayPreamble(title)
	title = strings.TrimSpace(title)
	if title == "" {
		return result
	}

	// Stage 2: Segmentation (multi-pass paired-delimiter aware)
	segments := p.smartSegment(title)
	result.Segments = segments

	if len(segments) == 0 {
		return result
	}

	// Stage 3: Classify each segment
	infos := make([]segInfo, len(segments))
	for i, seg := range segments {
		infos[i] = p.classifySegment(seg)
	}

	// Stage 4: Detect dual-person pattern
	// If segment N starts with "与" or "和", segment N-1 is model A and
	// segment N (after stripping "与/和") is model B.
	protagonists := p.detectProtagonists(segments, infos)

	// Stage 5: Extract game characters and description
	gameChars := p.extractGameCharacters(segments, infos)
	description := p.buildDescription(segments, infos, protagonists)

	result.Protagonist = strings.Join(protagonists, "与")
	result.Description = description
	result.GameCharacters = gameChars
	if len(protagonists) > 0 {
		result.Confidence = p.calcConfidence(segments, infos, protagonists)
	}

	return result
}

// ── Stage 2: Segmentation ──

func (p *Parser) segment(title string) []string {
	parts := p.separatorRE.Split(title, -1)
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		part = strings.TrimRight(part, " \t_-–—")
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

// ── Stage 3: Segment Classification ──

func (p *Parser) classifySegment(seg string) segInfo {
	info := segInfo{text: seg}

	// 3a: Check photo/video count pattern
	if p.photoCountRE.MatchString(seg) || p.videoCountRE.MatchString(seg) {
		info.isCount = true
		return info
	}

	// 3b: Check cosplay tag
	if p.cosplayTagRE.MatchString(strings.ToLower(seg)) {
		info.isCosTag = true
		return info
	}

	// 3c: Match against game character DB (has higher priority)
	if gc := p.matchGameChar(seg); len(gc) > 0 {
		info.isGameChar = true
		info.gameChars = gc
		return info
	}

	// 3d: Match against model DB (exact → substring → pinyin/substring)
	if name, ok := p.scoredMatch(seg); ok {
		info.isModel = true
		// Use the full segment text when the matched model name is a
		// proper prefix and the remaining suffix is purely Latin.
		// Example: "星之迟迟Hoshilily" matched as "星之迟迟" —
		// "Hoshilily" is the model's English alias and should be kept.
		info.modelName = p.expandModelName(name, seg)
		return info
	}

	// 3e: Fallback — check if segment contains any known game name
	if p.containsGameName(seg) {
		info.isGameChar = true
		return info
	}

	// Default: description fragment
	info.isDesc = true
	return info
}

// ── Stage 3c: Game character matching ──

func (p *Parser) matchGameChar(seg string) []string {
	lower := strings.ToLower(seg)
	var found []string

	// Exact match
	if c, ok := p.chars[lower]; ok {
		return []string{c.Name}
	}

	// Alias match
	if name, ok := p.charAliasIndex[lower]; ok {
		if c, ok2 := p.chars[strings.ToLower(name)]; ok2 {
			return []string{c.Name}
		}
	}

	// Substring match (game char name found within segment)
	// Use rune count to filter out single-CJK-character names that cause false positives.
	for key, c := range p.chars {
		if utf8.RuneCountInString(key) >= 2 && strings.Contains(lower, key) {
			found = append(found, c.Name)
		}
	}
	// Alias substring match
	for alias, name := range p.charAliasIndex {
		if utf8.RuneCountInString(alias) >= 2 && strings.Contains(lower, alias) {
			if c, ok := p.chars[strings.ToLower(name)]; ok {
				// dedup
				dup := false
				for _, f := range found {
					if f == c.Name {
						dup = true
						break
					}
				}
				if !dup {
					found = append(found, c.Name)
				}
			}
		}
	}

	return found
}

// ── Stage 3d: Model matching ──

func (p *Parser) matchModel(seg string) (string, bool) {
	lower := strings.ToLower(seg)

	// Level 1: Exact full-segment match
	if m, ok := p.models[lower]; ok {
		return m.Name, true
	}
	if name, ok := p.modelAliasIndex[lower]; ok {
		return name, true
	}

	// Level 2: Substring match — a known model name appears within the segment
	// This handles cases like "蠢沫沫奇遇记" → "蠢沫沫"
	// We iterate through all models and check if their name (or alias)
	// appears as a substring in the segment.
	// Use rune count to prevent single-CJK-character names/aliases from
	// matching everywhere (e.g. alias "兔" matching "兔女郎").
	for key, m := range p.models {
		if utf8.RuneCountInString(key) >= 2 && strings.Contains(lower, key) {
			return m.Name, true
		}
	}
	for alias, name := range p.modelAliasIndex {
		if utf8.RuneCountInString(alias) >= 2 && strings.Contains(lower, alias) {
			return name, true
		}
	}

	// Level 3: Pinyin-based substring match
	// Check if the model's pinyin without spaces appears in the lowercase segment
	for _, m := range p.models {
		pinyinCompact := strings.ReplaceAll(strings.ToLower(m.Pinyin), " ", "")
		if len(pinyinCompact) >= 3 && strings.Contains(lower, pinyinCompact) {
			return m.Name, true
		}
	}

	return "", false
}

// ── Stage 3e: Game name detection ──

// containsGameName checks if a segment contains a known game short name.
func (p *Parser) containsGameName(seg string) bool {
	gameNames := []string{
		"崩坏星穹铁道", "星穹铁道", "崩坏", "原神", "碧蓝航线",
		"碧蓝档案", "明日方舟", "尼尔", "英雄联盟",
	}
	lower := strings.ToLower(seg)
	for _, gn := range gameNames {
		if strings.Contains(lower, strings.ToLower(gn)) {
			return true
		}
	}
	return false
}

// ── Stage 4: Multi-person detection ──

func (p *Parser) detectProtagonists(segments []string, infos []segInfo) []string {
	var protagonists []string

	for i := range segments {
		seg := segments[i]

		if infos[i].isModel {
			protagonists = append(protagonists, infos[i].modelName)
			continue
		}

		// Detect dual-person "与"/"和" pattern
		// e.g. segment "与半半子_可畏兔兔_Cosplay"
		if m := p.dualPersonRE.FindStringSubmatch(seg); len(m) >= 2 {
			dualPart := strings.TrimSpace(m[1])
			// Try to extract model name after "与"
			if name, ok := p.matchModelInText(dualPart); ok {
				protagonists = append(protagonists, name)
				continue
			}
		}

		// If segment contains "与" within it (not at start), split
		if idx := strings.Index(seg, "与"); idx > 0 {
			partA := strings.TrimSpace(seg[:idx])
			partB := strings.TrimSpace(seg[idx+utf8.RuneLen('与'):])
			if nameA, ok := p.matchModelInText(partA); ok {
				protagonists = append(protagonists, nameA)
			}
			if nameB, ok := p.matchModelInText(partB); ok {
				protagonists = append(protagonists, nameB)
			}
		}
	}

	// Fallback: if no model found via segment classification,
	// try substring matching across all segments
	if len(protagonists) == 0 {
		for _, seg := range segments {
			if name, ok := p.matchModelInText(seg); ok {
				protagonists = append(protagonists, name)
				break // take first match
			}
		}
	}

	// Heuristic fallback: extract unknown model name from the FIRST
	// non-classified segment only. Cosplay titles use a consistent
	// structure where the model name appears before the first separator.
	// Checking later segments (descriptions, costume types) causes
	// false positives like "秋山兔女郎" being mistaken for a model name.
	if len(protagonists) == 0 && len(segments) >= 2 {
		if !infos[0].isGameChar && !infos[0].isCount && !infos[0].isCosTag {
			if isPlausibleModelName(segments[0]) {
				protagonists = append(protagonists, strings.TrimSpace(segments[0]))
			}
		}
	}

	return uniqueStrings(protagonists)
}

// expandModelName checks whether the canonical model name matches the
// segment text after whitespace normalization, or is a proper prefix
// with a Latin-only suffix. When true, returns the segment text as the
// expanded name so the display matches the actual title text.
//
// Examples:
//   canonical="KANEKO咔喵" segment="KANEKO 咔喵" → "KANEKO 咔喵" (space diff)
//   canonical="星之迟迟"  segment="星之迟迟Hoshilily" → "星之迟迟Hoshilily"
func (p *Parser) expandModelName(canonical, segment string) string {
	// Case 1: segment equals canonical when whitespace is collapsed.
	// Return the canonical name so that underscores and spaces are
	// normalized to the database form (e.g., "KANEKO_咔喵" → "KANEKO咔喵").
	if collapseSpaces(segment) == collapseSpaces(canonical) {
		return canonical
	}

	lowerCanon := strings.ToLower(canonical)
	lowerSeg := strings.ToLower(segment)

	if !strings.HasPrefix(lowerSeg, lowerCanon) {
		return canonical
	}

	suffix := segment[len(canonical):]
	if suffix == "" {
		return canonical
	}

	// Accept suffix if it's purely Latin/alphanumeric (English alias)
	for _, r := range suffix {
		if !isAlphaNum(r) || r > 127 {
			return canonical
		}
	}

	return segment
}

// matchModelInText searches for a model name anywhere in text, handling
// the case where a model name is embedded in a longer string.
func (p *Parser) matchModelInText(text string) (string, bool) {
	if name, ok := p.scoredMatch(text); ok {
		return name, true
	}

	chunks := regexp.MustCompile(`[_ ]`).Split(text, 2)
	if name, ok := p.scoredMatch(chunks[0]); ok {
		return name, true
	}

	return "", false
}

// ── Stage 5a: Game character extraction ──

func (p *Parser) extractGameCharacters(segments []string, infos []segInfo) []string {
	var chars []string
	seen := make(map[string]bool)

	for i := range segments {
		if infos[i].isGameChar {
			for _, gc := range infos[i].gameChars {
				if !seen[gc] {
					seen[gc] = true
					chars = append(chars, gc)
				}
			}
		}
		// Also scan segment text for game character names
		extra := p.matchGameChar(segments[i])
		for _, gc := range extra {
			if !seen[gc] {
				seen[gc] = true
				chars = append(chars, gc)
			}
		}
	}

	return chars
}

// ── Stage 5b: Description building ──

func (p *Parser) buildDescription(segments []string, infos []segInfo, protagonists []string) string {
	protoSet := make(map[string]bool)
	for _, p := range protagonists {
		protoSet[strings.ToLower(p)] = true
	}

	var parts []string
	for i := range segments {
		if infos[i].isCount || infos[i].isCosTag {
			continue
		}
		if infos[i].isModel {
			continue
		}
		if infos[i].isGameChar {
			continue
		}
		// Also skip if segment contains protagonist name
		lower := strings.ToLower(segments[i])
		skip := false
		for proto := range protoSet {
			if strings.Contains(lower, strings.ToLower(proto)) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		parts = append(parts, segments[i])
	}

	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, " ")
}

// ── Confidence calculation ──

func (p *Parser) calcConfidence(segments []string, infos []segInfo, protagonists []string) float64 {
	if len(segments) == 0 || len(protagonists) == 0 {
		return 0
	}
	// Simple heuristic: ratio of classified vs unclassified segments
	classified := 0
	for i := range segments {
		if infos[i].isModel || infos[i].isGameChar || infos[i].isCount || infos[i].isCosTag {
			classified++
		}
	}
	conf := float64(classified) / float64(len(segments))
	if conf > 1.0 {
		conf = 1.0
	}
	if conf < 0.3 {
		conf = 0.3
	}
	return conf
}

// ── Utilities ──

// StripCosplayPreamble removes known cosplay-preamble prefixes from
// the beginning of a title. Prefixes like "COS福利", "Cosplay", "Coser"
// are site-added metadata, not part of the model name or description.
func StripCosplayPreamble(title string) string {
	preambles := []string{
		"Cosplay", "COSPLAY", "cosplay",
		"COS福利", "Cos福利", "cos福利",
		"Coser", "COSER", "coser",
		"JK制服", "jk制服",
	}
	for _, p := range preambles {
		if strings.HasPrefix(title, p) {
			rest := title[len(p):]
			if rest == "" {
				return strings.TrimSpace(rest)
			}
			next := firstRune(rest)
			// Strip if next char is not alpha-num, or if the boundary
			// crosses script families (e.g. CJK preamble → Latin model).
			if !isAlphaNum(next) || scriptOf(next) != scriptOf(lastRune(p)) {
				return strings.TrimSpace(rest)
			}
		}
	}
	return title
}

func isCJK(r rune) bool {
	return r >= 0x4E00 && r <= 0x9FFF
}

// collapseSpaces removes all whitespace from a string, enabling
// fuzzy comparison between "KANEKO 咔喵" and "KANEKO咔喵".
func collapseSpaces(s string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '_' {
			return -1
		}
		return r
	}, s)
}

func lastRune(s string) rune {
	if s == "" {
		return 0
	}
	var r rune
	for _, c := range s {
		r = c
	}
	return r
}

func firstRune(s string) rune {
	for _, c := range s {
		return c
	}
	return 0
}

func scriptOf(r rune) int {
	if isCJK(r) {
		return 1
	}
	if isAlphaNum(r) {
		return 2
	}
	return 0
}

// ── Directory name normalization ──

func uniqueStrings(in []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, s := range in {
		if s == "" {
			continue
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// ── Directory name normalization ──

// NormalizeDirectoryName collapses separator differences (space vs
// underscore vs hyphen) and full/half-width variants into a canonical
// form suitable for filesystem paths and duplicate detection.
//
// Examples:
//
//	"Irisuare - (愛莉) - 下江小春：..." → "irisuare (愛莉) 下江小春:..."
//	"Irisuare - (愛莉)_-_下江小春：..." → "irisuare (愛莉) 下江小春:..."
func NormalizeDirectoryName(name string) string {
	n := strings.ToLower(name)

	// Collapse ALL separator-like characters to a single space
	n = regexp.MustCompile(`[\s\-–—_]+`).ReplaceAllString(n, " ")

	// Normalize full-width punctuation to half-width
	replacements := map[string]string{
		"：": ":", "（": "(", "）": ")",
		"！": "!", "？": "?", "【": "[", "】": "]",
		"；": ";", "，": ",", "。": ".",
	}
	for full, half := range replacements {
		n = strings.ReplaceAll(n, full, half)
	}

	// Collapse multiple spaces
	n = regexp.MustCompile(`\s+`).ReplaceAllString(n, " ")
	// Trim photo/video counts (with or without leading space/underscore)
	n = regexp.MustCompile(`[\s_]*\d+[pP](\d+[vV])?(\s*_?\d+[pP](\d+[vV])?)*$`).ReplaceAllString(n, "")
	// Trim trailing file size info like [81P1V-1.63GB]
	n = regexp.MustCompile(`\s*\[.*?\]$`).ReplaceAllString(n, "")

	return strings.TrimSpace(n)
}

// AreTitlesSimilar returns true if two directory names are considered
// the same after normalization. A small Levenshtein tolerance could
// be added later for fuzzy matching.
func AreTitlesSimilar(a, b string) bool {
	return NormalizeDirectoryName(a) == NormalizeDirectoryName(b)
}

// ── JSON import helpers ──

// LoadModelsFromJSON parses models from embedded JSON bytes.
func LoadModelsFromJSON(data []byte) ([]ModelEntry, error) {
	var wrapper struct {
		Models []struct {
			Name    string   `json:"name"`
			Pinyin  string   `json:"pinyin"`
			Aliases []string `json:"aliases"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &wrapper); err != nil {
		return nil, fmt.Errorf("parse models JSON: %w", err)
	}
	result := make([]ModelEntry, len(wrapper.Models))
	for i, m := range wrapper.Models {
		result[i] = ModelEntry{
			Name:    m.Name,
			Pinyin:  m.Pinyin,
			Aliases: m.Aliases,
		}
	}
	return result, nil
}

// LoadGameCharactersFromJSON parses a single per-game JSON file into
// GameCharEntry slices. Each entry inherits the game's name/en from
// the file's top-level fields.
//
// JSON shape (one file per game):
//
//	{
//	  "name": "原神",
//	  "nameEn": "Genshin Impact",
//	  "characters": [
//	    {"name": "雷电将军", "pinyin": "...", "aliases": [...]}
//	  ]
//	}
func LoadGameCharactersFromJSON(data []byte) ([]GameCharEntry, error) {
	var game struct {
		Name       string `json:"name"`
		NameEn     string `json:"nameEn"`
		Characters []struct {
			Name    string   `json:"name"`
			Pinyin  string   `json:"pinyin"`
			Aliases []string `json:"aliases"`
		} `json:"characters"`
	}
	if err := json.Unmarshal(data, &game); err != nil {
		return nil, fmt.Errorf("parse game chars JSON: %w", err)
	}
	var result []GameCharEntry
	for _, c := range game.Characters {
		result = append(result, GameCharEntry{
			Name:     c.Name,
			Pinyin:   c.Pinyin,
			Aliases:  c.Aliases,
			GameName: game.Name,
			GameEn:   game.NameEn,
		})
	}
	return result, nil
}
