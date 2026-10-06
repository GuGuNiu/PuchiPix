package downloader

import (
	"context"
	"io"
	"time"

	"golang.org/x/time/rate"
)

// SharedRateLimiter wraps a single rate.Limiter so that all concurrent
// chunks of one file share one bandwidth ceiling instead of each worker
// getting its own limit (which would multiply the effective rate).
type SharedRateLimiter struct {
	limiter *rate.Limiter
}

// NewSharedRateLimiter creates a limiter that allows bytesPerSec bytes
// per second. A non-positive value disables limiting (returns nil).
func NewSharedRateLimiter(bytesPerSec int64) *SharedRateLimiter {
	if bytesPerSec <= 0 {
		return nil
	}
	return &SharedRateLimiter{
		limiter: rate.NewLimiter(rate.Limit(bytesPerSec), int(bytesPerSec)),
	}
}

// or ctx is cancelled, enforcing the aggregate rate across all workers.
func (rl *SharedRateLimiter) Wait(ctx context.Context, n int) error {
	if rl == nil || n <= 0 {
		return nil
	}
	return rl.limiter.WaitN(ctx, n)
}

// limitedReader wraps an io.Reader so that reads consume budget from
// the shared limiter, giving per-file aggregate throttling.
type limitedReader struct {
	reader  io.Reader
	limiter *SharedRateLimiter
	ctx     context.Context
}

// newLimitedReader wraps r with the shared limiter so that reads are
// throttled at the file level across all concurrent chunks.
func newLimitedReader(r io.Reader, rl *SharedRateLimiter, ctx context.Context) io.Reader {
	if rl == nil {
		return r
	}
	return &limitedReader{reader: r, limiter: rl, ctx: ctx}
}

func (lr *limitedReader) Read(p []byte) (int, error) {
	n, err := lr.reader.Read(p)
	if n > 0 {
		if waitErr := lr.limiter.Wait(lr.ctx, n); waitErr != nil {
			return n, waitErr
		}
	}
	return n, err
}

func SleepBriefly(d time.Duration) {
	time.Sleep(d)
}
