package middleware

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestRefillSurvivesFullBucket(t *testing.T) {
	s := &rateLimiterStore{bucket: make(map[string]*bucket)}
	b := s.getOrCreate("192.0.2.1")

	// Let the bucket sit full for a while. A refill loop that exits on a
	// full-bucket tick dies here and never replenishes again.
	time.Sleep(100 * time.Millisecond)

	for i := 0; i < defaultBurst; i++ {
		<-b.tokens
	}

	time.Sleep(200 * time.Millisecond)

	recovered := 0
	for {
		select {
		case <-b.tokens:
			recovered++
		default:
			goto drained
		}
	}
drained:
	if recovered < 3 {
		t.Fatalf("recovered %d tokens after draining, want >= 3 (refill goroutine stopped)", recovered)
	}
}

func TestClientIPIgnoresForwardedHeadersByDefault(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "false")
	req := httptest.NewRequest("GET", "http://example.test/", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.20")
	if got := clientIP(req); got != "192.0.2.10" {
		t.Fatalf("clientIP = %q, want remote address", got)
	}
}

func TestClientIPUsesForwardedHeadersWhenTrusted(t *testing.T) {
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	req := httptest.NewRequest("GET", "http://example.test/", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.20, 192.0.2.10")
	if got := clientIP(req); got != "198.51.100.20" {
		t.Fatalf("clientIP = %q, want first forwarded address", got)
	}
}
