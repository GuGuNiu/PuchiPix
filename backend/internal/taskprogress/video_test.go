package taskprogress

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestVideoProgressTrackerDownloadedBytes verifies that GetSummary
// aggregates DownloadedBytes from completed segment FileSize values
// (the 260809 live-size feature — the frontend size column shows a
// partial size during download instead of waiting for the MP4 merge).
func TestVideoProgressTrackerDownloadedBytes(t *testing.T) {
	vt := NewVideoProgressTracker(DefaultVideoRetryStrategy())

	vt.RegisterSegments(1, 3)
	vt.UpdateSegment(1, 0, SegCompleted, "/tmp/seg0.ts", 1024, "")
	vt.UpdateSegment(1, 1, SegCompleted, "/tmp/seg1.ts", 2048, "")
	// Segment 2 still pending → not counted.

	sum := vt.GetSummary(1)
	require.Equal(t, 2, sum.CompletedSegments)
	require.Equal(t, int64(3072), sum.DownloadedBytes)
	require.Equal(t, 1, sum.PendingSegments)
}

// TestVideoProgressTrackerDownloadedBytesFromDisk verifies that when a
// segment's FileSize is unknown (0), the tracker falls back to stat-ing
// the local file for the byte count.
func TestVideoProgressTrackerDownloadedBytesFromDisk(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "seg.ts")
	require.NoError(t, os.WriteFile(path, make([]byte, 4096), 0644))

	vt := NewVideoProgressTracker(DefaultVideoRetryStrategy())
	vt.RegisterSegments(7, 1)
	vt.UpdateSegment(7, 0, SegCompleted, path, 0, "") // FileSize 0 → fallback to disk

	sum := vt.GetSummary(7)
	assert.Equal(t, int64(4096), sum.DownloadedBytes)
}
