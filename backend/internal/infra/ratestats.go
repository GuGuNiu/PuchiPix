package infra

import (
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// Global throughput accounting behind the dashboard's network/disk rate
// display. Download paths record every byte read off HTTP response bodies
// (network) and every byte written to files (disk); /api/stats diffs the
// monotonic totals between consecutive requests to produce per-second
// rates. Counting is lock-free; only the rate window takes a mutex.

var (
	totalNetBytes  atomic.Uint64
	totalDiskBytes atomic.Uint64
)

// RecordNetBytes adds n bytes to the network download counter.
func RecordNetBytes(n int64) {
	if n > 0 {
		totalNetBytes.Add(uint64(n))
	}
}

// RecordDiskBytes adds n bytes to the disk write counter.
func RecordDiskBytes(n int64) {
	if n > 0 {
		totalDiskBytes.Add(uint64(n))
	}
}

// NetBytesTotal returns the lifetime download byte total.
func NetBytesTotal() uint64 { return totalNetBytes.Load() }

// DiskBytesTotal returns the lifetime disk write byte total.
func DiskBytesTotal() uint64 { return totalDiskBytes.Load() }

type rateWindowState struct {
	mu        sync.Mutex
	lastNet   uint64
	lastDisk  uint64
	lastTime  time.Time
	startedAt time.Time
}

var rateWindow = func() *rateWindowState {
	now := time.Now()
	return &rateWindowState{lastTime: now, startedAt: now}
}()

// ThroughputSnapshot converts the byte totals into per-second rates over
// the window since the previous call, so the window tracks the caller's
// polling interval (3 s on the tasks toolbar). The first call and gaps
// longer than maxRateWindow just reset the baseline and report zero
// rather than averaging idle time into the rate.
const maxRateWindow = 30 * time.Second

func ThroughputSnapshot() (netBps, diskBps float64) {
	now := time.Now()

	rateWindow.mu.Lock()
	defer rateWindow.mu.Unlock()

	net := totalNetBytes.Load()
	disk := totalDiskBytes.Load()
	elapsed := now.Sub(rateWindow.lastTime).Seconds()
	prevNet := rateWindow.lastNet
	prevDisk := rateWindow.lastDisk
	rateWindow.lastTime = now
	rateWindow.lastNet = net
	rateWindow.lastDisk = disk

	if elapsed < 0.2 || elapsed > maxRateWindow.Seconds() {
		return 0, 0
	}
	return clampNonNeg(float64(net-prevNet) / elapsed),
		clampNonNeg(float64(disk-prevDisk) / elapsed)
}

// AvgNetBps returns the lifetime average download rate since start.
func AvgNetBps() float64 {
	uptime := time.Since(rateWindow.startedAt).Seconds()
	if uptime < 1 {
		return 0
	}
	return float64(totalNetBytes.Load()) / uptime
}

func clampNonNeg(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

// FormatBytesPerSec renders a byte-per-second rate with binary units,
// e.g. "823 B/s" or "2.5 MB/s".
func FormatBytesPerSec(bps float64) string {
	const unit = 1024
	if bps < unit {
		return fmt.Sprintf("%.0f B/s", bps)
	}
	div, exp := float64(unit), 0
	for n := bps / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB/s", bps/div, "KMGTPE"[exp])
}

// CountingReader feeds every byte read through it into the global
// network counter — wrap HTTP response bodies on download paths.
type CountingReader struct {
	R io.Reader
}

func (cr *CountingReader) Read(p []byte) (int, error) {
	n, err := cr.R.Read(p)
	RecordNetBytes(int64(n))
	return n, err
}

// CountingWriter feeds every byte written through it into the global
// disk counter — wrap destination files on download and merge paths.
type CountingWriter struct {
	W io.Writer
}

func (cw *CountingWriter) Write(p []byte) (int, error) {
	n, err := cw.W.Write(p)
	RecordDiskBytes(int64(n))
	return n, err
}
