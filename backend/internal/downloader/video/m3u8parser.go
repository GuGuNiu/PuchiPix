package video

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

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
	// IsInit marks the fMP4 initialization segment declared by EXT-X-MAP.
	// CMAF playlists (pornhub, for one) put the moov box in a separate
	// file that must be written before every media segment, otherwise the
	// concatenated file is unplayable. It carries Index 0 and no duration.
	IsInit bool
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
	// IsFragmentedMP4 reports whether the media playlist declares an
	// EXT-X-MAP initialization segment, i.e. the segments are fMP4/CMAF
	// rather than MPEG-TS.
	IsFragmentedMP4 bool
}

// resolveURI converts a relative URI from an M3U8 playlist into an
// absolute URL, using url.ResolveReference for RFC 3986 compliant
// resolution.
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
//
// The full browser header set is mandatory rather than cosmetic: CDNs
// fronted by Cloudflare (pornhub's hv-h.phncdn.com among them) answer
// HTTP 410 Gone to requests that only carry User-Agent, Accept and
// Referer, so a stripped header set silently breaks every download.
func FetchM3U8Content(ctx context.Context, m3u8URL, referer string) (string, error) {
	headers := stealth.CDNRequestHeaders(nil, referer, stealth.FetchDestEmpty)

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

	// Order fallback domains by health: healthy domains first, rate-limited
	// domains in cooldown last. This prevents repeatedly trying domains that
	// are known to be rejecting requests (e.g., CDN 403, rate limiting).
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

		started := time.Now()
		content, err := FetchM3U8Content(ctx, m3u8URL, fallbackReferer)
		rtt := time.Since(started)
		if err == nil {
			// A referer that just worked must be credited. Without this the
			// domain stays in the cooling bucket for the rest of the window
			// and is skipped by the next task even though it is the one
			// origin the CDN accepts.
			healthTracker.ReportOutcome(domain, rtt, nil)
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
		healthTracker.ReportOutcome(domain, rtt, err)
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
// Parsing is delegated to grafov/m3u8, which handles master/media
// playlist detection, EXT-X-STREAM-INF attribute parsing, and encryption
// tags. The result is mapped onto M3U8Segment / M3U8Variant /
// M3U8Playlist.
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

		// An EXT-X-MAP initialization segment becomes segment index 0 so
		// every downstream consumer (progress indexing, manifest, index
		// buffer, concat) writes it before the media segments without
		// needing a separate code path. Media segments shift by one to
		// keep indices contiguous.
		offset := 0
		if uri := firstInitURI(media); uri != "" {
			playlist.IsFragmentedMP4 = true
			playlist.Segments = append(playlist.Segments, M3U8Segment{
				URI:     uri,
				FullURI: resolveURI(uri, baseURL),
				Index:   0,
				IsInit:  true,
			})
			offset = 1
		}

		seqOffset := int(media.SeqNo) + offset
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

// firstInitURI returns the EXT-X-MAP URI of the first segment that declares
// one. Playlists that mix mapped and unmapped segments are treated as
// declaring an init segment, because omitting the moov box would corrupt the
// merged output.
func firstInitURI(media *m3u8.MediaPlaylist) string {
	for _, seg := range media.Segments {
		if seg != nil && seg.Map != nil && seg.Map.URI != "" {
			return seg.Map.URI
		}
	}
	return ""
}

// SelectBestVariant picks the variant with the highest bandwidth.
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
