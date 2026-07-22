package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

// Supported locales ??must match src/lib/i18n/types.ts Locale union.
const (
	DefaultLocale = "zh-CN"
)

var supportedLocales = []string{
	"zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR",
	"ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID",
}

var supportedSet = func() map[string]bool {
	m := make(map[string]bool, len(supportedLocales))
	for _, l := range supportedLocales {
		m[l] = true
	}
	return m
}()

//go:embed locales/*.json
var localeFS embed.FS

// TranslationDict is a flat dot-notation key��string map, mirroring the
// TypeScript TranslationDict = Record<string, string>.
type TranslationDict map[string]string

var (
	dicts     map[string]TranslationDict
	dictsOnce sync.Once
	dictsErr  error
)

// loadDicts parses all embedded JSON files once and caches the result.
func loadDicts() (map[string]TranslationDict, error) {
	dictsOnce.Do(func() {
		dicts = make(map[string]TranslationDict, len(supportedLocales))
		for _, locale := range supportedLocales {
			path := "locales/" + locale + ".json"
			data, err := localeFS.ReadFile(path)
			if err != nil {
				dictsErr = fmt.Errorf("i18n: read %s: %w", path, err)
				return
			}
			var d TranslationDict
			if err := json.Unmarshal(data, &d); err != nil {
				dictsErr = fmt.Errorf("i18n: parse %s: %w", path, err)
				return
			}
			dicts[locale] = d
		}
	})
	return dicts, dictsErr
}

// GetDict returns the TranslationDict for the given locale, falling back
// to the default locale (zh-CN) if the locale is not supported.
func GetDict(locale string) TranslationDict {
	loaded, err := loadDicts()
	if err != nil || loaded == nil {
		return nil
	}
	if d, ok := loaded[locale]; ok {
		return d
	}
	return loaded[DefaultLocale]
}

// SupportedLocales returns the list of all supported locale codes.
func SupportedLocales() []string {
	out := make([]string, len(supportedLocales))
	copy(out, supportedLocales)
	return out
}

// IsSupported reports whether the given locale code is supported.
func IsSupported(locale string) bool {
	return supportedSet[locale]
}

// AllKeys returns the sorted list of translation keys from the default
// locale dictionary. Used by the verification script to cross-check
// Go t() calls against the dictionary.
func AllKeys() []string {
	d := GetDict(DefaultLocale)
	if d == nil {
		return nil
	}
	keys := make([]string, 0, len(d))
	for k := range d {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
