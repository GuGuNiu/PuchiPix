package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRateLimiterAllowsRequest(t *testing.T) {
	handler := RateLimiter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRateLimiterClientIPForwarded(t *testing.T) {
	h := http.Header{}
	h.Set("X-Forwarded-For", "192.168.1.1")
	ip := clientIP(&http.Request{
		Header:     h,
		RemoteAddr: "10.0.0.1:1234",
	})
	assert.Equal(t, "192.168.1.1", ip)
}

func TestRateLimiterClientIPRealIP(t *testing.T) {
	h := http.Header{}
	h.Set("X-Real-IP", "172.16.0.1")
	ip := clientIP(&http.Request{
		Header:     h,
		RemoteAddr: "10.0.0.1:1234",
	})
	assert.Equal(t, "172.16.0.1", ip)
}

func TestRateLimiterClientIPRemoteAddr(t *testing.T) {
	ip := clientIP(&http.Request{
		RemoteAddr: "10.0.0.1:1234",
	})
	assert.Equal(t, "10.0.0.1:1234", ip)
}

// TestRandomHex verifies that the hex generator produces the expected
// character count, ensuring request IDs have sufficient entropy.
func TestRandomHex(t *testing.T) {
	h := randomHex(8)
	assert.Len(t, h, 16, "8 bytes should produce 16 hex chars")
	h2 := randomHex(8)
	assert.NotEqual(t, h, h2, "consecutive calls should produce different values")
}
