package video

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeSweepFile(t *testing.T, dir, name string, size int, age time.Duration) {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, make([]byte, size), 0644); err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().Add(-age)
	if err := os.Chtimes(p, stamp, stamp); err != nil {
		t.Fatal(err)
	}
}

// Only stale dot-prefixed .mp4/.tmp scratch files are removed; fresh temps,
// final outputs and unrelated dot-files survive.
func TestSweepOrphanTempFilesRemovesOnlyStaleDotTemps(t *testing.T) {
	dir := t.TempDir()
	writeSweepFile(t, dir, ".orphan.mp4-2837559251.mp4", 32, 72*time.Hour)
	writeSweepFile(t, dir, ".orphan.mp4.12345.tmp", 16, 72*time.Hour)
	writeSweepFile(t, dir, ".live.mp4-999.mp4", 8, time.Minute)
	writeSweepFile(t, dir, "final.mp4", 64, 72*time.Hour)
	writeSweepFile(t, dir, ".m3u8-fingerprint", 4, 72*time.Hour)

	removed, reclaimed, err := SweepOrphanTempFiles(dir, 10*time.Minute)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(removed) != 2 {
		t.Fatalf("removed = %v, want the two stale dot temps", removed)
	}
	if reclaimed != 48 {
		t.Fatalf("reclaimed = %d, want 48", reclaimed)
	}
	for _, name := range []string{".orphan.mp4-2837559251.mp4", ".orphan.mp4.12345.tmp"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s still present", name)
		}
	}
	for _, name := range []string{".live.mp4-999.mp4", "final.mp4", ".m3u8-fingerprint"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("%s must survive the sweep: %v", name, err)
		}
	}
}

// A missing output directory is a clean no-op (first boot before any
// download ever ran).
func TestSweepOrphanTempFilesMissingDir(t *testing.T) {
	removed, reclaimed, err := SweepOrphanTempFiles(filepath.Join(t.TempDir(), "nope"), time.Minute)
	if err != nil {
		t.Fatalf("sweep on missing dir: %v", err)
	}
	if removed != nil || reclaimed != 0 {
		t.Fatalf("want clean no-op, got removed=%v reclaimed=%d", removed, reclaimed)
	}
}
