package video

import "testing"

// TestCanStreamCopyCodecs pins the stream-copy decision table. The bug this
// guards against is a copy being chosen for a combination the output
// container cannot hold, which would produce an unplayable file.
func TestCanStreamCopyCodecs(t *testing.T) {
	tests := []struct {
		name   string
		output string
		meta   VideoMetadata
		want   bool
	}{
		{"h264 aac into mp4 copies", "out.mp4", VideoMetadata{VideoCodec: "h264", AudioCodec: "aac"}, true},
		{"h264 aac uppercase codec", "out.mp4", VideoMetadata{VideoCodec: "H264", AudioCodec: "AAC"}, true},
		{"h264 without audio into mp4 copies", "out.mp4", VideoMetadata{VideoCodec: "h264"}, true},
		{"hevc aac into mp4 copies", "out.mp4", VideoMetadata{VideoCodec: "hevc", AudioCodec: "aac"}, true},
		{"vp8 into mp4 does not copy", "out.mp4", VideoMetadata{VideoCodec: "vp8", AudioCodec: "aac"}, false},
		{"h264 vorbis into mp4 does not copy", "out.mp4", VideoMetadata{VideoCodec: "h264", AudioCodec: "vorbis"}, false},
		{"vp9 opus into webm copies", "out.webm", VideoMetadata{VideoCodec: "vp9", AudioCodec: "opus"}, true},
		{"h264 into webm does not copy", "out.webm", VideoMetadata{VideoCodec: "h264", AudioCodec: "aac"}, false},
		{"unknown output extension does not copy", "out.bin", VideoMetadata{VideoCodec: "h264", AudioCodec: "aac"}, false},
		{"no extension does not copy", "out", VideoMetadata{VideoCodec: "h264", AudioCodec: "aac"}, false},
		{"unknown probe result does not copy", "out.mp4", VideoMetadata{}, false},
		{"uppercase extension is handled", "OUT.MP4", VideoMetadata{VideoCodec: "h264", AudioCodec: "aac"}, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := canStreamCopyCodecs(tc.output, tc.meta); got != tc.want {
				t.Fatalf("canStreamCopyCodecs(%q, %+v) = %v, want %v",
					tc.output, tc.meta, got, tc.want)
			}
		})
	}
}

func TestVideoMetadataHasVideo(t *testing.T) {
	if (VideoMetadata{}).HasVideo() {
		t.Fatal("empty metadata must not report a video stream")
	}
	if !(VideoMetadata{VideoCodec: "h264"}).HasVideo() {
		t.Fatal("metadata with a video codec must report a video stream")
	}
}
