// Package xutil provides small shared helpers used across site providers
// and the orchestrator.
package xutil

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// UniqueStrings returns a new slice with duplicate strings removed,
// preserving first-occurrence order.
func UniqueStrings(input []string, includeEmpty bool) []string {
	if len(input) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(input))
	var result []string
	for _, s := range input {
		if !includeEmpty && s == "" {
			continue
		}
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

var actorLabelPattern = regexp.MustCompile(`(?i)^(?:演员|主演|出镜|模特|model|actor|star)\s*[:：@]\s*`)

func CleanText(value string) string {
	value = norm.NFKC.String(value)
	value = strings.Map(func(r rune) rune {
		switch {
		case r == '\r' || r == '\n' || r == '\t' || unicode.IsSpace(r):
			return ' '
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		default:
			return r
		}
	}, value)
	return strings.Trim(strings.Join(strings.Fields(value), " "), " |·•・")
}

func MetadataKey(value string) string {
	return strings.ToLower(CleanText(value))
}

func uniqueMetadata(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = CleanText(value)
		key := strings.ToLower(value)
		if value == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func isMetadataNoise(value string, actor bool) bool {
	switch strings.ToLower(value) {
	case "-", "--", "n/a", "na", "nil", "none", "null", "unknown":
		return true
	case "无", "未知", "不详", "暂无", "暂无数据":
		return true
	}
	if actor {
		switch strings.ToLower(value) {
		case "作者", "发布者", "上传者", "up主", "uploader", "channel", "频道":
			return true
		}
	}
	return false
}

func cleanList(input []string, separators string, actor bool) []string {
	separatorSet := make(map[rune]struct{}, len(separators))
	for _, r := range separators {
		separatorSet[r] = struct{}{}
	}
	separatorSet['\r'] = struct{}{}
	separatorSet['\n'] = struct{}{}
	separatorSet['\t'] = struct{}{}

	var cleaned []string
	for _, raw := range input {
		parts := strings.FieldsFunc(raw, func(r rune) bool {
			_, ok := separatorSet[r]
			return ok
		})
		for _, part := range parts {
			part = CleanText(part)
			if actor {
				part = actorLabelPattern.ReplaceAllString(part, "")
				part = CleanText(part)
			}
			if part == "" || isMetadataNoise(part, actor) || utf8.RuneCountInString(part) > 120 {
				continue
			}
			cleaned = append(cleaned, part)
		}
	}
	return uniqueMetadata(cleaned)
}

func CleanTagList(input []string) []string {
	return cleanList(input, ",，、;；|｜/／", false)
}

func CleanActorList(input []string) []string {
	return cleanList(input, ",，、;；|｜/／&＆", true)
}

func MergeMetadata(lists ...[]string) []string {
	var merged []string
	for _, list := range lists {
		merged = append(merged, list...)
	}
	return uniqueMetadata(merged)
}

func RemoveMetadataValues(values, excluded []string) []string {
	if len(values) == 0 || len(excluded) == 0 {
		return UniqueStrings(values, false)
	}
	excludedKeys := make(map[string]struct{}, len(excluded))
	for _, value := range excluded {
		if key := MetadataKey(value); key != "" {
			excludedKeys[key] = struct{}{}
		}
	}
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := excludedKeys[MetadataKey(value)]; !ok {
			filtered = append(filtered, value)
		}
	}
	return UniqueStrings(filtered, false)
}
