package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

// Supported locales must match src/lib/i18n/types.ts Locale union.
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

// flatLocaleUnmarshal adapts flat dot-notation JSON to the message-file
// format go-i18n expects, preserving the 1:1 mapping with the frontend dictionary.
func flatLocaleUnmarshal(data []byte, v interface{}) error {
	var flat map[string]string
	if err := json.Unmarshal(data, &flat); err != nil {
		return err
	}
	out := make(map[string]interface{}, len(flat))
	for k, val := range flat {
		out[k] = map[string]interface{}{"other": val}
	}
	// v is a *interface{} that ParseMessageFileBytes expects to fill.
	switch vv := v.(type) {
	case *interface{}:
		*vv = out
	default:
		return fmt.Errorf("i18n: unexpected unmarshal target %T", v)
	}
	return nil
}

var (
	bundleOnce sync.Once
	bundle     *i18n.Bundle
	bundleErr  error
)

// loadBundle builds the go-i18n bundle once from embedded locale files.
func loadBundle() (*i18n.Bundle, error) {
	bundleOnce.Do(func() {
		b := i18n.NewBundle(language.MustParse(DefaultLocale))
		b.RegisterUnmarshalFunc("json", flatLocaleUnmarshal)
		for _, locale := range supportedLocales {
			path := "locales/" + locale + ".json"
			data, err := localeFS.ReadFile(path)
			if err != nil {
				bundleErr = fmt.Errorf("i18n: read %s: %w", path, err)
				return
			}
			if _, err := b.ParseMessageFileBytes(data, path); err != nil {
				bundleErr = fmt.Errorf("i18n: parse %s: %w", path, err)
				return
			}
		}
		bundle = b
	})
	return bundle, bundleErr
}