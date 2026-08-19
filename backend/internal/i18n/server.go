package i18n

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/nicksnyder/go-i18n/v2/i18n"
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

// localizerCache caches a go-i18n Localizer per locale. Localizers are
// built against the shared bundle and fall back to the default locale,
// mirroring the previous locale -> zh-CN -> raw-key fallback chain.
var localizerCache = struct {
	sync.Mutex
	m map[string]*i18n.Localizer
}{m: make(map[string]*i18n.Localizer)}

func getLocalizer(locale string) *i18n.Localizer {
	if locale == "" {
		locale = DefaultLocale
	}

	localizerCache.Lock()
	defer localizerCache.Unlock()
	if l, ok := localizerCache.m[locale]; ok {
		return l
	}

	b, err := loadBundle()
	if err != nil || b == nil {
		return nil
	}

	// Build the language list: the requested locale first, then the
	// default locale so unknown locales fall back to zh-CN. NewLocalizer
	// silently skips unparseable locale strings.
	langs := []string{}
	if locale != "" {
		langs = append(langs, locale)
	}
	if !strings.EqualFold(locale, DefaultLocale) {
		langs = append(langs, DefaultLocale)
	}
	if len(langs) == 0 {
		langs = append(langs, DefaultLocale)
	}

	loc := i18n.NewLocalizer(b, langs...)
	localizerCache.m[locale] = loc
	return loc
}

// T translates a key to the given locale with optional {param} interpolation.
// Fallback chain: current locale -> zh-CN -> raw key.
func T(locale, key string, params ...map[string]string) string {
	loc := getLocalizer(locale)
	if loc == nil {
		return key
	}

	// Localize returns the message with {param} placeholders intact
	// (go-i18n only renders {{.field}} templates), so interpolation is
	// applied here to preserve the project's {param} convention.
	msg, err := loc.Localize(&i18n.LocalizeConfig{MessageID: key})
	if err != nil {
		return key
	}

	if len(params) > 0 && params[0] != nil {
		return interpolate(msg, params[0])
	}
	return msg
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
