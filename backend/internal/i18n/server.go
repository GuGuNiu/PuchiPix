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

func WithLocale(ctx context.Context, locale string) context.Context {
	return context.WithValue(ctx, localeCtxKey{}, locale)
}

func LocaleFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(localeCtxKey{}).(string); ok && v != "" {
		return v
	}
	return DefaultLocale
}

func SetLocaleFromHeaders(headers http.Header) string {
	return DetectLocale(headers)
}

var paramRe = regexp.MustCompile(`\{(\w+)\}`)

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

	// Requested locale first, then the default, so unsupported locales fall
	// back to the default rather than yielding an empty message.
	// NewLocalizer silently skips unparseable locale strings.
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

func T(locale, key string, params ...map[string]string) string {
	loc := getLocalizer(locale)
	if loc == nil {
		return key
	}

	msg, err := loc.Localize(&i18n.LocalizeConfig{MessageID: key})
	if err != nil {
		return key
	}

	if len(params) > 0 && params[0] != nil {
		return interpolate(msg, params[0])
	}
	return msg
}

func TCtx(ctx context.Context, key string, params ...map[string]string) string {
	return T(LocaleFromContext(ctx), key, params...)
}

func TFromRequest(r *http.Request, key string, params ...map[string]string) string {
	return TCtx(r.Context(), key, params...)
}
