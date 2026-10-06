package middleware

import (
	"net/http"

	"backend/internal/i18n"
)

func LocaleDetection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		locale := i18n.SetLocaleFromHeaders(r.Header)
		ctx := i18n.WithLocale(r.Context(), locale)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
