package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestRequestIDGenerated verifies that a request without a chi
// request ID gets one auto-generated and set in the response header.
func TestRequestIDGenerated(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := GetRequestID(r.Context())
		assert.NotEmpty(t, id, "request ID should be available in context")
		assert.True(t, len(id) > 10, "auto-generated ID should be sufficiently long")
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.NotEmpty(t, w.Header().Get("X-Request-Id"))
}

// TestRequestIDResponseHeader verifies that the X-Request-Id header
// is always set on the response, allowing clients to correlate logs.
func TestRequestIDResponseHeader(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	rid := w.Header().Get("X-Request-Id")
	assert.NotEmpty(t, rid, "X-Request-Id header must be set")
	assert.True(t, len(rid) > 5, "request ID should be non-trivial")
}

// TestRequestIDContextExtraction verifies that GetRequestID returns
// an empty string when no request ID is present in the context,
// preventing nil-dereference panics in downstream code.
func TestRequestIDContextExtraction(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/test", nil)
	id := GetRequestID(req.Context())
	assert.Empty(t, id, "should return empty string when no ID is set")
}
