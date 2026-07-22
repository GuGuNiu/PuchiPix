package i18n

import (
	"context"
	"net/http"
	"testing"
)

func TestSupportedLocales(t *testing.T) {
	locs := SupportedLocales()
	expectedCount := 12
	if len(locs) != expectedCount {
		t.Errorf("Expected %d locales, got %d", expectedCount, len(locs))
	}

	expected := []string{
		"zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR",
		"ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID",
	}
	for i, loc := range locs {
		if loc != expected[i] {
			t.Errorf("Expected locale %s at index %d, got %s", expected[i], i, loc)
		}
	}
}

func TestIsSupported(t *testing.T) {
	tests := []struct {
		locale   string
		expected bool
	}{
		{"zh-CN", true},
		{"en-US", true},
		{"id-ID", true},
		{"xx-XX", false},
		{"", false},
		{"zh", false},
	}

	for _, tt := range tests {
		if got := IsSupported(tt.locale); got != tt.expected {
			t.Errorf("IsSupported(%q) = %v, want %v", tt.locale, got, tt.expected)
		}
	}
}

func TestParseLangTag(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"zh-CN", "zh-CN"},
		{"zh-TW", "zh-TW"},
		{"en-US", "en-US"},
		{"en", "en-US"},
		{"ja", "ja-JP"},
		{"ko", "ko-KR"},
		{"zh-HK", "zh-TW"},
		{"zh-Hant", "zh-TW"},
		{"id", "id-ID"},
		{"in", "id-ID"},
		{"xx", ""},
		{"", ""},
	}

	for _, tt := range tests {
		if got := ParseLangTag(tt.input); got != tt.expected {
			t.Errorf("ParseLangTag(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestLocaleFromAcceptHeader(t *testing.T) {
	tests := []struct {
		header   string
		expected string
	}{
		{"zh-CN,zh;q=0.9,en;q=0.8", "zh-CN"},
		{"en-US,en;q=0.9", "en-US"},
		{"ja,en;q=0.9", "ja-JP"},
		{"*", DefaultLocale},
		{"", DefaultLocale},
		{"xx-XX,en;q=0.9", "en-US"},
		{"zh-HK,en;q=0.9", "zh-TW"},
	}

	for _, tt := range tests {
		if got := LocaleFromAcceptHeader(tt.header); got != tt.expected {
			t.Errorf("LocaleFromAcceptHeader(%q) = %q, want %q", tt.header, got, tt.expected)
		}
	}
}

func TestDetectLocale(t *testing.T) {
	tests := []struct {
		name   string
		headers map[string]string
		want    string
	}{
		{
			name:   "x-locale header takes priority",
			headers: map[string]string{"x-locale": "en-US"},
			want:    "en-US",
		},
		{
			name:   "cookie when no x-locale",
			headers: map[string]string{"Cookie": "locale=ja-JP"},
			want:    "ja-JP",
		},
		{
			name:   "Accept-Language when no cookie",
			headers: map[string]string{"Accept-Language": "zh-CN,zh;q=0.9"},
			want:    "zh-CN",
		},
		{
			name:   "default when no headers",
			headers: map[string]string{},
			want:    DefaultLocale,
		},
		{
			name:   "x-locale over cookie",
			headers: map[string]string{"x-locale": "en-US", "Cookie": "locale=ja-JP"},
			want:    "en-US",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := make(http.Header)
			for k, v := range tt.headers {
				h.Set(k, v)
			}
			if got := DetectLocale(h); got != tt.want {
				t.Errorf("DetectLocale() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestWithLocaleAndLocaleFromContext(t *testing.T) {
	ctx := context.Background()
	locale := "en-US"

	ctx = WithLocale(ctx, locale)
	got := LocaleFromContext(ctx)

	if got != locale {
		t.Errorf("LocaleFromContext() = %q, want %q", got, locale)
	}
}

func TestTFallback(t *testing.T) {
	tests := []struct {
		locale string
		key    string
		want   string
	}{
		{"zh-CN", "nav.dashboard", "���ڴ���"},
		{"en-US", "nav.dashboard", "Puchi Hall"},
		{"xx-XX", "nav.dashboard", "���ڴ���"},
		{"zh-CN", "common.refresh", "ˢ��"},
		{"en-US", "common.refresh", "Refresh"},
		{"xx-XX", "common.refresh", "ˢ��"},
		{"zh-CN", "nonexistent.key", "nonexistent.key"},
	}

	for _, tt := range tests {
		if got := T(tt.locale, tt.key); got != tt.want {
			t.Errorf("T(%q, %q) = %q, want %q", tt.locale, tt.key, got, tt.want)
		}
	}
}

func TestTWithParams(t *testing.T) {
	tests := []struct {
		locale string
		key    string
		params map[string]string
		want   string
	}{
		{"zh-CN", "tasks.deleted", map[string]string{"type": "ͼ��", "id": "42"}, "��ɾ��ͼ??#42"},
		{"en-US", "tasks.deleted", map[string]string{"type": "Gallery", "id": "42"}, "Deleted Gallery #42"},
		{"zh-CN", "api.gallery.notFound", nil, "ͼ�ⲻ��??},
	}

	for _, tt := range tests {
		if got := T(tt.locale, tt.key, tt.params); got != tt.want {
			t.Errorf("T(%q, %q, %v) = %q, want %q", tt.locale, tt.key, tt.params, got, tt.want)
		}
	}
}

func TestTCtx(t *testing.T) {
	ctx := context.Background()
	ctx = WithLocale(ctx, "zh-CN")

	got := TCtx(ctx, "nav.dashboard")
	want := "���ڴ���"

	if got != want {
		t.Errorf("TCtx() = %q, want %q", got, want)
	}
}

func TestAllKeys(t *testing.T) {
	keys := AllKeys()
	if len(keys) == 0 {
		t.Fatal("AllKeys() returned empty slice")
	}

	// Check for some known keys
	knownKeys := []string{"nav.dashboard", "common.refresh", "api.gallery.notFound"}
	for _, k := range knownKeys {
		found := false
		for _, key := range keys {
			if key == k {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected key %q in AllKeys() result", k)
		}
	}
}
