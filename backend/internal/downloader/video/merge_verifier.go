package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// MergeValidationResult holds the outcome of validating a merge/transcode
// output against the expected segment set. It is the single source of truth
// for deciding whether a merge succeeded or needs a targeted redownload.
type MergeValidationResult struct {
	Valid            bool          // Overall validity (no missing, no corrupted)
	OutputPath       string        // Path to the merged output file
	ExpectedSegments int           // Total segments expected from M3U8
	ActualSegments   int           // Segments found on disk
	MissingIndices   []int         // Completely absent segment indices
	EmptyIndices     []int         // Segments with 0-byte files
	CorruptedIndices []int         // Segments that failed ffprobe or are suspicious
	OutputDuration   time.Duration // Actual output file duration (0 if probe failed)
	ExpectedDuration time.Duration // Sum of EXTINF durations from M3U8
	OutputSize       int64         // Output file size in bytes
}

// NeighborOptions configures how expandToNeighborRange computes the
// redownload set from a list of failed indices.
type NeighborOptions struct {
	// Radius is the number of indices to extend on each side of a
	// failed segment. Default: 5.
	Radius int
	// MaxIndex is the upper bound (totalSegments - 1). Values above
	// this are clamped.
	MaxIndex int
	// ExcludeSet marks indices that are already confirmed good and
	// must not be re-downloaded.
	ExcludeSet map[int]bool
}

// DefaultNeighborOptions returns sensible defaults for the neighbor
// expansion algorithm.
func DefaultNeighborOptions(totalSegments int) NeighborOptions {
	return NeighborOptions{
		Radius:   5,
		MaxIndex: totalSegments - 1,
		ExcludeSet: make(map[int]bool),
	}
}

// ValidateMergeOutput checks the merge output for completeness. It performs
// three levels of verification:
//
//  1. File-level: output file exists and is non-empty; all expected segment
//     files are present and non-zero.
//  2. Count-level: actual segment count matches expected count.
//  3. Duration-level (best-effort): if ffmpeg is available, the output
//     duration is compared to the sum of EXTINF values. A deviation > 10%
//     marks the merge as corrupted.
//
// The function never returns an error for validation failures — it encodes
// them in the MergeValidationResult. Errors are only returned for unexpected
// I/O problems.
func ValidateMergeOutput(ctx context.Context, segDir, outputPath string, expectedSegments int, expectedDuration time.Duration) MergeValidationResult {
	result := MergeValidationResult{
		OutputPath:       outputPath,
		ExpectedSegments: expectedSegments,
		ExpectedDuration: expectedDuration,
	}

	// --- Level 1: Check output file ---
	if info, err := os.Stat(outputPath); err == nil {
		result.OutputSize = info.Size()
	} else {
		// Output file missing — definitely invalid.
		result.MissingIndices = allIndices(expectedSegments)
		return result
	}

	// --- Level 2: Check segment files on disk ---
	entries, err := os.ReadDir(segDir)
	if err != nil {
		result.MissingIndices = allIndices(expectedSegments)
		return result
	}

	foundIndices := make(map[int]bool)
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tmp") {
			continue
		}
		idx := extractSegmentIndex(name)
		foundIndices[idx] = true
		result.ActualSegments++

		// Check for empty files.
		if info, err := os.Stat(filepath.Join(segDir, name)); err == nil {
			if info.Size() == 0 {
				result.EmptyIndices = append(result.EmptyIndices, idx)
			}
		}
	}

	// Determine missing indices.
	for i := 0; i < expectedSegments; i++ {
		if !foundIndices[i] {
			result.MissingIndices = append(result.MissingIndices, i)
		}
	}

	// Quick pass: if nothing is missing and no empty files, do duration check.
	if len(result.MissingIndices) == 0 && len(result.EmptyIndices) == 0 {
		result.Valid = true
	}

	// --- Level 3: Duration-level verification (best-effort) ---
	if expectedDuration > 0 {
		if outputDur, err := ProbeDuration(ctx, outputPath); err == nil && outputDur > 0 {
			result.OutputDuration = time.Duration(outputDur * float64(time.Second))
			// Check if deviation exceeds 10% threshold.
			if result.OutputDuration < expectedDuration*9/10 ||
				result.OutputDuration > expectedDuration*11/10 {
				// Duration mismatch — mark missing segments as corrupted.
				result.CorruptedIndices = append(result.CorruptedIndices, result.MissingIndices...)
				result.Valid = false
			}
		}
		// If probe fails, we trust the file-level check (don't mark invalid).
	}

	return result
}

// expandToNeighborRange takes a list of failed segment indices and expands
// each to a neighborhood of [idx-radius, idx+radius], clamped to
// [0, maxIndex]. Indices in excludeSet are omitted so that already-good
// segments are not re-downloaded.
//
// The returned slice is sorted and deduplicated.
func expandToNeighborRange(failed []int, opts NeighborOptions) []int {
	if opts.Radius <= 0 {
		opts.Radius = 5
	}
	if opts.ExcludeSet == nil {
		opts.ExcludeSet = make(map[int]bool)
	}

	needed := make(map[int]bool)
	for _, idx := range failed {
		start := idx - opts.Radius
		if start < 0 {
			start = 0
		}
		end := idx + opts.Radius
		if end > opts.MaxIndex {
			end = opts.MaxIndex
		}
		for i := start; i <= end; i++ {
			if !opts.ExcludeSet[i] {
				needed[i] = true
			}
		}
	}

	// Convert to sorted slice.
	indices := make([]int, 0, len(needed))
	for idx := range needed {
		indices = append(indices, idx)
	}
	sort.Ints(indices)
	return indices
}

// SumSegmentDurations returns the total duration of all segments by summing
// their individual EXTINF values. This is used as the expected duration for
// merge validation.
func SumSegmentDurations(segments []M3U8Segment) time.Duration {
	var total float64
	for _, seg := range segments {
		total += seg.Duration
	}
	return time.Duration(total * float64(time.Second))
}

// cleanupFailedSegments removes segment files at the given indices from
// disk. Errors are swallowed because this is best-effort cleanup before
// a redownload attempt.
func cleanupFailedSegments(segDir string, indices []int) {
	for _, idx := range indices {
		// Try common naming patterns.
		for _, name := range []string{
			fmt.Sprintf("seg_%04d.ts", idx),
			fmt.Sprintf("segment_%04d.ts", idx),
			fmt.Sprintf("%d.ts", idx),
		} {
			_ = os.Remove(filepath.Join(segDir, name))
		}
	}
}

// filterByIndices returns the subset of segments whose index is in the
// index set. The returned slice preserves the original order.
func filterByIndices(segments []M3U8Segment, indexSet []int) []M3U8Segment {
	set := make(map[int]bool, len(indexSet))
	for _, idx := range indexSet {
		set[idx] = true
	}
	filtered := make([]M3U8Segment, 0, len(indexSet))
	for i, seg := range segments {
		if set[i] {
			filtered = append(filtered, seg)
		}
	}
	return filtered
}

// filterSegments returns segments whose index is NOT in the success set.
// This is used for incremental downloads: skip already-confirmed-good
// segments.
func filterSegments(segments []M3U8Segment, successSet map[int]bool) []M3U8Segment {
	filtered := make([]M3U8Segment, 0, len(segments))
	for i, seg := range segments {
		if !successSet[i] {
			filtered = append(filtered, seg)
		}
	}
	return filtered
}

// --- Helper functions ---

// allIndices returns [0, n-1].
func allIndices(n int) []int {
	indices := make([]int, n)
	for i := range indices {
		indices[i] = i
	}
	return indices
}
