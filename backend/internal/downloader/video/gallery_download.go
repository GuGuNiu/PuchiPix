package video

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
)

// GalleryDownloadVideo downloads an M3U8 video stream into the specified
// output directory and merges segments into an MP4 file. This is the
// gallery-pipeline equivalent of the standalone video pipeline's M3U8
// download logic, ported from the TS implementation that merged image
// and video tasks into a single unified concurrency pool.
func GalleryDownloadVideo(ctx context.Context, m3u8URL, saveDir, outputPath string) error {
	// Fetch M3U8 playlist content.
	playlist, err := FetchM3U8Content(ctx, m3u8URL, m3u8URL)
	if err != nil {
		return fmt.Errorf("fetch M3U8 playlist: %w", err)
	}

	// Resolve the base URL for relative segment URIs.
	baseURL := m3u8URL
	if parsed, parseErr := url.Parse(m3u8URL); parseErr == nil {
		baseURL = parsed.ResolveReference(&url.URL{Path: "./"}).String()
	}

	parsed := ParseM3U8(playlist, baseURL)

	// For master playlists, select the highest bandwidth variant.
	segments := parsed.Segments
	if parsed.IsMaster && len(parsed.Variants) > 0 {
		best := parsed.Variants[0]
		for _, v := range parsed.Variants[1:] {
			if v.Bandwidth > best.Bandwidth {
				best = v
			}
		}
		variantPlaylist, fetchErr := FetchM3U8Content(ctx, best.FullURI, best.FullURI)
		if fetchErr != nil {
			return fmt.Errorf("fetch variant playlist: %w", fetchErr)
		}
		parsed2 := ParseM3U8(variantPlaylist, best.FullURI)
		segments = parsed2.Segments
	}

	if len(segments) == 0 {
		return fmt.Errorf("no segments found in M3U8 playlist")
	}

	// Create segments directory.
	segDir := filepath.Join(saveDir, "segments")
	if mkdirErr := os.MkdirAll(segDir, 0755); mkdirErr != nil {
		return fmt.Errorf("create segments dir: %w", mkdirErr)
	}

	// Download segments with fault-tolerant concurrency. A WaitGroup +
	// channel semaphore replaces errgroup.WithContext to prevent fail-fast
	// cascading cancellation: when one segment times out, other in-flight
	// segments continue downloading instead of being aborted via ctx.Done().
	// Segment downloads use DownloadSegment for exponential backoff
	// retry (1s→2s→4s, up to 3 attempts) and built-in resume (os.Stat
	// check skips already-downloaded files). Concurrency is lowered from
	// the TS default of 50 to 10 to reduce CDN rate-limiting risk.
	segConcurrent := 10
	var segMu sync.Mutex
	var downloadedSegs int
	var failedSegs []int
	var wg sync.WaitGroup
	sem := make(chan struct{}, segConcurrent)

	for i, seg := range segments {
		i, seg := i, seg
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := DownloadSegment(ctx, SegmentTask{
				Segment:  seg,
				DestDir:  segDir,
				TSID:     fmt.Sprintf("seg_%04d", i),
				Referer:  m3u8URL,
			}, 3)

			segMu.Lock()
			if result.Error != nil {
				failedSegs = append(failedSegs, i)
			} else {
				downloadedSegs++
			}
			segMu.Unlock()
		}()
	}
	wg.Wait()

	// Tolerate partial segment failure: only report an error when more
	// than 20% of segments failed. This matches the independent video
	// pipeline behavior where FailedSegments are recorded without aborting
	// the entire download. Below threshold, the merge step skips missing
	// segments and produces a valid but truncated output.
	if len(failedSegs) > 0 && len(failedSegs)*5 > len(segments) {
		return fmt.Errorf("too many segments failed: %d/%d", len(failedSegs), len(segments))
	}

	if downloadedSegs == 0 {
		return fmt.Errorf("all %d segments failed to download", len(segments))
	}

	// Merge segments into MP4 output.
	if mergeErr := MergeSegmentsToMP4(segDir, outputPath, len(segments)); mergeErr != nil {
		return fmt.Errorf("merge segments: %w", mergeErr)
	}

	return nil
}

// MergeSegmentsToMP4 concatenates downloaded TS segments into a single
// MP4 file using binary concatenation (TS format supports this directly).
// Missing segments are skipped silently to tolerate partial download
// failures within the 20% threshold enforced by the caller.
func MergeSegmentsToMP4(segDir, outputPath string, totalSegs int) error {
	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer out.Close()

	written := 0
	for i := 0; i < totalSegs; i++ {
		segPath := filepath.Join(segDir, fmt.Sprintf("seg_%04d.ts", i))
		data, readErr := os.ReadFile(segPath)
		if readErr != nil {
			continue // skip missing segments from partial failures
		}
		if _, writeErr := out.Write(data); writeErr != nil {
			return fmt.Errorf("write segment %d: %w", i, writeErr)
		}
		written++
	}

	if written == 0 {
		return fmt.Errorf("no segments available for merge")
	}

	return nil
}
