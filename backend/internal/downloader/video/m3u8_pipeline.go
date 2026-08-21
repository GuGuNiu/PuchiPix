package video

import (
	"context"
	"fmt"
	"sync"

	"backend/internal/infra"
)

// M3U8FetchOptions configures the M3U8 fetch-and-parse behavior.
type M3U8FetchOptions struct {
	// Referer is the primary Referer header sent with M3U8 content
	// requests. Typically the source page URL (e.g. the video detail
	// page). Must NOT be the CDN URL itself — CDNs reject requests
	// whose Referer domain is not in their whitelist.
	Referer string

	// FallbackDomains are alternative referer domains tried when the
	// primary Referer is rejected by the CDN (HTTP 403). Each domain
	// is formatted as an origin URL (https://domain/) and used as the
	// Referer header in sequence until one succeeds.
	FallbackDomains []string
}

// M3U8FetchResult holds the complete result of a unified M3U8
// fetch+parse cycle. Callers use Segments and EffectiveReferer to
// drive segment downloads.
type M3U8FetchResult struct {
	// Segments is the fully resolved segment list ready for download.
	// For master playlists, this comes from the selected variant's
	// media playlist. For media playlists, this is the direct segment
	// list.
	Segments []M3U8Segment

	// EffectiveReferer is the Referer value that was accepted by the
	// CDN. It may differ from the primary Referer if a fallback domain
	// was used. Callers MUST pass this as the Referer for all
	// subsequent segment downloads to avoid repeated 403 failures.
	EffectiveReferer string

	// Playlist is the parsed M3U8 playlist of the initial URL (not
	// the variant playlist). Useful for inspecting TargetDuration
	// and other metadata.
	Playlist M3U8Playlist

	// IsMaster reports whether the initial playlist was a master
	// playlist with variants.
	IsMaster bool

	// VariantURL is the URL of the selected variant playlist (empty
	// when IsMaster is false).
	VariantURL string
}

// FetchAndParseM3U8 is the unified entry point for M3U8 content fetching
// and parsing. Callers MUST use this function instead of FetchM3U8Content
// or FetchM3U8ContentWithRefererFallback directly to ensure consistent
// Referer handling and error reporting across all pipelines.
func FetchAndParseM3U8(ctx context.Context, m3u8URL string, opts M3U8FetchOptions) (*M3U8FetchResult, error) {
	if m3u8URL == "" {
		return nil, fmt.Errorf("M3U8 URL is empty")
	}

	content, effectiveReferer, err := FetchM3U8ContentWithRefererFallback(ctx, m3u8URL, opts.Referer, opts.FallbackDomains)
	if err != nil {
		return nil, fmt.Errorf("fetch M3U8 content: %w", err)
	}

	playlist := ParseM3U8(content, m3u8URL)

	var segments []M3U8Segment
	var variantURL string
	if playlist.IsMaster && len(playlist.Variants) > 0 {
		variantURL = SelectBestVariant(playlist.Variants)
		if variantURL == "" {
			return nil, fmt.Errorf("no valid variant found in master playlist")
		}

		m3u8Logger.Info("Selected variant from master playlist",
			infra.LogContext{Extra: map[string]any{
				"m3u8URL":   m3u8URL,
				"variant":   variantURL,
				"referer":   effectiveReferer,
			}})

		// Fetch variant playlist using the same effective Referer
		// that succeeded for the master playlist.
		variantContent, variantEffectiveReferer, err := FetchM3U8ContentWithRefererFallback(
			ctx, variantURL, effectiveReferer, opts.FallbackDomains)
		if err != nil {
			return nil, fmt.Errorf("fetch variant playlist: %w", err)
		}

		// Update effectiveReferer in case the variant fetch succeeded
		// with a different fallback domain.
		if variantEffectiveReferer != "" {
			effectiveReferer = variantEffectiveReferer
		}

		variantPlaylist := ParseM3U8(variantContent, variantURL)
		segments = variantPlaylist.Segments
	} else {
		segments = playlist.Segments
	}

	if len(segments) == 0 {
		return nil, fmt.Errorf("no segments found in M3U8 playlist")
	}

	return &M3U8FetchResult{
		Segments:         segments,
		EffectiveReferer: effectiveReferer,
		Playlist:         playlist,
		IsMaster:         playlist.IsMaster,
		VariantURL:       variantURL,
	}, nil
}

// SegmentBatchOptions configures concurrent segment downloading.
type SegmentBatchOptions struct {
	// Concurrency is the maximum number of simultaneous segment
	// downloads. Default: 10. Higher values risk CDN rate-limiting.
	Concurrency int

	// MaxRetries is the maximum number of retry attempts per segment.
	// Default: 3. Retries use exponential backoff (1s→2s→4s).
	MaxRetries int

	// SegDir is the directory where segment .ts files are saved.
	SegDir string

	// Referer is the Referer header for segment HTTP requests.
	// Should be the EffectiveReferer from FetchAndParseM3U8 result.
	Referer string

	// OnSegmentDone is invoked (from each segment worker, under the same
	// mutex protecting the counters) after a segment finishes, whether
	// it succeeded or failed. index is the segment's position in the
	// playlist; completed is true on success. This lets callers fold
	// segment-level progress into an aggregate progress percentage
	// (e.g. images + TS segments + merge step) instead of treating an
	// entire video as a single opaque unit.
	OnSegmentDone func(index int, completed bool)
}

// SegmentBatchResult holds the outcome of a batch segment download.
type SegmentBatchResult struct {
	// Downloaded is the count of successfully downloaded segments.
	Downloaded int

	// DownloadedIndices holds the indices of successfully downloaded
	// segments. Used by MergeRetryLoop to build the incremental
	// success set.
	DownloadedIndices []int

	// Failed holds the indices of segments that failed all retries.
	Failed []int

	// Total is the total number of segments in the batch.
	Total int
}

// DownloadSegmentsBatch downloads M3U8 segments concurrently. Individual
// segment failures do not cancel other in-flight segments. Callers should
// check the Failed/Total ratio to decide whether to tolerate partial failures.
func DownloadSegmentsBatch(ctx context.Context, segments []M3U8Segment, opts SegmentBatchOptions) SegmentBatchResult {
	if opts.Concurrency <= 0 {
		opts.Concurrency = 10
	}
	if opts.MaxRetries <= 0 {
		opts.MaxRetries = 3
	}

	total := len(segments)
	var segMu sync.Mutex
	var downloadedSegs int
	var downloadedIndices []int
	var failedSegs []int
	var wg sync.WaitGroup
	sem := make(chan struct{}, opts.Concurrency)

	for i, seg := range segments {
		i, seg := i, seg
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := DownloadSegment(ctx, SegmentTask{
				Segment: seg,
				DestDir: opts.SegDir,
				TSID:    fmt.Sprintf("seg_%04d", i),
				Referer: opts.Referer,
			}, opts.MaxRetries)

			segMu.Lock()
			if result.Error != nil {
				failedSegs = append(failedSegs, i)
			} else {
				downloadedSegs++
				downloadedIndices = append(downloadedIndices, i)
			}
			if opts.OnSegmentDone != nil {
				opts.OnSegmentDone(i, result.Error == nil)
			}
			segMu.Unlock()
		}()
	}
	wg.Wait()

	return SegmentBatchResult{
		Downloaded:        downloadedSegs,
		DownloadedIndices: downloadedIndices,
		Failed:            failedSegs,
		Total:             total,
	}
}

// CheckSegmentFailureThreshold returns an error if the failure ratio
// exceeds the 20% tolerance threshold, matching the behavior of both
// the gallery and independent video pipelines. Below the threshold,
// the merge step skips missing segments and produces a valid but
// truncated output.
func CheckSegmentFailureThreshold(result SegmentBatchResult) error {
	if len(result.Failed) > 0 && len(result.Failed)*5 > result.Total {
		return fmt.Errorf("too many segments failed: %d/%d", len(result.Failed), result.Total)
	}
	if result.Downloaded == 0 {
		return fmt.Errorf("all %d segments failed to download", result.Total)
	}
	return nil
}
