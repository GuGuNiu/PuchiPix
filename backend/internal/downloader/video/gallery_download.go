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

// GalleryDownloadVideo downloads an M3U8 stream into saveDir and merges the
// segments into an MP4 file at outputPath.
//
// The m3u8URL must already be decoded from any MacCMS encoding, and referer
// must be the gallery page URL rather than the M3U8 URL, which CDNs reject.
func GalleryDownloadVideo(ctx context.Context, m3u8URL, saveDir, outputPath, referer string, refererDomains []string, opts GalleryVideoOptions) error {
	fetchResult, err := FetchAndParseM3U8(ctx, m3u8URL, M3U8FetchOptions{
		Referer:         referer,
		FallbackDomains: refererDomains,
	})
	if err != nil {
		return fmt.Errorf("fetch M3U8 playlist: %w", err)
	}

	// Publishing the segment count as soon as the playlist is parsed lets
	// the gallery pipeline widen its progress denominator immediately.
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

	// Reusing the same saveDir must not mix old-variant segments into the
	// new merge, so a changed playlist clears the cache.
	if EnsurePlaylistFingerprint(segDir, fetchResult.Segments) {
		m3u8Logger.Warn("Playlist changed since last run, segment cache reset",
			infra.LogContext{Extra: map[string]any{"output": outputPath}})
	}

	// The referer accepted during the M3U8 fetch is reused for segments,
	// which avoids repeated 403 rejections from the CDN.
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

	if len(batchResult.Failed) > 0 {
		return fmt.Errorf("incomplete segment download: %d/%d segments failed", len(batchResult.Failed), batchResult.Total)
	}

	gpuInfo := DetectGPU()
	forceType := opts.ForceGPUType
	if forceType == "" {
		forceType = string(gpuInfo.Type)
	}
	transcodeOpts := TranscodeOptions{
		UseGPU:           opts.UseGPU && gpuInfo.SupportsHWTranscode(),
		ForceGPUType:     forceType,
		ExpectedDuration: SumSegmentDurations(fetchResult.Segments),
	}
	manifest := SegmentManifest(fetchResult.Segments)
	if transcodeErr := TranscodeTSWithFallback(ctx, segDir, outputPath, manifest, transcodeOpts); transcodeErr != nil {
		return fmt.Errorf("transcode segments to MP4: %w", transcodeErr)
	}

	// All segments merged successfully — report the merge milestone so
	// the gallery progress can complete that video's final unit.
	emitProgress(GalleryVideoProgressEvent{SegmentsTotal: totalSegs, SegmentsDone: totalSegs, Merged: true})

	return nil
}
