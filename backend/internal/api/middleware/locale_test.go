package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestLocaleDetectionHeader verifies that the x-locale header takes
// priority over other detection sources, allowing the frontend to
// explicitly control the locale.
func TestLocaleDetectionHeader(t *testing.T) {
	var detected string
	handler := LocaleDetection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		detected = GetLocale(r.Context())
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("x-locale", "ja-JP")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, "ja-JP", detected)
}

// TestLocaleDetectionCookie verifies that the locale cookie is used
// when the x-locale header is absent, preserving user preference
// across page reloads.
func TestLocaleDetectionCookie(t *testing.T) {
	var detected string
	handler := LocaleDetection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		detected = GetLocale(r.Context())
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("Cookie", "locale=en-US")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, "en-US", detected)
}

// TestLocaleDetectionAcceptLanguage verifies that Accept-Language
// is used as a fallback when no explicit locale is provided.
func TestLocaleDetectionAcceptLanguage(t *testing.T) {
	var detected string
	handler := LocaleDetection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		detected = GetLocale(r.Context())
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("Accept-Language", "ja,en;q=0.8")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, "ja-JP", detected)
}

// TestLocaleDetectionDefault verifies that zh-CN is used when no
// locale information is present in the request.
func TestLocaleDetectionDefault(t *testing.T) {
	var detected string
	handler := LocaleDetection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		detected = GetLocale(r.Context())
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, "zh-CN", detected)
}

// TestLocaleDetectionHeaderPriority verifies the full detection
// order: x-locale beats cookie beats Accept-Language beats default.
func TestLocaleDetectionHeaderPriority(t *testing.T) {
	var detected string
	handler := LocaleDetection(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		detected = GetLocale(r.Context())
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("x-locale", "ko-KR")
	req.Header.Set("Cookie", "locale=en-US")
	req.Header.Set("Accept-Language", "ja")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, "ko-KR", detected, "x-locale should take priority")
}
