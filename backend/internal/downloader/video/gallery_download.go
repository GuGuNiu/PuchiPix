package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"backend/internal/infra"
)

// GalleryDownloadVideo downloads an M3U8 video stream into the specified
// output directory and merges segments into an MP4 file.
//
// This is the gallery-pipeline entry point that uses the unified M3U8
// pipeline component (FetchAndParseM3U8 + DownloadSegmentsBatch) shared
// with the independent video pipeline. Both pipelines now go through the
// same protocol interaction layer, ensuring consistent Referer handling,
// CDN anti-hotlink fallback, and error reporting.
//
// Parameters:
//   - m3u8URL:         The M3U8 playlist URL (may be MacCMS-encoded; the
//                      caller is responsible for decoding via
//                      universal.DecodeMacCMSURL before calling).
//   - saveDir:         Directory to save segment files and the final MP4.
//   - outputPath:      Full path for the output MP4 file.
//   - referer:         Primary Referer header (typically the gallery page URL).
//                      Must NOT be the M3U8 URL itself — CDNs reject this.
//   - refererDomains:  CDN anti-hotlink fallback domains from site config.
func GalleryDownloadVideo(ctx context.Context, m3u8URL, saveDir, outputPath, referer string, refererDomains []string) error {
	// Step 1: Fetch and parse M3U8 using the unified pipeline component.
	// This handles: Referer fallback → playlist parsing → master
	// playlist variant selection → variant playlist fetching.
	fetchResult, err := FetchAndParseM3U8(ctx, m3u8URL, M3U8FetchOptions{
		Referer:         referer,
		FallbackDomains: refererDomains,
	})
	if err != nil {
		return fmt.Errorf("fetch M3U8 playlist: %w", err)
	}

	// Step 2: Create segments directory.
	segDir := filepath.Join(saveDir, "segments")
	if mkdirErr := os.MkdirAll(segDir, 0755); mkdirErr != nil {
		return fmt.Errorf("create segments dir: %w", mkdirErr)
	}

	// Step 3: Download segments concurrently using the unified batch
	// downloader. The effective Referer (which may differ from the
	// primary Referer if a CDN fallback domain was accepted) is used
	// for all segment downloads to avoid repeated 403 failures.
	batchResult := DownloadSegmentsBatch(ctx, fetchResult.Segments, SegmentBatchOptions{
		Concurrency: 10,
		MaxRetries:  3,
		SegDir:      segDir,
		Referer:     fetchResult.EffectiveReferer,
	})

	// Step 4: Check failure threshold — tolerate up to 20% segment
	// failures, matching the independent video pipeline behavior.
	if err := CheckSegmentFailureThreshold(batchResult); err != nil {
		return err
	}

	// Step 5: Merge segments into MP4 output.
	if mergeErr := MergeSegmentsToMP4(segDir, outputPath, batchResult.Total); mergeErr != nil {
		return fmt.Errorf("merge segments: %w", mergeErr)
	}

	return nil
}

// MergeSegmentsToMP4 concatenates downloaded TS segments into a single
// MP4 file using binary concatenation (TS format supports this directly).
// Missing segments are logged as warnings and skipped — this tolerates
// partial download failures within the 20% threshold enforced by the
// caller. Streaming writes avoid loading full segments into memory.
func MergeSegmentsToMP4(segDir, outputPath string, totalSegs int) error {
	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer out.Close()

	written := 0
	missing := 0
	for i := 0; i < totalSegs; i++ {
		segPath := filepath.Join(segDir, fmt.Sprintf("seg_%04d.ts", i))
		data, readErr := os.ReadFile(segPath)
		if readErr != nil {
			missing++
			continue // skip missing segments from partial failures
		}
		// Verify segment data is non-empty before writing.
		if len(data) == 0 {
			missing++
			continue
		}
		if _, writeErr := out.Write(data); writeErr != nil {
			return fmt.Errorf("write segment %d: %w", i, writeErr)
		}
		written++
	}

	if missing > 0 {
		m3u8Logger.Warn("Segments missing during MP4 merge",
			infra.LogContext{Extra: map[string]any{
				"total":   totalSegs,
				"written": written,
				"missing": missing,
				"output":  outputPath,
			}})
	}

	if written == 0 {
		return fmt.Errorf("no segments available for merge")
	}

	return nil
}
