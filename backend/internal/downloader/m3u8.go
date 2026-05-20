package downloader

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"puchipix-backend/pkg/logger"
	"puchipix-backend/pkg/utils"
)

type M3U8Playlist struct {
	Version        int
	TargetDuration float64
	Segments       []SegmentInfo
	Variants       []VariantInfo
	IsMaster       bool
}

type SegmentInfo struct {
	Index    int
	Duration float64
	URI      string
	FullURI  string
}

type VariantInfo struct {
	Bandwidth  int
	Resolution string
	URI        string
	FullURI    string
}

func ParseM3U8(content string, baseURL string) (*M3U8Playlist, error) {
	playlist := &M3U8Playlist{}
	lines := strings.Split(content, "\n")

	var targetDuration float64
	var segmentIndex int

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		switch {
		case line == "#EXTM3U":
			continue

		case strings.HasPrefix(line, "#EXT-X-VERSION:"):
			fmt.Sscanf(line, "#EXT-X-VERSION:%d", &playlist.Version)

		case strings.HasPrefix(line, "#EXT-X-TARGETDURATION:"):
			fmt.Sscanf(line, "#EXT-X-TARGETDURATION:%f", &targetDuration)
			playlist.TargetDuration = targetDuration

		case line == "#EXT-X-STREAM-INF" || strings.HasPrefix(line, "#EXT-X-STREAM-INF:"):
			variant := VariantInfo{}
			bandwidthStr := extractTagValue(line, "BANDWIDTH")
			if bandwidthStr != "" {
				fmt.Sscanf(bandwidthStr, "%d", &variant.Bandwidth)
			}
			variant.Resolution = extractTagValue(line, "RESOLUTION")

			if i+1 < len(lines) {
				i++
				variant.URI = strings.TrimSpace(lines[i])
				variant.FullURI = utils.ResolveRelativeURL(baseURL, variant.URI)
			}
			playlist.Variants = append(playlist.Variants, variant)
			playlist.IsMaster = true

		case strings.HasPrefix(line, "#EXTINF:"):
			segment := SegmentInfo{}
			durationStr := extractTagValue(line, "EXTINF")
			durationStr = strings.TrimSuffix(durationStr, ",")
			fmt.Sscanf(durationStr, "%f", &segment.Duration)
			segment.Index = segmentIndex

			if i+1 < len(lines) {
				i++
				segment.URI = strings.TrimSpace(lines[i])
				segment.FullURI = utils.ResolveRelativeURL(baseURL, segment.URI)
			}
			playlist.Segments = append(playlist.Segments, segment)
			segmentIndex++

		case strings.HasPrefix(line, "#EXT-X-ENDLIST"):
			break
		}
	}

	if targetDuration > 0 {
		playlist.TargetDuration = targetDuration
	}

	if len(playlist.Segments) == 0 && !playlist.IsMaster {
		return nil, fmt.Errorf("no segments found in playlist")
	}

	return playlist, nil
}

func FetchM3U8Content(m3u8URL string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", m3u8URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d fetching m3u8", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	logger.Debug("Fetched M3U8 content (%d bytes) from %s", len(body), m3u8URL)
	return string(body), nil
}

func extractTagValue(line, tag string) string {
	prefix := fmt.Sprintf("#%s:", tag)
	if !strings.Contains(line, prefix) {
		return ""
	}
	idx := strings.Index(line, prefix)
	rest := line[idx+len(prefix):]

	if strings.Contains(rest, ",") && tag != "EXTINF" {
		parts := strings.SplitN(rest, ",", 2)
		return strings.TrimSpace(parts[0])
	}

	commaIdx := strings.Index(rest, ",")
	if commaIdx >= 0 && tag == "EXTINF" {
		return rest[:commaIdx]
	}

	return strings.TrimSpace(rest)
}
