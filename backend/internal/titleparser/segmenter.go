package titleparser

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

type pairedDelim struct {
	open  rune
	close rune
}

// CJK book title marks 《》 are the primary target; additional brackets
// such as 【】「」『』 can be added here as needed.
var defaultPairedDelims = []pairedDelim{
	{'《', '》'},
}

// smartSegment splits a raw title into segments using a multi-pass
// hierarchical algorithm. When no paired delimiters are present it
// falls back to the legacy regex-based segmenter for zero overhead.
func (p *Parser) smartSegment(title string) []string {
	var segments []string
	if !containsPairedDelim(title) {
		segments = segmentLegacy(title, p.separatorRE)
	} else {
		segments = segmentPaired(title, p.separatorRE)
	}
	return splitCrossScriptSpaces(segments)
}

func containsPairedDelim(title string) bool {
	for _, pd := range defaultPairedDelims {
		if strings.ContainsRune(title, pd.open) || strings.ContainsRune(title, pd.close) {
			return true
		}
	}
	return false
}

func segmentLegacy(title string, sepRE *regexp.Regexp) []string {
	parts := sepRE.Split(title, -1)
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

// segmentPaired extracts paired-delimiter content, splits the remaining
// text on explicit separators, then reinserts the extracted content.
// Paired content is replaced with indexed placeholder tokens that survive
// the regex split, then expanded back to original text in the final pass.
func segmentPaired(title string, sepRE *regexp.Regexp) []string {
	placeholders, replaced := extractPairedContent(title, defaultPairedDelims)
	segments := segmentLegacy(replaced, sepRE)
	return expandPlaceholders(segments, placeholders)
}

const placeholderPrefix = "##SEG_"
const placeholderSuffix = "##"

type bracketRegion struct {
	start   int
	end     int
	content string
}

// extractPairedContent locates every paired-delimiter region in text,
// extracts the inner content, and replaces each region with a numbered
// placeholder token so it survives the separator-based split pass.
func extractPairedContent(text string, delims []pairedDelim) (map[string]string, string) {
	var regions []bracketRegion
	for _, pd := range delims {
		regions = findPairedRegions(text, pd.open, pd.close)
	}

	if len(regions) == 0 {
		return nil, text
	}

	placeholders := make(map[string]string, len(regions))
	var result strings.Builder
	result.Grow(len(text))
	pos := 0

	for i, r := range regions {
		result.WriteString(text[pos:r.start])
		ph := placeholderFor(i)
		result.WriteString(ph)
		placeholders[ph] = r.content
		pos = r.end
	}
	result.WriteString(text[pos:])

	return placeholders, result.String()
}

// findPairedRegions scans text rune-by-rune using a stack of opening
// delimiter positions. Unmatched delimiters are treated as regular text.
func findPairedRegions(text string, open, close rune) []bracketRegion {
	type stackEntry struct {
		pos int
	}

	var stack []stackEntry
	var regions []bracketRegion

	pos := 0
	for _, r := range text {
		rLen := utf8.RuneLen(r)
		if r == open {
			stack = append(stack, stackEntry{pos: pos})
		} else if r == close && len(stack) > 0 {
			entry := stack[len(stack)-1]
			stack = stack[:len(stack)-1]

			contentStart := entry.pos + utf8.RuneLen(open)
			contentEnd := pos
			content := text[contentStart:contentEnd]

			regions = append(regions, bracketRegion{
				start:   entry.pos,
				end:     pos + rLen,
				content: strings.TrimSpace(content),
			})
		}
		pos += rLen
	}

	return regions
}

func expandPlaceholders(segments []string, placeholders map[string]string) []string {
	if len(placeholders) == 0 {
		return segments
	}

	result := make([]string, 0, len(segments)+len(placeholders))

	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}

		if content, ok := placeholders[seg]; ok {
			if content != "" {
				result = append(result, content)
			}
			continue
		}

		expanded := expandInlinePlaceholders(seg, placeholders)
		for _, s := range expanded {
			s = strings.TrimSpace(s)
			s = strings.TrimRight(s, " \t_-–—")
			if s != "" {
				result = append(result, s)
			}
		}
	}

	return result
}

func expandInlinePlaceholders(seg string, placeholders map[string]string) []string {
	if !strings.Contains(seg, placeholderPrefix) {
		return []string{seg}
	}

	var result []string
	remaining := seg

	for remaining != "" {
		idx := strings.Index(remaining, placeholderPrefix)
		if idx < 0 {
			result = append(result, remaining)
			break
		}

		if idx > 0 {
			before := strings.TrimSpace(remaining[:idx])
			if before != "" {
				result = append(result, before)
			}
		}

		// Search for suffix after the prefix to avoid matching the "##"
		// at the start of placeholderPrefix
		afterPrefix := remaining[idx+len(placeholderPrefix):]
		endIdx := strings.Index(afterPrefix, placeholderSuffix)
		if endIdx < 0 {
			result = append(result, strings.TrimSpace(remaining[idx:]))
			break
		}
		endIdx += idx + len(placeholderPrefix) + len(placeholderSuffix)
		ph := remaining[idx:endIdx]

		if content, ok := placeholders[ph]; ok && content != "" {
			result = append(result, content)
		}

		remaining = remaining[endIdx:]
	}

	return result
}

func placeholderFor(idx int) string {
	return placeholderPrefix + padInt(idx) + placeholderSuffix
}

func padInt(n int) string {
	if n < 10 {
		return "00" + string(rune('0'+n))
	}
	if n < 100 {
		return "0" + string(rune('0'+n/10)) + string(rune('0'+n%10))
	}
	return string(rune('0'+n/100)) + string(rune('0'+(n/10)%10)) + string(rune('0'+n%10))
}

// splitCrossScriptSpaces splits segments at whitespace boundaries where
// the characters on either side belong to different Unicode scripts
// (typically CJK ↔ Latin). Segments without a script transition at the
// space boundary are left intact to avoid splitting mixed-script names.
func splitCrossScriptSpaces(segments []string) []string {
	result := make([]string, 0, len(segments))
	for _, seg := range segments {
		sub := splitCrossScript(seg)
		result = append(result, sub...)
	}
	return result
}

func splitCrossScript(seg string) []string {
	if !strings.Contains(seg, " ") {
		return []string{seg}
	}

	var parts []string
	start := 0
	prevScript := 0
	prevSpacePos := -1

	for i, r := range seg {
		currScript := scriptOf(r)
		if r == ' ' && prevScript != 0 && currScript != prevScript && i+1 < len(seg) {
			nextR := firstRune(seg[i+utf8.RuneLen(r):])
			nextScript := scriptOf(nextR)
			if nextScript != 0 && nextScript != prevScript {
				if start < prevSpacePos+1 || start <= i {
					part := strings.TrimSpace(seg[start:i])
					if part != "" {
						parts = append(parts, part)
					}
				}
				start = i + utf8.RuneLen(r)
			}
		}
		if r != ' ' {
			prevScript = currScript
		}
		prevSpacePos = i
	}

	if start < len(seg) {
		part := strings.TrimSpace(seg[start:])
		if part != "" {
			parts = append(parts, part)
		}
	}

	if len(parts) <= 1 {
		return []string{seg}
	}
	return parts
}
