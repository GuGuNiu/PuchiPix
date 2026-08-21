package i18n

import (
	"net/http"
	"strings"
)

// prefixMap maps Accept-Language prefix tags to canonical locale codes,
// mirroring the TypeScript PREFIX_MAP in detect.ts.
var prefixMap = []struct{ prefix, locale string }{
	{"zh", "zh-CN"},
	{"ja", "ja-JP"},
	{"en", "en-US"},
	{"ko", "ko-KR"},
	{"ru", "ru-RU"},
	{"de", "de-DE"},
	{"vi", "vi-VN"},
	{"es", "es-ES"},
	{"pt", "pt-BR"},
	{"fr", "fr-FR"},
	{"id", "id-ID"},
	{"in", "id-ID"},
}

// ParseLangTag normalizes a raw language tag to a supported locale code.
// Returns empty string if no match is found. Mirrors parseLangTag in detect.ts.
func ParseLangTag(lang string) string {
	trimmed := strings.TrimSpace(lang)
	if trimmed == "" {
		return ""
	}

	if supportedSet[trimmed] {
		return trimmed
	}

	if strings.HasPrefix(trimmed, "zh") {
		if strings.Contains(trimmed, "TW") || strings.Contains(trimmed, "HK") || strings.Contains(trimmed, "Hant") {
			return "zh-TW"
		}
		return "zh-CN"
	}

	lower := strings.ToLower(trimmed)
	for _, entry := range prefixMap {
		if strings.HasPrefix(lower, entry.prefix) {
			return entry.locale
		}
	}

	return ""
}

// LocaleFromAcceptHeader parses an Accept-Language header and returns
// the first matching supported locale, or the default.
func LocaleFromAcceptHeader(acceptLang string) string {
	if acceptLang == "" {
		return DefaultLocale
	}

	parts := strings.Split(acceptLang, ",")
	for _, part := range parts {
		lang := strings.TrimSpace(strings.Split(part, ";")[0])
		lang = strings.TrimSpace(lang)
		if lang == "*" || lang == "" {
			continue
		}
		lang = strings.ReplaceAll(lang, "_", "-")
		if result := ParseLangTag(lang); result != "" {
			return result
		}
	}

	return DefaultLocale
}

// LocaleFromHeader detects the locale from an x-locale header value.
func LocaleFromHeader(headerValue string) string {
	if headerValue == "" {
		return ""
	}
	return ParseLangTag(headerValue)
}

// DetectLocale resolves the locale from HTTP headers in priority order:
// x-locale header, locale cookie, Accept-Language, then default zh-CN.
func DetectLocale(headers http.Header) string {
	if v := headers.Get("x-locale"); v != "" {
		if result := LocaleFromHeader(v); result != "" {
			return result
		}
	}

	if cookie := headers.Get("Cookie"); cookie != "" {
		if v := parseCookieValue(cookie, "locale"); v != "" {
			if result := LocaleFromHeader(v); result != "" {
				return result
			}
		}
	}

	if acceptLang := headers.Get("Accept-Language"); acceptLang != "" {
		return LocaleFromAcceptHeader(acceptLang)
	}

	return DefaultLocale
}

func parseCookieValue(cookieHeader, name string) string {
	parts := strings.Split(cookieHeader, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		eq := strings.Index(part, "=")
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(part[:eq])
		v := strings.TrimSpace(part[eq+1:])
		if k == name {
			return v
		}
	}
	return ""
}
