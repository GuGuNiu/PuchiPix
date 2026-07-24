package titleparser

import (
	"strings"
	"unicode/utf8"
)

// pairedDelim represents a matched pair of delimiters for bracket-aware
// segmentation. Each entry pairs an opening rune with its corresponding
// closing rune.
type pairedDelim struct {
	open  rune
	close rune
}

// defaultPairedDelims lists the paired delimiters currently supported.
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

// segmentLegacy splits text on the given regex separator and trims
// whitespace and trailing punctuation from each resulting segment.
// Empty segments are discarded.
func segmentLegacy(title string, sepRE interface{ Split(string, int) []string }) []string {
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
//
// Pass 1: find all 《...》 pairs via stack matching and replace them with
// indexed placeholder tokens that survive the regex split.
// Pass 2: split the placeholder-replaced text on separatorRE.
// Pass 3: replace placeholder tokens with the original extracted content
// and trim whitespace / trailing punctuation.
func segmentPaired(title string, sepRE interface{ Split(string, int) []string }) []string {
	placeholders, replaced := extractPairedContent(title, defaultPairedDelims)
	segments := segmentLegacy(replaced, sepRE)
	return expandPlaceholders(segments, placeholders)
}

const placeholderPrefix = "##SEG_"
const placeholderSuffix = "##"

// bracketRegion records the byte offsets and inner content of a paired
// delimiter match such as 《content》.
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

// findPairedRegions scans text rune-by-rune, maintaining a stack of
// opening delimiter positions. When a closing delimiter is encountered
// and the stack is non-empty, the topmost opener is popped and a region
// is recorded. Unmatched delimiters are silently treated as regular text.
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

		// Skip over the placeholder prefix before searching for suffix
		// to avoid matching the prefix's own "__" double-underscore.
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
// (typically CJK ↔ Latin). This enables extraction of model names from
// titles like "奈莉酱帆风 Belle Ta 48P" where spaces are the only
// delimiter between a CJK model name and a Latin description.
//
// Segments that are already single-script or have no script transition
// at the space boundary are left intact to avoid splitting legitimate
// mixed-script model names like "NAGISA魔物喵".
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
				// Found cross-script space boundary — split here
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
