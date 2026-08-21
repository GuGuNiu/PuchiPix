package video

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/grafov/m3u8"

	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/stealth"
)

var m3u8Logger = infra.NewLogger("DownloadManager")

// M3U8Segment represents a single media segment in an HLS playlist.
type M3U8Segment struct {
	URI      string
	FullURI  string
	Duration float64
	Index    int
}

// M3U8Variant represents an alternative rendition in a master playlist.
type M3U8Variant struct {
	URI        string
	FullURI    string
	Resolution string
	Bandwidth  int
}

// M3U8Playlist holds the parsed structure of an M3U8 file, either a
// master playlist with variants or a media playlist with segments.
type M3U8Playlist struct {
	IsMaster       bool
	Segments       []M3U8Segment
	Variants       []M3U8Variant
	TargetDuration int
}

// resolveURI converts a relative URI from an M3U8 playlist into an
// absolute URL using the playlist's base URL as the reference point.
// Uses the standard library's url.ResolveReference for RFC 3986 compliant
// resolution, replacing the previous hand-written 30-line implementation.
func resolveURI(uri, baseURL string) string {
	if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
		return uri
	}

	base, err := url.Parse(baseURL)
	if err != nil {
		return uri
	}

	ref, err := url.Parse(uri)
	if err != nil {
		return uri
	}

	return base.ResolveReference(ref).String()
}

// FetchM3U8Content retrieves M3U8 playlist text from the given URL
// with domain fallback support, so mirror domains are tried when the
// primary domain is unreachable.
func FetchM3U8Content(ctx context.Context, m3u8URL, referer string) (string, error) {
	headers := map[string]string{
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Accept":     "*/*",
	}
	if referer != "" {
		headers["Referer"] = referer
	}

	return downloader.FetchTextWithDomainFallback(ctx, m3u8URL, headers)
}

// FetchM3U8ContentWithRefererFallback tries the primary referer first,
// then falls back to alternative referer domains when the CDN returns
// 403 (anti-hotlink). It returns the content, the effective referer that
// succeeded, and any error.
//
// Fallback domains are ordered by health (healthy first, rate-limited
// last) using the shared DomainHealthTracker, and domains that fail are
// automatically marked as rate-limited so they are deprioritized in
// subsequent calls. This provides adaptive failover that learns from
// previous failures across all concurrent requests.
func FetchM3U8ContentWithRefererFallback(ctx context.Context, m3u8URL, referer string, fallbackDomains []string) (string, string, error) {
	content, err := FetchM3U8Content(ctx, m3u8URL, referer)
	if err == nil {
		return content, referer, nil
	}

	if len(fallbackDomains) == 0 {
		return "", referer, err
	}

	// Order fallback domains by health: healthy domains first (shuffled
	// for load distribution), rate-limited domains in cooldown last.
	// This prevents repeatedly trying domains that are known to be
	// rejecting requests (e.g., CDN 403, rate limiting).
	healthTracker := stealth.GetDomainHealthTracker()
	orderedDomains := healthTracker.GetAllDomainsOrdered(fallbackDomains)

	m3u8Logger.Warn("Primary referer rejected, trying fallback domains",
		infra.LogContext{Extra: map[string]any{
			"m3u8URL":        m3u8URL,
			"primaryReferer": referer,
			"error":          err.Error(),
			"fallbackCount":  len(orderedDomains),
		}})

	var lastErr error
	for _, domain := range orderedDomains {
		fallbackReferer := domain
		if !strings.HasPrefix(fallbackReferer, "http://") && !strings.HasPrefix(fallbackReferer, "https://") {
			fallbackReferer = "https://" + fallbackReferer
		}
		// Ensure it ends with / for a clean origin referer.
		if !strings.HasSuffix(fallbackReferer, "/") {
			fallbackReferer = fallbackReferer + "/"
		}

		content, err := FetchM3U8Content(ctx, m3u8URL, fallbackReferer)
		if err == nil {
			m3u8Logger.Info("Fallback referer accepted by CDN",
				infra.LogContext{Extra: map[string]any{
					"m3u8URL":          m3u8URL,
					"effectiveReferer": fallbackReferer,
				}})
			return content, fallbackReferer, nil
		}

		// Mark the domain as rate-limited so it's deprioritized in
		// future calls. This builds adaptive failover across all
		// concurrent requests without central coordination.
		healthTracker.MarkRateLimited(domain)
		lastErr = err

		m3u8Logger.Debug("Fallback referer also rejected",
			infra.LogContext{Extra: map[string]any{
				"domain": domain,
				"error":  err.Error(),
			}})
	}

	return "", referer, fmt.Errorf("all referer domains rejected by CDN: %w", lastErr)
}

// ParseM3U8 parses raw M3U8 text into a structured playlist, resolving
// all segment and variant URIs against the base URL.
//
// Parsing is delegated to the mature community library grafov/m3u8
// instead of a hand-written parser. The library handles master/media
// playlist detection, EXT-X-STREAM-INF attribute parsing, encryption
// tags, and other HLS edge cases that the previous hand-rolled loop did
// not. The result is mapped onto the project's M3U8Segment /
// M3U8Variant / M3U8Playlist types so all callers and the progress
// engine are unaffected.
func ParseM3U8(content, baseURL string) M3U8Playlist {
	playlist := M3U8Playlist{
		TargetDuration: 10,
	}

	pl, listType, err := m3u8.DecodeFrom(strings.NewReader(content), false)
	if err != nil {
		return playlist
	}

	switch listType {
	case m3u8.MASTER:
		master, ok := pl.(*m3u8.MasterPlaylist)
		if !ok {
			return playlist
		}
		playlist.IsMaster = true
		for _, v := range master.Variants {
			if v == nil {
				continue
			}
			full := resolveURI(v.URI, baseURL)
			playlist.Variants = append(playlist.Variants, M3U8Variant{
				URI:        v.URI,
				FullURI:    full,
				Resolution: v.Resolution,
				Bandwidth:  int(v.Bandwidth),
			})
		}
	case m3u8.MEDIA:
		media, ok := pl.(*m3u8.MediaPlaylist)
		if !ok {
			return playlist
		}
		if media.TargetDuration > 0 {
			playlist.TargetDuration = int(media.TargetDuration)
		}
		seqOffset := int(media.SeqNo)
		for i, seg := range media.Segments {
			if seg == nil {
				continue
			}
			full := resolveURI(seg.URI, baseURL)
			// Index is the media sequence offset. It must be unique per
			// segment because it is used as the key for progress tracking
			// (CompletedSegments / FailedSegments) and TSID generation.
			playlist.Segments = append(playlist.Segments, M3U8Segment{
				URI:      seg.URI,
				FullURI:  full,
				Duration: seg.Duration,
				Index:    seqOffset + i,
			})
		}
	}

	return playlist
}

// SelectBestVariant picks the variant with the highest bandwidth,
// matching the TypeScript sort-by-bandwidth-descending behavior.
func SelectBestVariant(variants []M3U8Variant) string {
	if len(variants) == 0 {
		return ""
	}
	if len(variants) == 1 {
		return variants[0].FullURI
	}

	best := variants[0]
	for _, v := range variants[1:] {
		if v.Bandwidth > best.Bandwidth {
			best = v
		}
	}
	return best.FullURI
}
