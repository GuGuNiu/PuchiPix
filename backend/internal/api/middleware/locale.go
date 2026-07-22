package middleware

import (
	"context"
	"net/http"

	"backend/internal/i18n"
)

// LocaleDetection mirrors the TypeScript SetLocaleFromHeaders logic:
// x-locale header takes priority, then the locale cookie, then the
// Accept-Language header, falling back to zh-CN. The detected locale
// is stored in the request context via i18n.WithLocale so handlers
// can call i18n.TCtx / i18n.TFromRequest without manual extraction.
func LocaleDetection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		locale := i18n.SetLocaleFromHeaders(r.Header)
		ctx := i18n.WithLocale(r.Context(), locale)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetLocale extracts the locale set by LocaleDetection. Kept for
// backward compatibility with handlers that read the locale directly.
func GetLocale(ctx context.Context) string {
	return i18n.LocaleFromContext(ctx)
}
