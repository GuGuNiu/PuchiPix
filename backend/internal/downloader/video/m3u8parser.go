package video

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"backend/internal/downloader"
	"backend/internal/infra"
)

var m3u8Logger = infra.NewLogger("DownloadManager")

// M3U8Segment represents a single media segment in an HLS playlist.
type M3U8Segment struct {
	URI     string
	FullURI string
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
	IsMaster        bool
	Segments        []M3U8Segment
	Variants        []M3U8Variant
	TargetDuration   int
}

// resolveURI converts a relative URI from an M3U8 playlist into an
// absolute URL using the playlist's base URL as the reference point.
func resolveURI(uri, baseURL string) string {
	if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
		return uri
	}

	if strings.HasPrefix(uri, "//") {
		return "https:" + uri
	}

	baseWithoutQuery := baseURL
	if idx := strings.IndexAny(baseWithoutQuery, "?#"); idx >= 0 {
		baseWithoutQuery = baseWithoutQuery[:idx]
	}

	lastSlash := strings.LastIndexByte(baseWithoutQuery, '/')
	if lastSlash > 8 {
		baseWithoutFile := baseWithoutQuery[:lastSlash+1]
		if strings.HasPrefix(uri, "/") {
			parsed, err := url.Parse(baseURL)
			if err == nil {
				return parsed.Scheme + "://" + parsed.Host + uri
			}
		}
		return baseWithoutFile + uri
	}

	if strings.HasPrefix(uri, "/") {
		parsed, err := url.Parse(baseURL)
		if err == nil {
			return parsed.Scheme + "://" + parsed.Host + uri
		}
	}

	return baseWithoutQuery + uri
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

// ParseM3U8 parses raw M3U8 text into a structured playlist, resolving
// all segment and variant URIs against the base URL.
func ParseM3U8(content, baseURL string) M3U8Playlist {
	lines := strings.Split(content, "\n")
	playlist := M3U8Playlist{
		TargetDuration: 10,
	}

	segmentIndex := 0
	var pendingDuration float64
	var pendingVariant *M3U8Variant

	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)

		if line == "" || line == "#EXTM3U" {
			continue
		}

		if strings.HasPrefix(line, "#EXTINF:") {
			pendingDuration = parseExtInfDuration(line)
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-TARGETDURATION:") {
			playlist.TargetDuration = parseIntAfterColon(line)
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			playlist.IsMaster = true
			pendingVariant = &M3U8Variant{
				Resolution: extractAttr(line, "RESOLUTION="),
				Bandwidth:  extractBandwidth(line),
			}
			continue
		}

		if strings.HasPrefix(line, "#") {
			continue
		}

		if playlist.IsMaster && pendingVariant != nil {
			full := resolveURI(line, baseURL)
			pendingVariant.URI = line
			pendingVariant.FullURI = full
			playlist.Variants = append(playlist.Variants, *pendingVariant)
			pendingVariant = nil
		} else if !playlist.IsMaster {
			full := resolveURI(line, baseURL)
			playlist.Segments = append(playlist.Segments, M3U8Segment{
				URI:      line,
				FullURI:  full,
				Duration: pendingDuration,
				Index:    segmentIndex,
			})
			segmentIndex++
			pendingDuration = 0
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

func parseExtInfDuration(line string) float64 {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return 0
	}
	rest := strings.TrimSpace(line[colon+1:])
	comma := strings.IndexByte(rest, ',')
	if comma >= 0 {
		rest = rest[:comma]
	}
	var dur float64
	if _, err := fmt.Sscanf(rest, "%f", &dur); err != nil {
		return 0
	}
	return dur
}

func parseIntAfterColon(line string) int {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return 0
	}
	rest := strings.TrimSpace(line[colon+1:])
	var n int
	if _, err := fmt.Sscanf(rest, "%d", &n); err != nil {
		return 0
	}
	return n
}

func extractAttr(line, prefix string) string {
	idx := strings.Index(line, prefix)
	if idx < 0 {
		return ""
	}
	start := idx + len(prefix)
	rest := line[start:]
	if comma := strings.IndexByte(rest, ','); comma >= 0 {
		return rest[:comma]
	}
	return strings.TrimSpace(rest)
}

func extractBandwidth(line string) int {
	const prefix = "BANDWIDTH="
	idx := strings.Index(line, prefix)
	if idx < 0 {
		return 0
	}
	start := idx + len(prefix)
	rest := line[start:]
	if comma := strings.IndexByte(rest, ','); comma >= 0 {
		rest = rest[:comma]
	}
	var n int
	if _, err := fmt.Sscanf(strings.TrimSpace(rest), "%d", &n); err != nil {
		return 0
	}
	return n
}
