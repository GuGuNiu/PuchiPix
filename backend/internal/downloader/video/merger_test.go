package video

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Merge and transcode inputs must come from the playlist manifest, never a raw
// directory scan. A scan swallows stale merged outputs and duplicate-named
// segments, so a retried merge ingests its own previous output and the file
// grows on every round. These tests lock the manifest-based behavior.

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
	// Index 1 intentionally missing; index 2 present but zero-length.
	writeSegment(t, dir, SegmentFileName(seg("http://cdn/c.ts", 2)), "")

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
	if _, err := os.Stat(filepath.Join(dir, playlistFingerprintFile)); err != nil {
		t.Fatalf("fingerprint not persisted: %v", err)
	}
	if EnsurePlaylistFingerprint(dir, first) {
		t.Fatal("identical playlist must not reset")
	}
	if _, err := os.Stat(filepath.Join(dir, SegmentFileName(first[0]))); err != nil {
		t.Fatal("segments must survive an identical re-run")
	}

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

func TestDownloadSegmentsBatchReturnsPlaylistOrder(t *testing.T) {
	dir := t.TempDir()
	segments := []M3U8Segment{
		seg("http://cdn/10.ts", 10),
		seg("http://cdn/11.ts", 11),
		seg("http://cdn/12.ts", 12),
	}
	for _, segment := range segments {
		writeSegment(t, dir, SegmentFileName(segment), segment.URI)
	}

	result := DownloadSegmentsBatch(context.Background(), segments, SegmentBatchOptions{
		Concurrency: 3,
		SegDir:      dir,
	})
	want := []int{10, 11, 12}
	if !reflect.DeepEqual(result.DownloadedIndices, want) {
		t.Fatalf("downloaded indices = %v, want %v", result.DownloadedIndices, want)
	}
	if result.Downloaded != len(want) || len(result.Failed) != 0 {
		t.Fatalf("unexpected batch result: %+v", result)
	}
}

func TestMergeSegmentsReportsOrderedProgress(t *testing.T) {
	dir := t.TempDir()
	segments := []M3U8Segment{
		seg("http://cdn/a.ts", 0),
		seg("http://cdn/b.ts", 1),
		seg("http://cdn/c.ts", 2),
	}
	for _, segment := range segments {
		writeSegment(t, dir, SegmentFileName(segment), segment.URI)
	}
	var updates [][2]int
	_, err := MergeSegmentsContextWithProgress(
		context.Background(), dir, filepath.Join(dir, "merged.ts"), SegmentManifest(segments),
		func(completed, total int) {
			updates = append(updates, [2]int{completed, total})
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(updates) != 4 || updates[0] != [2]int{0, 3} || updates[len(updates)-1] != [2]int{3, 3} {
		t.Fatalf("unexpected merge progress: %v", updates)
	}
}

func TestBuildCopyArgsForMergedInput(t *testing.T) {
	got := buildCopyArgs("input.ts", "output.mp4", false)
	want := []string{"-i", "input.ts", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-y", "output.mp4"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %v, want %v", got, want)
	}

	got = buildCopyArgs("concat.txt", "output.mp4", true)
	want = []string{"-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-y", "output.mp4"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("concat args = %v, want %v", got, want)
	}
}

func TestMergeRetryLoopUsesSegmentDirectory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("segment"))
	}))
	defer server.Close()

	segment := M3U8Segment{URI: server.URL + "/0.ts", FullURI: server.URL + "/0.ts", Index: 0}
	dir := t.TempDir()
	output := filepath.Join(dir, "merged.ts")
	opts := DefaultMergeRetryOptions(output, dir)

	if err := MergeRetryLoop(context.Background(), []M3U8Segment{segment}, nil, opts); err != nil {
		t.Fatalf("merge retry loop: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, SegmentFileName(segment))); err != nil {
		t.Fatalf("segment was not written to configured directory: %v", err)
	}
	if _, err := os.Stat(output); err != nil {
		t.Fatalf("merged output was not created: %v", err)
	}
}

// The tail-merge fast path publishes the output before the loop runs: the
// first attempt must skip the merge and keep the premade file intact.
func TestMergeRetryLoopPremergeSkipsMerge(t *testing.T) {
	dir := t.TempDir()
	segments := []M3U8Segment{seg("http://cdn/a.ts", 0), seg("http://cdn/b.ts", 1)}
	writeSegment(t, dir, SegmentFileName(segments[0]), "AAA")
	writeSegment(t, dir, SegmentFileName(segments[1]), "BBB")

	output := filepath.Join(dir, "merged.ts")
	if err := os.WriteFile(output, []byte("AAABBB-ALREADY-MERGED"), 0644); err != nil {
		t.Fatal(err)
	}

	opts := DefaultMergeRetryOptions(output, dir)
	calls := 0
	opts.PremergeCheck = func() bool {
		calls++
		return true
	}

	if err := MergeRetryLoop(context.Background(), segments, nil, opts); err != nil {
		t.Fatalf("premerge fast path: %v", err)
	}
	if calls != 1 {
		t.Fatalf("PremergeCheck called %d times, want 1", calls)
	}
	if got := readOrFail(t, output); got != "AAABBB-ALREADY-MERGED" {
		t.Fatalf("premerged output must be preserved, got %q", got)
	}
}

// A validation failure must drop the premade output and fall back to the
// regular full-merge rounds with targeted redownloads. Mirrors the
// production shape: successSet claims every segment, but a zero-byte
// capsule makes the file-level validation fail.
func TestMergeRetryLoopPremergeValidationFailureFallsBack(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("SEG"))
	}))
	defer server.Close()

	segments := []M3U8Segment{
		{URI: server.URL + "/0.ts", FullURI: server.URL + "/0.ts", Index: 0},
		{URI: server.URL + "/1.ts", FullURI: server.URL + "/1.ts", Index: 1},
	}
	dir := t.TempDir()
	writeSegment(t, dir, SegmentFileName(segments[0]), "AAA")
	// Segment 1's capsule is empty (zero bytes), so the premade output
	// fails the file-level validation and the loop must rebuild it.
	writeSegment(t, dir, SegmentFileName(segments[1]), "")

	output := filepath.Join(dir, "merged.ts")
	if err := os.WriteFile(output, []byte("PREMERGED-BAD"), 0644); err != nil {
		t.Fatal(err)
	}

	opts := DefaultMergeRetryOptions(output, dir)
	calls := 0
	opts.PremergeCheck = func() bool {
		calls++
		return calls == 1
	}

	successSet := map[int]bool{0: true, 1: true}
	if err := MergeRetryLoop(context.Background(), segments, successSet, opts); err != nil {
		t.Fatalf("fallback after failed premerge validation: %v", err)
	}
	if calls != 2 {
		t.Fatalf("PremergeCheck called %d times, want 2 (true once, then rejected)", calls)
	}
	if got := readOrFail(t, output); got != "AAASEG" {
		t.Fatalf("rebuilt output = %q, want AAASEG", got)
	}
}
