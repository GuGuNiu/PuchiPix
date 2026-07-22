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

// LocaleFromAcceptHeader parses an Accept-Language header value and
// returns the first matching supported locale, falling back to the
// default locale. Mirrors localeFromAcceptHeader in detect.ts.
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

// LocaleFromHeader parses a raw x-locale header value. Returns empty
// string if the value is empty or unrecognized. Mirrors localeFromHeader
// in detect.ts.
func LocaleFromHeader(headerValue string) string {
	if headerValue == "" {
		return ""
	}
	return ParseLangTag(headerValue)
}

// DetectLocale extracts the locale from HTTP headers following the
// detection order: x-locale header ??locale cookie ??Accept-Language
// header ??default zh-CN. This replaces the TypeScript
// setLocaleFromHeaders function.
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

// parseCookieValue extracts a named cookie value from a raw Cookie header.
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
