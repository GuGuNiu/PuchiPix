package i18n

import (
	"context"
	"net/http"
	"regexp"
)

type localeCtxKey struct{}

// WithLocale stores a locale string in the context so downstream
// handlers and services can retrieve it via LocaleFromContext.
func WithLocale(ctx context.Context, locale string) context.Context {
	return context.WithValue(ctx, localeCtxKey{}, locale)
}

// LocaleFromContext extracts the locale stored by WithLocale, falling
// back to the default locale if absent.
func LocaleFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(localeCtxKey{}).(string); ok && v != "" {
		return v
	}
	return DefaultLocale
}

// SetLocaleFromHeaders detects the locale from HTTP headers and returns
// it. Unlike the TypeScript version which mutates a global, this is a
// pure function ??callers should store the result in the request context
// via WithLocale.
func SetLocaleFromHeaders(headers http.Header) string {
	return DetectLocale(headers)
}

// paramRe matches {paramName} placeholders for interpolation.
var paramRe = regexp.MustCompile(`\{(\w+)\}`)

// interpolate replaces {paramName} placeholders with actual values
// from the params map. Unmatched placeholders are left intact.
func interpolate(template string, params map[string]string) string {
	if len(params) == 0 {
		return template
	}
	return paramRe.ReplaceAllStringFunc(template, func(match string) string {
		key := match[1 : len(match)-1]
		if val, ok := params[key]; ok {
			return val
		}
		return match
	})
}

// T translates a key to the given locale with optional {param} interpolation.
// Fallback chain: current locale ??zh-CN ??raw key.
func T(locale, key string, params ...map[string]string) string {
	loaded, err := loadDicts()
	if err != nil || loaded == nil {
		return key
	}

	var template string
	if d, ok := loaded[locale]; ok {
		if v, ok2 := d[key]; ok2 {
			template = v
		}
	}

	if template == "" {
		if d, ok := loaded[DefaultLocale]; ok {
			if v, ok2 := d[key]; ok2 {
				template = v
			}
		}
	}

	if template == "" {
		return key
	}

	if len(params) > 0 && params[0] != nil {
		return interpolate(template, params[0])
	}
	return template
}

// TCtx translates a key using the locale stored in the context.
// This is the primary translation function for HTTP handlers.
func TCtx(ctx context.Context, key string, params ...map[string]string) string {
	return T(LocaleFromContext(ctx), key, params...)
}

// TFromRequest is a convenience wrapper that extracts the locale from
// the request context and translates the key.
func TFromRequest(r *http.Request, key string, params ...map[string]string) string {
	return TCtx(r.Context(), key, params...)
}
