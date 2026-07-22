package infra

import (
	"context"
	"sync"
	"time"
)

// RateLimiter implements a token-bucket rate limiter: callers block on
// Wait until a token is available, and tokens are replenished at a
// fixed interval up to the bucket capacity. This replaces the
// TypeScript RateLimiter's setTimeout-based refill loop.
type RateLimiter struct {
	mu       sync.Mutex
	tokens   chan struct{}
	capacity int
	refill   time.Duration
	stop     chan struct{}
	stopped  bool
}

// NewRateLimiter creates a limiter that holds at most capacity tokens
// and refills one token every refillInterval. The background refiller
// goroutine starts immediately and stops when Close is called.
func NewRateLimiter(capacity int, refillInterval time.Duration) *RateLimiter {
	if capacity <= 0 {
		capacity = 1
	}
	rl := &RateLimiter{
		tokens:   make(chan struct{}, capacity),
		capacity: capacity,
		refill:   refillInterval,
		stop:     make(chan struct{}),
	}
	for i := 0; i < capacity; i++ {
		rl.tokens <- struct{}{}
	}
	go rl.refillLoop()
	return rl
}

func (r *RateLimiter) refillLoop() {
	ticker := time.NewTicker(r.refill)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			select {
			case r.tokens <- struct{}{}:
			default:
			}
		}
	}
}

// Wait blocks until a token is acquired or the context is cancelled.
func (r *RateLimiter) Wait(ctx context.Context) error {
	select {
	case <-r.tokens:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// TryAcquire returns immediately, yielding true only if a token was
// available without waiting.
func (r *RateLimiter) TryAcquire() bool {
	select {
	case <-r.tokens:
		return true
	default:
		return false
	}
}

// Close stops the refiller goroutine and drains remaining tokens.
func (r *RateLimiter) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	r.stopped = true
	close(r.stop)
}

// Capacity returns the maximum number of tokens the bucket can hold.
func (r *RateLimiter) Capacity() int {
	return r.capacity
}

// Available returns the current number of tokens without blocking.
func (r *RateLimiter) Available() int {
	return len(r.tokens)
}
