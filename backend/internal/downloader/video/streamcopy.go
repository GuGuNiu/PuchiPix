package video

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// copyCompatibleCodecs lists, per output container, the codecs that can be
// placed in that container by copying the elementary streams. Membership
// means "ffmpeg can mux these without transcoding", not "every combination is
// legal" — ffmpeg remains the final authority and will fail the copy if a
// combination turns out to be un-muxable, in which case the caller's
// re-encode fallback still applies.
var copyCompatibleCodecs = map[string]struct {
	video map[string]bool
	audio map[string]bool
}{
	".mp4": {
		video: setOf("h264", "hevc", "av1", "mpeg4", "vp9"),
		audio: setOf("aac", "mp3", "ac3", "eac3", "opus", "alac"),
	},
	".m4v": {
		video: setOf("h264", "hevc", "av1", "mpeg4"),
		audio: setOf("aac", "mp3", "ac3", "eac3", "opus"),
	},
	".mov": {
		video: setOf("h264", "hevc", "av1", "prores", "mpeg4"),
		audio: setOf("aac", "mp3", "ac3", "pcm_s16le", "alac"),
	},
	".mkv": {
		video: setOf("h264", "hevc", "av1", "vp9", "mpeg4", "vp8"),
		audio: setOf("aac", "mp3", "ac3", "eac3", "opus", "vorbis", "flac", "dts"),
	},
	".webm": {
		video: setOf("vp8", "vp9", "av1"),
		audio: setOf("opus", "vorbis"),
	},
}

func setOf(values ...string) map[string]bool {
	m := make(map[string]bool, len(values))
	for _, v := range values {
		m[v] = true
	}
	return m
}

// canStreamCopy reports whether the input media can be muxed into the output
// container by copying its streams, making a re-encode unnecessary.
//
// It is intentionally conservative. An unreadable probe, an unknown codec, or
// an unrecognized output extension all return false, so the worst outcome is
// falling back to the previous re-encode behaviour rather than emitting a
// file ffmpeg cannot produce.
func canStreamCopy(ctx context.Context, inputPath, outputPath string, concatInput bool) bool {
	meta, err := probeInputMedia(ctx, inputPath, concatInput)
	if err != nil {
		return false
	}
	return canStreamCopyCodecs(outputPath, meta)
}

// canStreamCopyCodecs is the codec-compatibility half of canStreamCopy,
// separated so the decision table can be exercised without an ffmpeg binary.
func canStreamCopyCodecs(outputPath string, meta VideoMetadata) bool {
	allowed, ok := copyCompatibleCodecs[strings.ToLower(filepath.Ext(outputPath))]
	if !ok {
		return false
	}
	// An unknown probe result (no video codec found) is never treated as
	// copyable: guessing here would risk producing an unplayable file.
	if !meta.HasVideo() {
		return false
	}
	if !allowed.video[strings.ToLower(meta.VideoCodec)] {
		return false
	}

	// A video-only source has no audio constraint to satisfy.
	if meta.AudioCodec == "" {
		return true
	}
	return allowed.audio[strings.ToLower(meta.AudioCodec)]
}

// probeInputMedia reads codec information for the media that will be fed to
// ffmpeg. When concatInput is true the input is a concat list rather than a
// media file, and `ffmpeg -i` cannot identify it on its own, so the first
// segment in playlist order is probed instead — its codecs are the codecs of
// the concatenation.
func probeInputMedia(ctx context.Context, inputPath string, concatInput bool) (VideoMetadata, error) {
	if !concatInput {
		return ProbeVideoMetadata(ctx, inputPath)
	}

	dir := filepath.Dir(inputPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return VideoMetadata{}, err
	}
	var segs []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tmp") {
			segs = append(segs, name)
		}
	}
	if len(segs) == 0 {
		return VideoMetadata{}, os.ErrNotExist
	}
	sort.Slice(segs, func(i, j int) bool {
		return extractSegmentIndex(segs[i]) < extractSegmentIndex(segs[j])
	})
	return ProbeVideoMetadata(ctx, filepath.Join(dir, segs[0]))
}
