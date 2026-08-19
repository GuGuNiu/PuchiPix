package video

import "testing"

func TestParseM3U8MediaPlaylist(t *testing.T) {
	content := `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:9.009,
seg1.ts
#EXTINF:9.009,
seg2.ts
#EXTINF:8.0,
seg3.ts
`
	baseURL := "https://cdn.example.com/path/master.m3u8"

	pl := ParseM3U8(content, baseURL)

	if pl.IsMaster {
		t.Fatal("expected media playlist, got master")
	}
	if len(pl.Variants) != 0 {
		t.Fatalf("expected 0 variants, got %d", len(pl.Variants))
	}
	if len(pl.Segments) != 3 {
		t.Fatalf("expected 3 segments, got %d", len(pl.Segments))
	}
	if pl.TargetDuration != 10 {
		t.Fatalf("TargetDuration = %d, want 10", pl.TargetDuration)
	}

	// Index must be media-sequence offset: unique per segment.
	wantIndex := []int{100, 101, 102}
	for i, seg := range pl.Segments {
		if seg.Index != wantIndex[i] {
			t.Errorf("Segments[%d].Index = %d, want %d", i, seg.Index, wantIndex[i])
		}
	}

	if pl.Segments[0].FullURI != "https://cdn.example.com/path/seg1.ts" {
		t.Errorf("Segments[0].FullURI = %q, want resolved absolute URL", pl.Segments[0].FullURI)
	}
	if pl.Segments[0].Duration != 9.009 {
		t.Errorf("Segments[0].Duration = %v, want 9.009", pl.Segments[0].Duration)
	}
}

func TestParseM3U8MasterPlaylist(t *testing.T) {
	content := `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720
video-720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080
video-1080.m3u8
`
	baseURL := "https://cdn.example.com/path/master.m3u8"

	pl := ParseM3U8(content, baseURL)

	if !pl.IsMaster {
		t.Fatal("expected master playlist")
	}
	if len(pl.Segments) != 0 {
		t.Fatalf("expected 0 media segments, got %d", len(pl.Segments))
	}
	if len(pl.Variants) != 2 {
		t.Fatalf("expected 2 variants, got %d", len(pl.Variants))
	}

	v := pl.Variants[1]
	if v.Bandwidth != 2560000 {
		t.Errorf("Variants[1].Bandwidth = %d, want 2560000", v.Bandwidth)
	}
	if v.Resolution != "1920x1080" {
		t.Errorf("Variants[1].Resolution = %q, want 1920x1080", v.Resolution)
	}
	if v.FullURI != "https://cdn.example.com/path/video-1080.m3u8" {
		t.Errorf("Variants[1].FullURI = %q, want resolved absolute URL", v.FullURI)
	}

	if got := SelectBestVariant(pl.Variants); got != "https://cdn.example.com/path/video-1080.m3u8" {
		t.Errorf("SelectBestVariant = %q, want highest-bandwidth variant", got)
	}
}

func TestParseM3U8Empty(t *testing.T) {
	pl := ParseM3U8("", "https://cdn.example.com/master.m3u8")
	if pl.IsMaster {
		t.Fatal("empty input should not be a master playlist")
	}
	if len(pl.Segments) != 0 || len(pl.Variants) != 0 {
		t.Fatal("empty input should produce no segments or variants")
	}
}