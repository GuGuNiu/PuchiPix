package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCORSPreflight(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for preflight")
	}))

	req := httptest.NewRequest("OPTIONS", "/api/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Origin"), "*")
}

func TestCORSActualRequest(t *testing.T) {
	called := false
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.True(t, called)
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Origin"), "*")
	assert.Contains(t, w.Header().Get("Access-Control-Expose-Headers"), "X-Request-Id")
}

// TestCORSAllowedMethods verifies that the CORS middleware responds
// to preflight requests with the allowed methods header.
func TestCORSAllowedMethods(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("OPTIONS", "/api/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "DELETE")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	allowed := w.Header().Get("Access-Control-Allow-Methods")
	assert.NotEmpty(t, allowed, "preflight should advertise allowed methods")
	assert.Contains(t, allowed, "DELETE", "requested method should be allowed")
}

// TestCORSAllowedHeaders verifies that custom headers used by the
// frontend are included in the allowed list on preflight responses.
func TestCORSAllowedHeaders(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("OPTIONS", "/api/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type,x-locale")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	allowed := w.Header().Get("Access-Control-Allow-Headers")
	assert.Contains(t, allowed, "Content-Type")
	assert.Contains(t, allowed, "X-Locale")
}
