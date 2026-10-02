package titleparser

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"backend/internal/xutil"
)

// ParseResult holds the output of title parsing.
type ParseResult struct {
	Protagonist      string
	Description      string
	GameCharacters   []string
	RecognizedModels []string
	Segments         []string
	Confidence       float64
	KnownMatch       bool
}

// ModelEntry is a read-only view of a cosplay model for matching.
type ModelEntry struct {
	Name    string   `json:"name"`
	Pinyin  string   `json:"pinyin"`
	Aliases []string `json:"aliases"`
}

// GameCharEntry is a read-only view of a game character for matching.
type GameCharEntry struct {
	Name     string   `json:"name"`
	Pinyin   string   `json:"pinyin"`
	Aliases  []string `json:"aliases"`
	GameName string   `json:"game_name"`
	GameEn   string   `json:"game_name_en"`
}

// segInfo holds classification results for a single title segment.
type segInfo struct {
	text       string
	isModel    bool
	modelName  string // canonical model name
	isGameChar bool
	gameChars  []string // game character names
	isCount    bool     // photo/video count
	isCosTag   bool     // cosplay tag
	isDesc     bool     // description fragment
}

// Parser is the title parsing engine. It requires model and character
// data to be loaded via LoadModels / LoadGameCharacters before use.
type Parser struct {
	mu     sync.RWMutex
	models map[string]*ModelEntry    // keyed by lowercase name
	chars  map[string]*GameCharEntry // keyed by lowercase name

	modelAliasIndex map[string]string // lowercase alias → canonical name
	charAliasIndex  map[string]string // lowercase alias → canonical name

	// 2-rune prefix → list of model/alias keys for fast substring matching
	modelPrefixIndex map[string][]string
	aliasPrefixIndex map[string][]string

	separatorRE  *regexp.Regexp
	photoCountRE *regexp.Regexp
	videoCountRE *regexp.Regexp
	dualPersonRE *regexp.Regexp
	cosplayTagRE *regexp.Regexp
}

// New creates a ready-to-use Parser with pre-compiled patterns.
// Call LoadModels / LoadGameCharacters before parsing.
func New() *Parser {
	return &Parser{
		models:           make(map[string]*ModelEntry),
		chars:            make(map[string]*GameCharEntry),
		modelAliasIndex:  make(map[string]string),
		charAliasIndex:   make(map[string]string),
		modelPrefixIndex: make(map[string][]string),
		aliasPrefixIndex: make(map[string][]string),
		separatorRE:      regexp.MustCompile(`\s*[-–—]\s*|_\s*-\s*_|\s*[|｜]\s*|[《》：:]`),
		photoCountRE:     regexp.MustCompile(`(?i)^\d+[Pp](\d+[Vv])?(_?\d+[Pp](\d+[Vv])?)*$`),
		videoCountRE:     regexp.MustCompile(`(?i)^\d+[Vv]$`),
		dualPersonRE:     regexp.MustCompile(`^[与和]\s*(\S.+)`),
		cosplayTagRE:     regexp.MustCompile(`(?i)(Cosplay|COS|写真合集|写真|图包|同人|福利|套图)$`),
	}
}

// LoadModels populates the parser's model database from a slice of entries and
// builds a 2-rune prefix inverted index for fast substring matching. It takes
// the parser lock, so it may be called at any time, including while parsing.
func (p *Parser) LoadModels(models []ModelEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range models {
		models[i].Name = xutil.CleanText(models[i].Name)
		models[i].Pinyin = xutil.CleanText(models[i].Pinyin)
		models[i].Aliases = xutil.CleanActorList(models[i].Aliases)
		m := &models[i]
		if m.Name == "" {
			continue
		}
		key := xutil.MetadataKey(m.Name)
		p.models[key] = m
		for _, alias := range m.Aliases {
			ak := xutil.MetadataKey(alias)
			if ak == "" || ak == key {
				continue
			}
			if _, exists := p.modelAliasIndex[ak]; !exists {
				p.modelAliasIndex[ak] = m.Name
			}
			p.addToPrefixIndex(p.aliasPrefixIndex, ak)
		}
		p.addToPrefixIndex(p.modelPrefixIndex, key)
	}
}

func (p *Parser) addToPrefixIndex(idx map[string][]string, key string) {
	prefixes := extractPrefixes(key, 2)
	for _, prefix := range prefixes {
		found := false
		for _, existing := range idx[prefix] {
			if existing == key {
				found = true
				break
			}
		}
		if !found {
			idx[prefix] = append(idx[prefix], key)
		}
	}
}

func extractPrefixes(s string, n int) []string {
	runes := []rune(s)
	if len(runes) < n {
		return nil
	}
	result := make([]string, 0, len(runes)-n+1)
	for i := 0; i <= len(runes)-n; i++ {
		result = append(result, string(runes[i:i+n]))
	}
	return result
}

// LoadGameCharacters populates the parser's game character database. It takes
// the parser lock, so it may be called at any time, including while parsing.
func (p *Parser) LoadGameCharacters(chars []GameCharEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range chars {
		chars[i].Name = xutil.CleanText(chars[i].Name)
		chars[i].Pinyin = xutil.CleanText(chars[i].Pinyin)
		chars[i].Aliases = xutil.CleanActorList(chars[i].Aliases)
		c := &chars[i]
		if c.Name == "" {
			continue
		}
		key := xutil.MetadataKey(c.Name)
		p.chars[key] = c
		for _, alias := range c.Aliases {
			ak := xutil.MetadataKey(alias)
			if ak == "" || ak == key {
				continue
			}
			if _, exists := p.charAliasIndex[ak]; !exists {
				p.charAliasIndex[ak] = c.Name
			}
		}
	}
}

// rawTitle should already have publisher prefixes/suffixes stripped.
func (p *Parser) Parse(rawTitle string) *ParseResult {
	if strings.TrimSpace(rawTitle) == "" {
		return &ParseResult{}
	}

	p.mu.RLock()
	defer p.mu.RUnlock()

	result := &ParseResult{Confidence: 0}

	title := regexp.MustCompile(`^\[.*?\]\s*`).ReplaceAllString(rawTitle, "")
	title = StripCosplayPreamble(title)
	title = xutil.CleanText(title)
	if title == "" {
		return result
	}

	segments := p.smartSegment(title)
	result.Segments = segments

	if len(segments) == 0 {
		return result
	}

	infos := make([]segInfo, len(segments))
	for i, seg := range segments {
		infos[i] = p.classifySegment(seg)
	}

	protagonists, recognizedModels := p.detectProtagonists(segments, infos)

	gameChars := p.extractGameCharacters(segments, infos)
	description := p.buildDescription(segments, infos, protagonists)

	result.Protagonist = strings.Join(protagonists, "与")
	result.RecognizedModels = append([]string(nil), recognizedModels...)
	result.KnownMatch = len(recognizedModels) > 0
	result.Description = description
	result.GameCharacters = gameChars
	if len(protagonists) > 0 {
		result.Confidence = p.calcConfidence(segments, infos, protagonists)
	}

	return result
}

func (p *Parser) RecognizeModels(rawTitle string) []string {
	parsed := p.Parse(rawTitle)
	if parsed == nil || !parsed.KnownMatch {
		return nil
	}
	return append([]string(nil), parsed.RecognizedModels...)
}

func (p *Parser) NormalizeActors(values []string, title string) []string {
	cleaned := xutil.CleanActorList(values)
	titleModels := p.RecognizeModels(title)

	p.mu.RLock()
	actors := make([]string, 0, len(cleaned)+len(titleModels))
	for _, actor := range cleaned {
		if name, ok := p.scoredMatch(actor); ok {
			actors = append(actors, name)
			continue
		}
		if characters := p.matchGameChar(actor); len(characters) > 0 {
			actors = append(actors, characters...)
			continue
		}
		actors = append(actors, actor)
	}
	p.mu.RUnlock()

	return xutil.MergeMetadata(actors, titleModels)
}

func (p *Parser) RemoveActorsFromTags(tags, actors []string) []string {
	excluded := append([]string(nil), actors...)
	p.mu.RLock()
	for _, actor := range actors {
		key := xutil.MetadataKey(actor)
		if name, ok := p.modelAliasIndex[key]; ok {
			key = xutil.MetadataKey(name)
		}
		if model, ok := p.models[key]; ok {
			excluded = append(excluded, model.Name)
			excluded = append(excluded, model.Aliases...)
		}
		if name, ok := p.charAliasIndex[key]; ok {
			key = xutil.MetadataKey(name)
		}
		if character, ok := p.chars[key]; ok {
			excluded = append(excluded, character.Name)
			excluded = append(excluded, character.Aliases...)
		}
	}
	p.mu.RUnlock()
	return xutil.RemoveMetadataValues(tags, excluded)
}

func (p *Parser) classifySegment(seg string) segInfo {
	info := segInfo{text: seg}

	if p.photoCountRE.MatchString(seg) || p.videoCountRE.MatchString(seg) {
		info.isCount = true
		return info
	}

	if p.cosplayTagRE.MatchString(strings.ToLower(seg)) {
		info.isCosTag = true
		return info
	}

	// Game character DB has higher priority than model DB
	if gc := p.matchGameChar(seg); len(gc) > 0 {
		info.isGameChar = true
		info.gameChars = gc
		return info
	}

	if name, ok := p.scoredMatch(seg); ok {
		info.isModel = true
		info.modelName = name
		return info
	}

	if p.containsGameName(seg) {
		info.isGameChar = true
		return info
	}

	info.isDesc = true
	return info
}

func (p *Parser) matchGameChar(seg string) []string {
	lower := xutil.MetadataKey(seg)
	var found []string

	if c, ok := p.chars[lower]; ok {
		return []string{c.Name}
	}

	if name, ok := p.charAliasIndex[lower]; ok {
		if c, ok2 := p.chars[xutil.MetadataKey(name)]; ok2 {
			return []string{c.Name}
		}
	}

	for key, c := range p.chars {
		if utf8.RuneCountInString(key) >= 2 && strings.Contains(lower, key) {
			found = append(found, c.Name)
		}
	}
	for alias, name := range p.charAliasIndex {
		if utf8.RuneCountInString(alias) >= 2 && strings.Contains(lower, alias) {
			if c, ok := p.chars[xutil.MetadataKey(name)]; ok {
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

	sort.Strings(found)
	return found
}

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

func (p *Parser) detectProtagonists(segments []string, infos []segInfo) ([]string, []string) {
	var protagonists []string
	var recognizedModels []string

	for i := range segments {
		seg := segments[i]

		if i == 0 {
			if idx := strings.Index(seg, "&"); idx > 0 {
				partA := strings.TrimSpace(seg[:idx])
				partB := strings.TrimSpace(seg[idx+1:])
				if partA != "" && partB != "" && isPlausibleModelName(partA) {
					nameA, matchedA := p.matchModelInText(partA)
					nameB, matchedB := p.matchModelInText(partB)
					if matchedA {
						protagonists = append(protagonists, nameA)
						recognizedModels = append(recognizedModels, nameA)
					} else {
						protagonists = append(protagonists, partA)
					}
					if matchedB {
						protagonists = append(protagonists, nameB)
						recognizedModels = append(recognizedModels, nameB)
					} else {
						protagonists = append(protagonists, partB)
					}
					continue
				}
			}
		}

		if infos[i].isModel {
			if i > 0 && !strings.HasPrefix(strings.ToLower(seg), strings.ToLower(infos[i].modelName)) {
				continue
			}
			protagonists = append(protagonists, infos[i].modelName)
			recognizedModels = append(recognizedModels, infos[i].modelName)
			continue
		}

		if m := p.dualPersonRE.FindStringSubmatch(seg); len(m) >= 2 {
			dualPart := strings.TrimSpace(m[1])
			if name, ok := p.matchModelInText(dualPart); ok {
				protagonists = append(protagonists, name)
				recognizedModels = append(recognizedModels, name)
				continue
			}
		}

		if idx := strings.Index(seg, "与"); idx > 0 {
			partA := strings.TrimSpace(seg[:idx])
			partB := strings.TrimSpace(seg[idx+utf8.RuneLen('与'):])
			if nameA, ok := p.matchModelInText(partA); ok {
				protagonists = append(protagonists, nameA)
				recognizedModels = append(recognizedModels, nameA)
			}
			if nameB, ok := p.matchModelInText(partB); ok {
				protagonists = append(protagonists, nameB)
				recognizedModels = append(recognizedModels, nameB)
			}
		}
	}

	if len(protagonists) == 0 {
		for i, seg := range segments {
			if name, ok := p.matchModelInText(seg); ok {
				if i > 0 && !strings.HasPrefix(strings.ToLower(seg), strings.ToLower(name)) {
					continue
				}
				protagonists = append(protagonists, name)
				recognizedModels = append(recognizedModels, name)
				break
			}
		}
	}

	if len(protagonists) == 0 && len(segments) >= 2 {
		if !infos[0].isGameChar && !infos[0].isCount && !infos[0].isCosTag {
			if isPlausibleModelName(segments[0]) {
				protagonists = append(protagonists, strings.TrimSpace(segments[0]))
			}
		}
	}

	return xutil.UniqueStrings(protagonists, false), xutil.UniqueStrings(recognizedModels, false)
}

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

func (p *Parser) calcConfidence(segments []string, infos []segInfo, protagonists []string) float64 {
	if len(segments) == 0 || len(protagonists) == 0 {
		return 0
	}
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

// StripCosplayPreamble removes known cosplay-preamble prefixes from the
// beginning of a title. These prefixes are site-added metadata, not part of
// the model name or the description.
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
			// A preamble prefix only ends at a script boundary, otherwise
			// short Latin preambles would truncate real model names.
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
