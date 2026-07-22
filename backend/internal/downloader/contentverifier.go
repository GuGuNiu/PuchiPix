package downloader

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	titleCountPattern = regexp.MustCompile(`(?i)(\d+)P\s*(?:(\d+)V)?\s*(?:(\d+)G)?\s*$`)
	segmentIdxPattern = regexp.MustCompile(`_(\d+)\.ts$`)
)

var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".webp": true, ".bmp": true, ".tiff": true,
}

var videoExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".ts": true, ".m4v": true,
}

// TitleCount holds the expected image and video counts parsed from
// a gallery title containing patterns like "73P2V" or "100P".
type TitleCount struct {
	ExpectedImages int
	ExpectedVideos int
}

// ParseTitleCount extracts expected image and video counts from a title
// string ending in patterns like "73P" or "100P2V3G".
func ParseTitleCount(title string) TitleCount {
	if title == "" {
		return TitleCount{}
	}

	m := titleCountPattern.FindStringSubmatch(title)
	if m == nil {
		return TitleCount{}
	}

	images := atoiSafe(m[1])
	videos := atoiSafe(m[2])
	gifs := atoiSafe(m[3])

	return TitleCount{
		ExpectedImages: images + gifs,
		ExpectedVideos: videos,
	}
}

// FileCounts holds the number of images, videos, and other files
// found in an extracted archive directory.
type FileCounts struct {
	ImageCount int
	VideoCount int
	OtherCount int
	TotalCount int
}

// CountExtractedFiles walks a directory tree and counts files by
// their extension, classifying them as images, videos, or other.
func CountExtractedFiles(extractPath string) FileCounts {
	var counts FileCounts

	info, err := os.Stat(extractPath)
	if err != nil || !info.IsDir() {
		return counts
	}

	walkFiles(extractPath, func(name string) {
		ext := strings.ToLower(filepath.Ext(name))
		switch {
		case imageExtensions[ext]:
			counts.ImageCount++
		case videoExtensions[ext]:
			counts.VideoCount++
		default:
			counts.OtherCount++
		}
	})

	counts.TotalCount = counts.ImageCount + counts.VideoCount + counts.OtherCount
	return counts
}

// VerificationResult reports whether extracted content matches the
// expected file counts within a tolerance threshold.
type VerificationResult struct {
	FileCounts
	ExpectedImages      int
	ExpectedVideos      int
	Matched             bool
	NeedsFallbackScrape bool
	Reason              string
}

// VerifyExtractedContent checks whether the extracted file counts
// match the expected values within a tolerance of 2 files.
func VerifyExtractedContent(extractPath string, expectedImages, expectedVideos int) VerificationResult {
	counts := CountExtractedFiles(extractPath)

	if expectedImages == 0 && expectedVideos == 0 {
		return VerificationResult{
			FileCounts:         counts,
			ExpectedImages:     expectedImages,
			ExpectedVideos:     expectedVideos,
			Matched:            true,
			NeedsFallbackScrape: false,
		}
	}

	imageDiff := expectedImages - counts.ImageCount
	videoDiff := expectedVideos - counts.VideoCount

	imageMatched := expectedImages == 0 || imageDiff <= 2
	videoMatched := expectedVideos == 0 || videoDiff <= 2

	matched := imageMatched && videoMatched

	var reason string
	if !matched {
		var parts []string
		if !imageMatched {
			parts = append(parts, fmt.Sprintf("image mismatch: expected %d, actual %d", expectedImages, counts.ImageCount))
		}
		if !videoMatched {
			parts = append(parts, fmt.Sprintf("video mismatch: expected %d, actual %d", expectedVideos, counts.VideoCount))
		}
		reason = strings.Join(parts, "; ")
	}

	return VerificationResult{
		FileCounts:          counts,
		ExpectedImages:      expectedImages,
		ExpectedVideos:      expectedVideos,
		Matched:             matched,
		NeedsFallbackScrape: !matched,
		Reason:              reason,
	}
}

// DownloadSource identifies the type of download URL for routing.
type DownloadSource string

const (
	SourceOuo       DownloadSource = "ouo"
	SourceMediafire DownloadSource = "mediafire"
	SourceDirect    DownloadSource = "direct"
	SourceUnknown   DownloadSource = "unknown"
)

// DetectDownloadSource classifies a download URL by its hostname and
// file extension to determine the appropriate download strategy.
func DetectDownloadSource(rawURL string) DownloadSource {
	if rawURL == "" {
		return SourceUnknown
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return SourceUnknown
	}

	hostname := strings.ToLower(parsed.Hostname())

	if strings.Contains(hostname, "ouo.io") || strings.Contains(hostname, "ouo.press") {
		return SourceOuo
	}
	if strings.Contains(hostname, "mediafire.com") {
		return SourceMediafire
	}

	lower := strings.ToLower(rawURL)
	if matched, _ := regexp.MatchString(`\.(zip|rar|7z)(\?|$)`, lower); matched {
		return SourceDirect
	}

	return SourceUnknown
}

func walkFiles(dir string, fn func(name string)) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		name := entry.Name()
		if name == ".DS_Store" || name == "__MACOSX" || strings.HasPrefix(name, ".") {
			continue
		}

		fullPath := filepath.Join(dir, name)
		if entry.IsDir() {
			walkFiles(fullPath, fn)
		} else {
			fn(name)
		}
	}
}

func atoiSafe(s string) int {
	if s == "" {
		return 0
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}
