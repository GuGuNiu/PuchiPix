package video

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"backend/internal/infra"
)

// GalleryVideoProgressEvent describes a progress milestone during gallery
// video download. It lets the orchestrator's gallery pipeline fold the
// TS segment count and the merge (transcode) step into the gallery's
// overall progress percentage, instead of treating each video as a
// single opaque unit.
type GalleryVideoProgressEvent struct {
	// SegmentsTotal is the number of TS segments once the M3U8 playlist
	// has been parsed (0 until known).
	SegmentsTotal int

	// SegmentsDone is the cumulative count of segments that finished
	// (succeeded or failed) so far for this video.
	SegmentsDone int

	// Merged is true once the TS→MP4 transcode/merge finishes
	// successfully.
	Merged bool
}

// GalleryVideoProgressFn is the callback type for GalleryDownloadVideo
// progress. Callers receive events as segments are discovered, segments
// complete, and the final merge finishes.
type GalleryVideoProgressFn func(ev GalleryVideoProgressEvent)

// GalleryVideoOptions bundles tunables for an embedded gallery video download.
type GalleryVideoOptions struct {
	// SegmentConcurrent limits concurrent TS segment downloads within
	// this stream (ts_segment_concurrent). <= 0 falls back to 10.
	SegmentConcurrent int
	// UseGPU enables hardware-accelerated TS→MP4 transcode/merge. When
	// true but no compatible GPU is present the merge falls back to CPU.
	UseGPU bool
	// ForceGPUType overrides the auto-detected encoder type ("" = auto).
	ForceGPUType string
	// OnProgress is invoked with segment/merge progress milestones; may
	// be nil to disable reporting.
	OnProgress GalleryVideoProgressFn
}

// GalleryDownloadVideo downloads an M3U8 video stream into saveDir and merges
// segments into an MP4 file at outputPath. It uses the unified M3U8 pipeline
// shared with the independent video pipeline for consistent Referer handling
// and CDN anti-hotlink fallback.
//
// The caller must decode any MacCMS-encoded URL before calling. The referer
// must be the gallery page URL, not the M3U8 URL itself (CDNs reject this).
func GalleryDownloadVideo(ctx context.Context, m3u8URL, saveDir, outputPath, referer string, refererDomains []string, opts GalleryVideoOptions) error {
	fetchResult, err := FetchAndParseM3U8(ctx, m3u8URL, M3U8FetchOptions{
		Referer:         referer,
		FallbackDomains: refererDomains,
	})
	if err != nil {
		return fmt.Errorf("fetch M3U8 playlist: %w", err)
	}

	// Announce the discovered segment count so the gallery pipeline can
	// add it to its progress denominator the moment it is known (rather
	// than waiting until the whole video finishes).
	totalSegs := len(fetchResult.Segments)
	var segMu sync.Mutex
	var doneSegs int
	emitProgress := func(ev GalleryVideoProgressEvent) {
		if opts.OnProgress != nil {
			opts.OnProgress(ev)
		}
	}
	emitProgress(GalleryVideoProgressEvent{SegmentsTotal: totalSegs})

	segDir := filepath.Join(saveDir, "segments")
	if mkdirErr := os.MkdirAll(segDir, 0755); mkdirErr != nil {
		return fmt.Errorf("create segments dir: %w", mkdirErr)
	}

	// Use the effective referer (accepted by the CDN) for all segment downloads
	// to avoid repeated 403 failures.
	segmentConcurrent := opts.SegmentConcurrent
	if segmentConcurrent <= 0 {
		segmentConcurrent = 10
	}
	batchResult := DownloadSegmentsBatch(ctx, fetchResult.Segments, SegmentBatchOptions{
		Concurrency: segmentConcurrent,
		MaxRetries:  3,
		SegDir:      segDir,
		Referer:     fetchResult.EffectiveReferer,
		OnSegmentDone: func(_ int, _ bool) {
			segMu.Lock()
			doneSegs++
			curr := doneSegs
			segMu.Unlock()
			emitProgress(GalleryVideoProgressEvent{SegmentsTotal: totalSegs, SegmentsDone: curr})
		},
	})

	if err := CheckSegmentFailureThreshold(batchResult); err != nil {
		return err
	}

	gpuInfo := DetectGPU()
	forceType := opts.ForceGPUType
	if forceType == "" {
		forceType = string(gpuInfo.Type)
	}
	transcodeOpts := TranscodeOptions{
		UseGPU:       opts.UseGPU && gpuInfo.SupportsHWTranscode(),
		ForceGPUType: forceType,
	}
	if transcodeErr := TranscodeTSWithFallback(ctx, segDir, outputPath, transcodeOpts); transcodeErr != nil {
		return fmt.Errorf("transcode segments to MP4: %w", transcodeErr)
	}

	// All segments merged successfully — report the merge milestone so
	// the gallery progress can complete that video's final unit.
	emitProgress(GalleryVideoProgressEvent{SegmentsTotal: totalSegs, SegmentsDone: totalSegs, Merged: true})

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
			continue
		}
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
