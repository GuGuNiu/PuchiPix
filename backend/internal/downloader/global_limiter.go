package downloader

import (
	"context"
	"sync"
)

const (
	// DefaultGlobalDownloadConcurrent caps simultaneous HTTP requests
	// process-wide, set above the worst-case fan-out of the scheduler slot
	// pool (5 download slots × ~5 images + ~10 segments ≈ 75) so ordinary
	// batches are not throttled while large imports are still bounded.
	DefaultGlobalDownloadConcurrent = 64
)

// globalDownloadSem lets the capacity change at runtime. Built from
// sync.Cond and a counter so a resize neither orphans in-flight releases
// nor opens a transient over-capacity window.
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
	globalDownloadSem.cond.Broadcast()
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

func waitForSlot(ctx context.Context) error {
	globalDownloadSem.Lock()
	if globalDownloadSem.inUse < globalDownloadSem.max && ctx.Err() == nil {
		globalDownloadSem.inUse++
		globalDownloadSem.Unlock()
		return nil
	}
	globalDownloadSem.Unlock()

	// sync.Cond.Wait is not context-aware, so a helper goroutine
	// broadcasts on ctx.Done and every waiter re-checks the context
	// after waking.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			globalDownloadSem.Lock()
			globalDownloadSem.cond.Broadcast()
			globalDownloadSem.Unlock()
		case <-stop:
		}
	}()

	globalDownloadSem.Lock()
	if err := ctx.Err(); err != nil {
		globalDownloadSem.Unlock()
		return err
	}
	for globalDownloadSem.inUse >= globalDownloadSem.max {
		globalDownloadSem.cond.Wait()
		// The broadcast may come from ctx.Done rather than a slot release.
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
