package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type bucket struct {
	tokens   chan struct{}
	done     chan struct{}
	lastSeen time.Time
}

type rateLimiterStore struct {
	mu     sync.Mutex
	bucket map[string]*bucket
}

var store = &rateLimiterStore{bucket: make(map[string]*bucket)}

const (
	defaultRate     = 60
	defaultBurst    = 120
	cleanupInterval = 5 * time.Minute
	ipTTL           = 10 * time.Minute
)

func init() {
	go store.cleanupLoop()
}

func (s *rateLimiterStore) cleanupLoop() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		now := time.Now()
		for ip, b := range s.bucket {
			if now.Sub(b.lastSeen) > ipTTL {
				close(b.done)
				delete(s.bucket, ip)
			}
		}
		s.mu.Unlock()
	}
}

func (s *rateLimiterStore) getOrCreate(ip string) *bucket {
	s.mu.Lock()
	defer s.mu.Unlock()

	if b, ok := s.bucket[ip]; ok {
		b.lastSeen = time.Now()
		return b
	}

	tokens := make(chan struct{}, defaultBurst)
	for i := 0; i < defaultBurst; i++ {
		tokens <- struct{}{}
	}
	b := &bucket{tokens: tokens, done: make(chan struct{}), lastSeen: time.Now()}
	s.bucket[ip] = b

	go s.refill(ip, b)
	return b
}

func (s *rateLimiterStore) refill(ip string, b *bucket) {
	interval := time.Second / time.Duration(defaultRate)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-b.done:
			return
		case <-ticker.C:
			select {
			case <-b.done:
				return
			case b.tokens <- struct{}{}:
			default:
				// Bucket full; skip this tick but keep refilling.
			}
			s.mu.Lock()
			_, ok := s.bucket[ip]
			s.mu.Unlock()
			if !ok {
				return
			}
		}
	}
}

// RateLimiter applies a per-IP token-bucket rate limit. When the
// bucket is empty the request is rejected with 429 Too Many Requests.
func RateLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		b := store.getOrCreate(ip)

		select {
		case <-b.tokens:
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			writeRateLimitError(w)
		}
	})
}

func clientIP(r *http.Request) string {
	if strings.EqualFold(os.Getenv("TRUST_PROXY_HEADERS"), "true") {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
		if real := r.Header.Get("X-Real-IP"); real != "" {
			return strings.TrimSpace(real)
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func writeRateLimitError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	w.Write([]byte(`{"error":"Too many requests"}`))
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
