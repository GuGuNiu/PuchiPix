package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"backend/internal/infra"
)

// MergeRetryOptions configures the merge retry loop.
type MergeRetryOptions struct {
	// MaxMergeRetries is the number of additional attempts after the
	// first failure. Default: 2 (total 3 attempts).
	MaxMergeRetries int
	// NeighborRadius is the range to extend around each failed segment
	// when computing the redownload set. Default: 5.
	NeighborRadius int
	// OutputPath is the final merged output file path.
	OutputPath string
	// SegDir is the directory where TS segments are stored.
	SegDir string
	// BatchOpts are passed to DownloadSegmentsBatch for segment fetching.
	BatchOpts SegmentBatchOptions
	// ExpectedDuration is the sum of EXTINF values from the M3U8
	// playlist. Used for duration-level validation. 0 skips the check.
	ExpectedDuration time.Duration

	// DurationTolerance is the maximum permitted relative deviation between
	// the merged output duration and ExpectedDuration. <= 0 selects the
	// package default (2%).
	DurationTolerance float64
	OnProgress        func(completed, total int)
	// OnRetry is invoked before each retry attempt (attempt >= 1) so
	// callers can report progress. May be nil.
	OnRetry func(attempt int, redownloadCount int, reason string)
	// PremergeCheck, when non-nil, reports that the merged output already
	// exists in final published form (tail-merge fast path), letting the
	// current attempt skip the merge and go straight to validation. It is
	// consulted until it returns true once; a validation failure then
	// falls through to the regular full-merge rounds.
	PremergeCheck func() bool
}

func DefaultMergeRetryOptions(outputPath, segDir string) MergeRetryOptions {
	return MergeRetryOptions{
		MaxMergeRetries: 2,
		NeighborRadius:  5,
		OutputPath:      outputPath,
		SegDir:          segDir,
		BatchOpts: SegmentBatchOptions{
			Concurrency: 10,
			MaxRetries:  3,
			SegDir:      segDir,
		},
	}
}

// MergeRetryLoop orchestrates download, merge, validate, and retry cycles.
// On failure it computes a targeted redownload set (failed segments and
// their neighborhood) and retries up to MaxMergeRetries times. The successSet
// tracks confirmed-good indices to avoid re-downloading working segments.
func MergeRetryLoop(
	ctx context.Context,
	segments []M3U8Segment,
	successSet map[int]bool,
	opts MergeRetryOptions,
) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(segments) == 0 {
		return fmt.Errorf("merge segment list is empty")
	}
	if opts.MaxMergeRetries <= 0 {
		opts.MaxMergeRetries = 2
	}
	if opts.NeighborRadius <= 0 {
		opts.NeighborRadius = 5
	}
	if opts.BatchOpts.Concurrency <= 0 {
		opts.BatchOpts.Concurrency = 10
	}
	if opts.BatchOpts.MaxRetries <= 0 {
		opts.BatchOpts.MaxRetries = 3
	}
	if opts.SegDir == "" {
		opts.SegDir = opts.BatchOpts.SegDir
	}
	if opts.BatchOpts.SegDir == "" {
		opts.BatchOpts.SegDir = opts.SegDir
	}

	logger := infra.NewLogger("MergeRetryLoop")
	if successSet == nil {
		successSet = make(map[int]bool)
	}

	if err := os.MkdirAll(filepath.Dir(opts.OutputPath), 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	// Working copy of segments — narrowed down on each retry.
	remaining := segments

	// The merge manifest is derived from the FULL playlist (not the
	// remaining subset): a targeted redownload re-creates missing files at
	// their canonical names before the merge runs.
	manifest := SegmentManifest(segments)

	// durationRetries bounds how many times the loop will re-download the
	// entire segment set purely because the merged duration deviated. A
	// duration mismatch carries no locality information, so the response is
	// always "redownload everything", and a source with systematically
	// inaccurate EXTINF would otherwise burn every attempt re-fetching all
	// segments before failing. One such retry is enough to distinguish a
	// genuinely incomplete first merge from a bad reference duration; beyond
	// that the result is accepted with a warning.
	durationRetries := 0
	const maxDurationOnlyRetries = 1

	for attempt := 0; attempt <= opts.MaxMergeRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		toDownload := filterSegments(remaining, successSet)
		if len(toDownload) == 0 {
			logger.Info("All segments confirmed good, attempting merge",
				"attempt", attempt+1)
		} else {
			logger.Info("Downloading segments",
				"count", len(toDownload), "attempt", attempt+1)

			batchResult := DownloadSegmentsBatch(ctx, toDownload, opts.BatchOpts)

			for _, idx := range batchResult.DownloadedIndices {
				successSet[idx] = true
			}

			if batchResult.Downloaded == 0 && len(batchResult.Failed) > 0 {
				return fmt.Errorf("all %d segment(s) failed to download", len(batchResult.Failed))
			}
		}

		mergeResult := (*MergeResult)(nil)
		if opts.PremergeCheck != nil && opts.PremergeCheck() {
			logger.Info("Skipping merge: output already published by tail merge",
				"attempt", attempt+1)
		} else {
			if opts.OnProgress != nil {
				opts.OnProgress(0, len(manifest))
			}
			result, err := MergeSegmentsContextWithProgress(ctx, opts.SegDir, opts.OutputPath, manifest, opts.OnProgress)
			if err != nil {
				logger.Warn("Merge failed",
					"attempt", attempt+1, "error", err.Error())
				if attempt == opts.MaxMergeRetries {
					return fmt.Errorf("merge failed after %d attempts: %w", attempt+1, err)
				}
				for idx := range successSet {
					delete(successSet, idx)
				}
				cleanupAllSegments(opts.SegDir)
				remaining = segments
				_ = os.Remove(opts.OutputPath)
				continue
			}
			mergeResult = result

			logger.Info("Merge completed",
				"files", mergeResult.TotalFiles, "size", mergeResult.TotalSize,
				"attempt", attempt+1)
		}

		validation := ValidateMergeOutputWithTolerance(
			ctx,
			opts.SegDir,
			opts.OutputPath,
			segments,
			manifest,
			opts.ExpectedDuration,
			opts.DurationTolerance,
		)

		if validation.Valid {
			if !validation.DurationVerified {
				logger.Warn("Merge validation passed on file-level checks only; duration was NOT verified",
					"segments", validation.ActualSegments)
			} else {
				logger.Info("Merge validation passed",
					"segments", validation.ActualSegments,
					"duration", validation.OutputDuration,
					"durationDeviationPct", validation.DurationDeviation*100)
			}
			return nil
		}

		// A duration-only failure has no locatable segment, so redownloading
		// the whole set is the only available remedy and it is rarely the
		// right one. Cap how many times that is attempted.
		fileLevelClean := len(validation.MissingIndices) == 0 && len(validation.EmptyIndices) == 0
		if fileLevelClean && durationRetries >= maxDurationOnlyRetries {
			logger.Warn("Accepting merge after repeated duration-only mismatches; playlist EXTINF is likely inaccurate",
				"segments", validation.ActualSegments,
				"expectedDuration", opts.ExpectedDuration,
				"actualDuration", validation.OutputDuration,
				"deviationPct", validation.DurationDeviation*100,
				"durationOnlyRetries", durationRetries)
			return nil
		}
		if fileLevelClean {
			durationRetries++
		}

		if attempt == opts.MaxMergeRetries {
			return fmt.Errorf("merge validation failed after %d attempts: %d missing, %d corrupted",
				attempt+1, len(validation.MissingIndices), len(validation.CorruptedIndices))
		}

		failedSet := make([]int, 0,
			len(validation.MissingIndices)+len(validation.CorruptedIndices)+len(validation.EmptyIndices))
		failedSet = append(failedSet, validation.MissingIndices...)
		failedSet = append(failedSet, validation.CorruptedIndices...)
		failedSet = append(failedSet, validation.EmptyIndices...)

		for _, idx := range failedSet {
			delete(successSet, idx)
		}

		redownloadIndices := expandToNeighborRange(failedSet, NeighborOptions{
			Radius:     opts.NeighborRadius,
			MaxIndex:   segments[len(segments)-1].Index,
			ExcludeSet: successSet,
		})

		if len(redownloadIndices) == 0 {
			return fmt.Errorf("merge validation failed: %d missing, no redownload candidates",
				len(validation.MissingIndices))
		}

		if opts.OnRetry != nil {
			opts.OnRetry(attempt+1, len(redownloadIndices),
				fmt.Sprintf("missing=%d corrupted=%d empty=%d",
					len(validation.MissingIndices),
					len(validation.CorruptedIndices),
					len(validation.EmptyIndices)))
		}

		cleanupFailedSegments(opts.SegDir, segments,
			append(append(validation.MissingIndices, validation.EmptyIndices...),
				validation.CorruptedIndices...))

		remaining = filterByIndices(segments, redownloadIndices)

		logger.Info("Retrying merge with targeted redownload",
			"attempt", attempt+2,
			"redownloadCount", len(redownloadIndices))
	}

	return fmt.Errorf("merge retry exhausted after %d attempts", opts.MaxMergeRetries)
}

func cleanupAllSegments(segDir string) {
	entries, err := os.ReadDir(segDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".ts") {
			_ = os.Remove(filepath.Join(segDir, entry.Name()))
		}
	}
}
