package video

import (
	"os"
	"path/filepath"
	"testing"
)

// The 260906 diagnosis: task_2's 197.5MB video inflated to 1024.3MB (5.2x)
// because merge/transcode inputs came from raw directory scans that
// swallowed stale merged outputs and duplicate-named segments. These tests
// lock the manifest-based behavior.

func writeSegment(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func seg(uri string, index int) M3U8Segment {
	return M3U8Segment{URI: uri, FullURI: uri, Index: index}
}

func TestMergeSegmentsOnlyUsesManifest(t *testing.T) {
	dir := t.TempDir()

	// Canonical segments.
	writeSegment(t, dir, SegmentFileName(seg("http://cdn/a.ts", 0)), "AAA")
	writeSegment(t, dir, SegmentFileName(seg("http://cdn/b.ts", 1)), "BBB")
	writeSegment(t, dir, SegmentFileName(seg("http://cdn/c.ts", 2)), "CCC")

	// Stray files that MUST NOT be merged: a stale merged output, a
	// foreign-variant residue file, and an unrelated .ts.
	writeSegment(t, dir, "title.ts", "STALE-MERGED-OUTPUT")
	writeSegment(t, dir, "seg_0000.ts", "OLD-RETRY-NAMING")
	writeSegment(t, dir, "decoy.ts", "DECOY")

	manifest := SegmentManifest([]M3U8Segment{
		seg("http://cdn/a.ts", 0),
		seg("http://cdn/b.ts", 1),
		seg("http://cdn/c.ts", 2),
	})

	out := filepath.Join(dir, mergedOutputDir, "merged.ts")
	result, err := MergeSegments(dir, out, manifest)
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	if result.TotalFiles != 3 {
		t.Fatalf("expected 3 merged files, got %d", result.TotalFiles)
	}

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "AAABBBCCC" {
		t.Fatalf("merged content must be exactly the manifest in playlist order, got %q", string(data))
	}
}

func TestMergeSegmentsSkipsMissingAndEmpty(t *testing.T) {
	dir := t.TempDir()

	writeSegment(t, dir, SegmentFileName(seg("http://cdn/a.ts", 0)), "AAA")
	// Index 1 intentionally missing.
	writeSegment(t, dir, SegmentFileName(seg("http://cdn/c.ts", 2)), "") // empty

	manifest := SegmentManifest([]M3U8Segment{
		seg("http://cdn/a.ts", 0),
		seg("http://cdn/b.ts", 1),
		seg("http://cdn/c.ts", 2),
	})

	out := filepath.Join(dir, mergedOutputDir, "merged.ts")
	result, err := MergeSegments(dir, out, manifest)
	if err != nil {
		t.Fatalf("merge should tolerate missing/empty entries: %v", err)
	}
	if result.TotalFiles != 1 {
		t.Fatalf("expected 1 usable file, got %d", result.TotalFiles)
	}

	data, _ := os.ReadFile(out)
	if string(data) != "AAA" {
		t.Fatalf("got %q", string(data))
	}
}

func TestMergeSegmentsRejectsEmptyManifest(t *testing.T) {
	dir := t.TempDir()
	if _, err := MergeSegments(dir, filepath.Join(dir, "out.ts"), nil); err == nil {
		t.Fatal("empty manifest must be rejected")
	}
}

func TestEnsurePlaylistFingerprintResetsOnChange(t *testing.T) {
	dir := t.TempDir()

	first := []M3U8Segment{seg("http://cdn/a.ts", 0), seg("http://cdn/b.ts", 1)}
	writeSegment(t, dir, SegmentFileName(first[0]), "AAA")
	writeSegment(t, dir, SegmentFileName(first[1]), "BBB")

	if EnsurePlaylistFingerprint(dir, first) {
		t.Fatal("first run must not report a reset")
	}
	// Fingerprint file must exist and segments survive an identical re-run.
	if _, err := os.Stat(filepath.Join(dir, playlistFingerprintFile)); err != nil {
		t.Fatalf("fingerprint not persisted: %v", err)
	}
	if EnsurePlaylistFingerprint(dir, first) {
		t.Fatal("identical playlist must not reset")
	}
	if _, err := os.Stat(filepath.Join(dir, SegmentFileName(first[0]))); err != nil {
		t.Fatal("segments must survive an identical re-run")
	}

	// Changed playlist (variant switch) → cache wiped.
	changed := []M3U8Segment{seg("http://cdn/hires.ts", 0), seg("http://cdn/hires2.ts", 1)}
	if !EnsurePlaylistFingerprint(dir, changed) {
		t.Fatal("changed playlist must report reset")
	}
	if _, err := os.Stat(filepath.Join(dir, SegmentFileName(first[0]))); err == nil {
		t.Fatal("stale segments must be wiped after a playlist change")
	}
}

// The retry path (DownloadSegmentsBatch) and the primary path
// (SegmentQueue) must agree on file naming, otherwise one segment exists
// under two names and gets merged twice.
func TestSegmentFileNameMatchesDownloadNaming(t *testing.T) {
	s := seg("http://cdn/video/seg1.ts", 7)
	want := GenerateTSID(s.URI, s.Index) + ".ts"
	if got := SegmentFileName(s); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
