package downloader

import (
	"context"
	"sync"
)

// Global download concurrency governor.
//
// The DAG scheduler's slot pool already bounds concurrency at the TASK
// level (scraping / download slots), which prevents a large batch import
// from starting 100 tasks at once. This limiter is a second, coarser
// pressure valve at the I/O level: it caps the TOTAL number of
// simultaneous HTTP download requests (images, files, and video TS
// segments) across the whole process, regardless of how many tasks,
// galleries, or videos are active. This protects device memory/CPU from
// the pathological aggregate fan-out of many concurrent downloads while
// staying generous enough not to throttle normal operation.

const (
	// DefaultGlobalDownloadConcurrent is the default aggregate cap. It is
	// set above the worst-case fan-out governed by the slot pool (5
	// download slots × ~5 images + ~10 segments ≈ 75) so it does not
	// throttle normal operation, while still blocking pathological
	// bursts (e.g. a 100+ URL import).
	DefaultGlobalDownloadConcurrent = 64
)

// globalDownloadSem is a resize-safe semaphore implemented with
// sync.Cond + counter. Unlike the previous channel-based approach,
// resizing does not orphan in-flight releases or create transient
// over-capacity windows.
var globalDownloadSem = struct {
	sync.Mutex
	cond    *sync.Cond
	max     int
	inUse   int
	version int64 // bumped on resize so stale waiters re-check
}{}

func init() {
	globalDownloadSem.cond = sync.NewCond(&globalDownloadSem.Mutex)
	globalDownloadSem.max = DefaultGlobalDownloadConcurrent
}

// SetGlobalDownloadConcurrent resizes the aggregate in-flight download
// cap. It takes effect for subsequent acquisitions; already-acquired
// slots are unaffected. n <= 0 restores the default.
func SetGlobalDownloadConcurrent(n int) {
	if n <= 0 {
		n = DefaultGlobalDownloadConcurrent
	}
	globalDownloadSem.Lock()
	globalDownloadSem.max = n
	globalDownloadSem.version++
	globalDownloadSem.cond.Broadcast() // wake waiters to re-check capacity
	globalDownloadSem.Unlock()
}

// AcquireGlobalDownload blocks until an aggregate download slot is free
// and returns a release function. Callers MUST invoke the release
// function (defer) after their HTTP download finishes, otherwise the
// cap is consumed permanently.
func AcquireGlobalDownload() func() {
	globalDownloadSem.Lock()
	for globalDownloadSem.inUse >= globalDownloadSem.max {
		globalDownloadSem.cond.Wait()
	}
	globalDownloadSem.inUse++
	globalDownloadSem.Unlock()
	return func() {
		globalDownloadSem.Lock()
		globalDownloadSem.inUse--
		globalDownloadSem.cond.Signal()
		globalDownloadSem.Unlock()
	}
}

// AcquireGlobalDownloadCtx blocks until an aggregate download slot is
// free or the provided context is cancelled. Returns a release function
// and nil on success, or nil and ctx.Err() if the context fires first.
func AcquireGlobalDownloadCtx(ctx context.Context) (func(), error) {
	if err := waitForSlot(ctx); err != nil {
		return nil, err
	}
	return func() {
		globalDownloadSem.Lock()
		globalDownloadSem.inUse--
		globalDownloadSem.cond.Signal()
		globalDownloadSem.Unlock()
	}, nil
}

// waitForSlot blocks until a slot is available or ctx is done. Returns
// nil when a slot has been acquired (inUse already incremented), or
// ctx.Err() if the context fires before a slot is obtained.
func waitForSlot(ctx context.Context) error {
	// Fast path: slot available and ctx not done.
	globalDownloadSem.Lock()
	if globalDownloadSem.inUse < globalDownloadSem.max && ctx.Err() == nil {
		globalDownloadSem.inUse++
		globalDownloadSem.Unlock()
		return nil
	}
	globalDownloadSem.Unlock()

	// Slow path: we cannot make sync.Cond.Wait() context-aware
	// directly, so we race a cond-wait against ctx.Done via a helper
	// goroutine that broadcasts when the context fires.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		<-ctx.Done()
		select {
		case <-stop:
		default:
			globalDownloadSem.Lock()
			globalDownloadSem.cond.Broadcast()
			globalDownloadSem.Unlock()
		}
	}()

	globalDownloadSem.Lock()
	for globalDownloadSem.inUse >= globalDownloadSem.max {
		globalDownloadSem.cond.Wait()
		// Check context after waking — Broadcast may have been
		// triggered by ctx.Done() rather than a slot release.
		if ctx.Err() != nil {
			globalDownloadSem.Unlock()
			return ctx.Err()
		}
	}
	globalDownloadSem.inUse++
	globalDownloadSem.Unlock()
	return nil
}

// CurrentLoad returns the current in-use count and max capacity for
// observability endpoints.
func CurrentLoad() (inUse, max int) {
	globalDownloadSem.Lock()
	defer globalDownloadSem.Unlock()
	return globalDownloadSem.inUse, globalDownloadSem.max
}