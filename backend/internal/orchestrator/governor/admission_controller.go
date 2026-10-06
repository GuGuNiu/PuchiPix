package governor

import (
	"context"
	"sync"
	"time"

	"backend/internal/infra"
)

// AdmissionController implements a token-bucket rate limiter that gates
// task entry into the scheduler. The Governor adjusts tokensPerSecond
// based on real-time pressure from the PressureMonitor.
type AdmissionController struct {
	mu sync.Mutex

	capacity        int
	tokens          float64
	tokensPerSecond float64
	minRate         float64
	maxRate         float64
	lastTick        time.Time

	pendingWaiters atomicCounter
	admittedTotal  atomicCounter
	rejectedTotal  atomicCounter

	logger *infra.Logger
}

type atomicCounter struct {
	val int64
}

func (c *atomicCounter) Add(delta int64) { c.val += delta }

func (c *atomicCounter) Load() int64 { return c.val }

// NewAdmissionController creates a full-bucket token limiter.
func NewAdmissionController(capacity int, initialRate, minRate, maxRate float64) *AdmissionController {
	return &AdmissionController{
		capacity:        capacity,
		tokens:          float64(capacity),
		tokensPerSecond: initialRate,
		minRate:         minRate,
		maxRate:         maxRate,
		lastTick:        time.Now(),
		logger:          infra.NewLogger("AdmissionCtrl"),
	}
}

func (ac *AdmissionController) replenish(now time.Time) {
	elapsed := now.Sub(ac.lastTick).Seconds()
	if elapsed <= 0 {
		return
	}
	ac.tokens += elapsed * ac.tokensPerSecond
	if ac.tokens > float64(ac.capacity) {
		ac.tokens = float64(ac.capacity)
	}
	ac.lastTick = now
}

// Acquire blocks until a token is available or ctx is cancelled.
func (ac *AdmissionController) Acquire(ctx context.Context) error {
	ac.mu.Lock()
	ac.replenish(time.Now())
	if ac.tokens >= 1 && ctx.Err() == nil {
		ac.tokens--
		ac.admittedTotal.Add(1)
		ac.mu.Unlock()
		return nil
	}
	ac.mu.Unlock()

	ac.pendingWaiters.Add(1)
	defer ac.pendingWaiters.Add(-1)

	for {
		ac.mu.Lock()
		ac.replenish(time.Now())
		if ac.tokens >= 1 {
			ac.tokens--
			ac.admittedTotal.Add(1)
			ac.mu.Unlock()
			return nil
		}
		ac.mu.Unlock()

		ac.mu.Lock()
		deficit := 1 - ac.tokens
		if ac.tokensPerSecond <= 0 {
			ac.mu.Unlock()
			select {
			case <-ctx.Done():
				ac.rejectedTotal.Add(1)
				return ctx.Err()
			case <-time.After(500 * time.Millisecond):
				continue
			}
		}
		waitSec := deficit / ac.tokensPerSecond
		ac.mu.Unlock()

		waitDur := time.Duration(waitSec * float64(time.Second))
		if waitDur < 10*time.Millisecond {
			waitDur = 10 * time.Millisecond
		}
		if waitDur > 2*time.Second {
			waitDur = 2 * time.Second
		}

		select {
		case <-ctx.Done():
			ac.rejectedTotal.Add(1)
			return ctx.Err()
		case <-time.After(waitDur):
		}
	}
}

// TryAcquire returns true if a token was available (non-blocking).
func (ac *AdmissionController) TryAcquire() bool {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	ac.replenish(time.Now())
	if ac.tokens < 1 {
		return false
	}
	ac.tokens--
	ac.admittedTotal.Add(1)
	return true
}

// SetRate adjusts the replenishment rate, clamped to [minRate, maxRate].
func (ac *AdmissionController) SetRate(tokensPerSecond float64) {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	if tokensPerSecond < ac.minRate {
		tokensPerSecond = ac.minRate
	}
	if tokensPerSecond > ac.maxRate {
		tokensPerSecond = ac.maxRate
	}
	ac.tokensPerSecond = tokensPerSecond
	ac.logger.Info("Admission rate adjusted", "newRate", tokensPerSecond)
}

func (ac *AdmissionController) CurrentRate() float64 {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	return ac.tokensPerSecond
}

func (ac *AdmissionController) Snapshot() AdmissionStats {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	ac.replenish(time.Now())
	return AdmissionStats{
		Tokens:         ac.tokens,
		Capacity:       ac.capacity,
		Rate:           ac.tokensPerSecond,
		PendingWaiters: ac.pendingWaiters.Load(),
		AdmittedTotal:  ac.admittedTotal.Load(),
		RejectedTotal:  ac.rejectedTotal.Load(),
	}
}

type AdmissionStats struct {
	Tokens         float64 `json:"tokens"`
	Capacity       int     `json:"capacity"`
	Rate           float64 `json:"rate"`
	PendingWaiters int64   `json:"pendingWaiters"`
	AdmittedTotal  int64   `json:"admittedTotal"`
	RejectedTotal  int64   `json:"rejectedTotal"`
}
