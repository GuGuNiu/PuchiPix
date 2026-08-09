package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
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

// TranslationDict is a flat dot-notation key→string map, mirroring the
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
