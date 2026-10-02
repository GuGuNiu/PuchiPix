package infra

import (
	"testing"
	"time"
)

// resetRateWindow reinitializes the shared rate window so tests start
// from a clean baseline.
func resetRateWindow(t *testing.T) {
	t.Helper()
	now := time.Now()
	rateWindow.mu.Lock()
	defer rateWindow.mu.Unlock()
	rateWindow.lastNet = totalNetBytes.Load()
	rateWindow.lastDisk = totalDiskBytes.Load()
	rateWindow.lastTime = now
	rateWindow.startedAt = now
}

func TestThroughputSnapshotFirstCallReportsZero(t *testing.T) {
	resetRateWindow(t)
	RecordNetBytes(5000)
	RecordDiskBytes(5000)

	netBps, diskBps := ThroughputSnapshot()
	if netBps != 0 || diskBps != 0 {
		t.Fatalf("first call should reset baseline and report zero, got net=%v disk=%v", netBps, diskBps)
	}
}

func TestThroughputSnapshotComputesRates(t *testing.T) {
	resetRateWindow(t)
	ThroughputSnapshot() // establish baseline

	RecordNetBytes(600)
	RecordDiskBytes(300)
	time.Sleep(250 * time.Millisecond)

	netBps, diskBps := ThroughputSnapshot()
	// 600 bytes over ~0.25s → ~2400 B/s (allow generous bounds for
	// scheduling jitter).
	if netBps < 1200 || netBps > 4800 {
		t.Fatalf("net rate out of expected range: %v", netBps)
	}
	if diskBps < 600 || diskBps > 2400 {
		t.Fatalf("disk rate out of expected range: %v", diskBps)
	}
}

func TestThroughputSnapshotIdleReportsZero(t *testing.T) {
	resetRateWindow(t)
	ThroughputSnapshot()

	time.Sleep(250 * time.Millisecond)
	netBps, diskBps := ThroughputSnapshot()
	if netBps != 0 || diskBps != 0 {
		t.Fatalf("idle window should report zero, got net=%v disk=%v", netBps, diskBps)
	}
}

func TestFormatBytesPerSec(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "0 B/s"},
		{823, "823 B/s"},
		{1024, "1.0 KB/s"},
		{2560, "2.5 KB/s"},
		{2.5 * 1024 * 1024, "2.5 MB/s"},
	}
	for _, c := range cases {
		if got := FormatBytesPerSec(c.in); got != c.want {
			t.Errorf("FormatBytesPerSec(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}
