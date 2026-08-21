package i18n_test

import (
	"strings"
	"testing"

	"backend/internal/i18n"
)

func TestAllLocalesLoaded(t *testing.T) {
	locales := []string{
		"zh-CN", "en-US", "ja-JP", "ko-KR",
		"de-DE", "es-ES", "fr-FR", "id-ID",
		"pt-BR", "ru-RU", "vi-VN", "zh-TW",
	}

	for _, locale := range locales {
		t.Run("loaded_"+locale, func(t *testing.T) {
			if result := i18n.T(locale, "nav.dashboard", nil); result == "" || result == "nav.dashboard" {
				t.Errorf("locale %s dictionary is not loaded", locale)
			}
		})
	}
}

// TestLocaleSwitching verifies that the T() function returns different
// translations for the same key across all 12 locales.
func TestLocaleSwitching(t *testing.T) {
	testKey := "nav.dashboard"

	translations := make(map[string]string)
	locales := []string{
		"zh-CN", "en-US", "ja-JP", "ko-KR",
		"de-DE", "es-ES", "fr-FR", "id-ID",
		"pt-BR", "ru-RU", "vi-VN", "zh-TW",
	}

	for _, locale := range locales {
		t.Run("translate_"+locale, func(t *testing.T) {
			result := i18n.T(locale, testKey, nil)
			if result == "" {
				t.Errorf("T(%s, %q) returned empty string", locale, testKey)
			}
			if result == testKey {
				t.Errorf("T(%s, %q) returned the key itself (translation missing)", locale, testKey)
			}
			translations[locale] = result
		})
	}

	// Verify at least zh-CN and en-US differ
	if translations["zh-CN"] == translations["en-US"] {
		t.Error("zh-CN and en-US returned the same translation for nav.dashboard")
	}
}

// TestLocaleFallback verifies that unsupported locales fall back to zh-CN.
func TestLocaleFallback(t *testing.T) {
	result := i18n.T("xx-XX", "nav.dashboard", nil)
	zhResult := i18n.T("zh-CN", "nav.dashboard", nil)

	if result != zhResult {
		t.Errorf("T(xx-XX, ...) = %q, want zh-CN fallback %q", result, zhResult)
	}
}

// TestParameterInterpolation verifies that {param} placeholders are
// correctly replaced across locales.
func TestParameterInterpolation(t *testing.T) {
	tests := []struct {
		locale string
		key    string
		params map[string]string
	}{
		{"zh-CN", "tasks.deleted", map[string]string{"type": "gallery", "id": "42"}},
		{"en-US", "tasks.deleted", map[string]string{"type": "gallery", "id": "42"}},
		{"ja-JP", "tasks.deleted", map[string]string{"type": "gallery", "id": "42"}},
	}

	for _, tt := range tests {
		t.Run("params_"+tt.locale, func(t *testing.T) {
			result := i18n.T(tt.locale, tt.key, tt.params)
			if result == "" {
				t.Errorf("T(%s, %q, %v) returned empty string", tt.locale, tt.key, tt.params)
			}
			if strings.Contains(result, "{type}") || strings.Contains(result, "{id}") {
				t.Errorf("T(%s, %q) contains unreplaced placeholder: %q", tt.locale, tt.key, result)
			}
		})
	}
}

// TestMissingKeyFallback verifies that a missing key returns the key itself.
func TestMissingKeyFallback(t *testing.T) {
	result := i18n.T("en-US", "nonexistent.key.that.does.not.exist", nil)
	if result != "nonexistent.key.that.does.not.exist" {
		t.Errorf("T with missing key returned %q, want the key itself", result)
	}
}
