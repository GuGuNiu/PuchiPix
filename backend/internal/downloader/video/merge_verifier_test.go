package video

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// ValidateMergeOutput must key its found/missing/corrupted/empty sets on
// the SAME segment identity the downloader writes to disk
// (SegmentFileName = GenerateTSID). The 260906 D3 diagnosis left the
// verifier deriving indices from a raw directory scan with its own
// _N suffix regex, which silently misclassifies segments whenever
// M3U8 media-sequence offsets make Index != slice position (live-to-VOD
// playlists), and cannot see non-canonical residue at all.

func TestValidateMergeOutputMediaSequenceOffset(t *testing.T) {
	dir := t.TempDir()

	// Playlist with a media-sequence offset: indices 10..12, NOT 0..2.
	segments := []M3U8Segment{
		{URI: "http://cdn/a.ts", FullURI: "http://cdn/a.ts", Index: 10, Duration: 2},
		{URI: "http://cdn/b.ts", FullURI: "http://cdn/b.ts", Index: 11, Duration: 2},
		{URI: "http://cdn/c.ts", FullURI: "http://cdn/c.ts", Index: 12, Duration: 2},
	}
	for _, s := range segments {
		writeSegment(t, dir, SegmentFileName(s), "DATA")
	}

	out := filepath.Join(dir, "out.ts")
	if err := os.WriteFile(out, []byte("DATADATADATA"), 0644); err != nil {
		t.Fatal(err)
	}

	manifest := SegmentManifest(segments)
	result := ValidateMergeOutput(context.Background(), dir, out, segments, manifest, 0)

	if !result.Valid {
		t.Fatalf("all segments present at offset indices must validate; got missing=%v empty=%v corrupted=%v",
			result.MissingIndices, result.EmptyIndices, result.CorruptedIndices)
	}
	if result.ActualSegments != 3 {
		t.Fatalf("expected 3 actual segments, got %d", result.ActualSegments)
	}
}

func TestValidateMergeOutputDetectsMissingCanonicalSegment(t *testing.T) {
	dir := t.TempDir()

	segments := []M3U8Segment{
		{URI: "http://cdn/a.ts", FullURI: "http://cdn/a.ts", Index: 0, Duration: 2},
		{URI: "http://cdn/b.ts", FullURI: "http://cdn/b.ts", Index: 1, Duration: 2},
	}
	// Only index 0 written; index 1 missing.
	writeSegment(t, dir, SegmentFileName(segments[0]), "AAA")

	out := filepath.Join(dir, "out.ts")
	if err := os.WriteFile(out, []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	manifest := SegmentManifest(segments)
	result := ValidateMergeOutput(context.Background(), dir, out, segments, manifest, 0)

	if result.Valid {
		t.Fatal("missing canonical segment must invalidate the merge")
	}
	if len(result.MissingIndices) != 1 || result.MissingIndices[0] != 1 {
		t.Fatalf("expected missing=[1], got %v", result.MissingIndices)
	}

	// Duration-level corruption (ProbeDuration returns a value far below
	// expected) re-queues the FULL segment set as corrupted candidates —
	// the old code copied MissingIndices (empty when files are all
	// present), producing an empty redownload set and a permanent
	// "no redownload candidates" dead end in MergeRetryLoop. In this test
	// environment ffmpeg cannot probe a text file (returns 0), which
	// exercises the opposite guarantee: a failed probe must NOT mark a
	// file-complete merge invalid.
	result = ValidateMergeOutput(context.Background(), dir, out, segments, manifest, 4*time.Second)
	if len(result.CorruptedIndices) != 0 {
		t.Fatalf("unprobeable output must not be marked corrupted (probe-failure tolerance), got %v", result.CorruptedIndices)
	}
}

func TestValidateMergeOutputIgnoresNonManifestResidue(t *testing.T) {
	dir := t.TempDir()

	segments := []M3U8Segment{
		{URI: "http://cdn/a.ts", FullURI: "http://cdn/a.ts", Index: 0, Duration: 2},
	}
	writeSegment(t, dir, SegmentFileName(segments[0]), "AAA")
	// Foreign residue that must not count as a segment OR as missing.
	writeSegment(t, dir, "seg_0000.ts", "OLD-NAMING")
	writeSegment(t, dir, "decoy.ts", "DECOY")

	manifest := SegmentManifest(segments)
	out := filepath.Join(dir, "out.ts")
	if err := os.WriteFile(out, []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ValidateMergeOutput(context.Background(), dir, out, segments, manifest, 0)
	if !result.Valid {
		t.Fatalf("residue outside the manifest must be ignored; got missing=%v", result.MissingIndices)
	}
	if result.ActualSegments != 1 {
		t.Fatalf("residue must not inflate ActualSegments, got %d", result.ActualSegments)
	}
}

func TestExpandToNeighborRangeUsesSegmentIndices(t *testing.T) {
	// failed=[11] with MaxIndex=12 must expand to [6..12] excluding the
	// confirmed-good set.
	got := expandToNeighborRange([]int{11}, NeighborOptions{
		Radius:   5,
		MaxIndex: 12,
		ExcludeSet: map[int]bool{10: true},
	})
	want := []int{6, 7, 8, 9, 11, 12}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// MergeRetryLoop's targeted redownload must address segments by their
// playlist Index (which may be offset), not by slice position.
func TestFilterByIndicesMatchesSegmentIndex(t *testing.T) {
	segments := []M3U8Segment{
		{URI: "a", FullURI: "a", Index: 10},
		{URI: "b", FullURI: "b", Index: 11},
		{URI: "c", FullURI: "c", Index: 12},
	}
	// Redownload set produced by the verifier for the middle segment.
	got := filterByIndices(segments, []int{11})
	if len(got) != 1 || got[0].Index != 11 {
		t.Fatalf("expected [Index=11], got %v", got)
	}
}

// Silence the unused import when only a subset of helpers is exercised.
var _ = os.Remove
