package video

import (
	"context"
	"os"
	"path/filepath"
	"sort"
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

func DefaultNeighborOptions(totalSegments int) NeighborOptions {
	return NeighborOptions{
		Radius:     5,
		MaxIndex:   totalSegments - 1,
		ExcludeSet: make(map[int]bool),
	}
}

// ValidateMergeOutput checks the merge output for completeness at three levels:
// file-level (output and segments exist, non-empty), count-level (segment count
// matches), and duration-level (deviation within 10% of expected). Validation
// failures are encoded in the result, not returned as errors.
//
// The segments slice is the authoritative identity set: a segment exists iff
// its canonical file (SegmentFileName) is present and non-empty. Keying on the
// same identity the downloader writes also keeps non-manifest residue (stale
// outputs, foreign variants) out of the "actual" segment count.
func ValidateMergeOutput(ctx context.Context, segDir, outputPath string, segments []M3U8Segment, manifest []string, expectedDuration time.Duration) MergeValidationResult {
	result := MergeValidationResult{
		OutputPath:       outputPath,
		ExpectedSegments: len(segments),
		ExpectedDuration: expectedDuration,
	}

	if info, err := os.Stat(outputPath); err == nil {
		result.OutputSize = info.Size()
	} else {
		result.MissingIndices = segmentIndices(segments)
		return result
	}

	if len(manifest) != len(segments) {
		// Caller contract violation; treat every segment as missing
		// rather than guessing.
		result.MissingIndices = segmentIndices(segments)
		return result
	}

	for i, seg := range segments {
		result.ActualSegments++ // expected slots counted; invalidated below if absent
		info, err := os.Stat(filepath.Join(segDir, manifest[i]))
		if err != nil {
			result.ActualSegments--
			result.MissingIndices = append(result.MissingIndices, seg.Index)
			continue
		}
		if info.Size() == 0 {
			result.ActualSegments--
			result.EmptyIndices = append(result.EmptyIndices, seg.Index)
		}
	}

	if len(result.MissingIndices) == 0 && len(result.EmptyIndices) == 0 {
		result.Valid = true
	}

	if expectedDuration > 0 {
		if outputDur, err := ProbeDuration(ctx, outputPath); err == nil && outputDur > 0 {
			result.OutputDuration = time.Duration(outputDur * float64(time.Second))
			if result.OutputDuration < expectedDuration*9/10 ||
				result.OutputDuration > expectedDuration*11/10 {
				// A duration mismatch with no file-level finding means the
				// corruption is real but unlocalized, so the full expected set
				// becomes the redownload candidate set; an empty candidate set
				// would abort the retry loop on every attempt.
				result.CorruptedIndices = segmentIndices(segments)
				result.Valid = false
			}
		}
		// A failed probe leaves the file-level verdict unchanged.
	}

	return result
}

// expandToNeighborRange takes a list of failed segment indices and expands
// each to a neighborhood of [idx-radius, idx+radius], clamped to
// [0, maxIndex]. Indices in excludeSet are omitted so that already-good
// segments are not re-downloaded.
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

	indices := make([]int, 0, len(needed))
	for idx := range needed {
		indices = append(indices, idx)
	}
	sort.Ints(indices)
	return indices
}

// SumSegmentDurations returns the total duration of all segments by summing
// their individual EXTINF values, used as the expected duration for merge
// validation.
func SumSegmentDurations(segments []M3U8Segment) time.Duration {
	var total float64
	for _, seg := range segments {
		total += seg.Duration
	}
	return time.Duration(total * float64(time.Second))
}

// cleanupFailedSegments removes the canonical segment files for the given
// indices from disk. Errors are swallowed because this is best-effort
// cleanup before a redownload attempt.
func cleanupFailedSegments(segDir string, segments []M3U8Segment, indices []int) {
	indexSet := make(map[int]bool, len(indices))
	for _, idx := range indices {
		indexSet[idx] = true
	}
	for _, seg := range segments {
		if indexSet[seg.Index] {
			_ = os.Remove(filepath.Join(segDir, SegmentFileName(seg)))
		}
	}
}

// filterByIndices returns the subset of segments whose playlist Index is
// in the index set. Index (not slice position) is the contract: validation
// findings and neighbor expansion both operate in Index space, which may
// be offset from slice positions by M3U8 media-sequence numbers.
func filterByIndices(segments []M3U8Segment, indexSet []int) []M3U8Segment {
	set := make(map[int]bool, len(indexSet))
	for _, idx := range indexSet {
		set[idx] = true
	}
	filtered := make([]M3U8Segment, 0, len(indexSet))
	for _, seg := range segments {
		if set[seg.Index] {
			filtered = append(filtered, seg)
		}
	}
	return filtered
}

// filterSegments returns segments whose index is NOT in the success set.
// This is used for incremental downloads: skip already-confirmed-good
// segments. The success set is keyed by playlist Index (the same key the
// segment queue and download batch report).
func filterSegments(segments []M3U8Segment, successSet map[int]bool) []M3U8Segment {
	filtered := make([]M3U8Segment, 0, len(segments))
	for _, seg := range segments {
		if !successSet[seg.Index] {
			filtered = append(filtered, seg)
		}
	}
	return filtered
}

// segmentIndices returns the playlist Index values of all segments, in
// order. Used as the full redownload candidate set when validation fails
// without localizable findings (e.g. duration mismatch).
func segmentIndices(segments []M3U8Segment) []int {
	indices := make([]int, len(segments))
	for i, seg := range segments {
		indices[i] = seg.Index
	}
	return indices
}
