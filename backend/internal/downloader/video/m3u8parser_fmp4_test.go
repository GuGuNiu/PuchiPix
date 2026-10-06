package video

import "testing"

// fmp4PlaylistFixture is the media playlist shape PORNHUB serves:
// #EXT-X-VERSION:6, an EXT-X-MAP init file, then fMP4 .m4s segments.
const fmp4PlaylistFixture = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:31
#EXT-X-ALLOW-CACHE:YES
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-MAP:URI="init-v1-a1.mp4?h=AAA%3D&e=1790595947&f=1"
#EXTINF:8.533,
seg-1-v1-a1.m4s?h=AAA%3D&e=1790595947&f=1
#EXTINF:17.067,
seg-2-v1-a1.m4s?h=AAA%3D&e=1790595947&f=1
#EXTINF:17.067,
seg-3-v1-a1.m4s?h=AAA%3D&e=1790595947&f=1
#EXT-X-ENDLIST
`

// tsPlaylistFixture is the shape XVIDEOS serves: plain MPEG-TS segments and
// no init file.
const tsPlaylistFixture = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.003333,
hls-480p-9d3e20.ts
#EXTINF:10.003333,
hls-480p-9d3e21.ts
#EXT-X-ENDLIST
`

const baseURL = "https://hv-h.phncdn.com/hls/c6251/videos/202608/24/60041855/1080P_4000K_60041855.mp4/"

// Without the EXT-X-MAP init file the concatenated output is unplayable:
// every fMP4 segment is a bare moof/mdat pair with no moov box.
func TestParseM3U8FragmentedMP4PutsInitFirst(t *testing.T) {
	playlist := ParseM3U8(fmp4PlaylistFixture, baseURL+"index-v1-a1.m3u8?h=AAA%3D")

	if !playlist.IsFragmentedMP4 {
		t.Fatal("IsFragmentedMP4 = false, want true when EXT-X-MAP is present")
	}
	if len(playlist.Segments) != 4 {
		t.Fatalf("segments = %d, want 4 (init + 3 media)", len(playlist.Segments))
	}

	init := playlist.Segments[0]
	if !init.IsInit {
		t.Error("Segments[0].IsInit = false, want true")
	}
	if init.Index != 0 {
		t.Errorf("init Index = %d, want 0", init.Index)
	}
	if init.Duration != 0 {
		t.Errorf("init Duration = %v, want 0", init.Duration)
	}
	if want := baseURL + "init-v1-a1.mp4?h=AAA%3D&e=1790595947&f=1"; init.FullURI != want {
		t.Errorf("init FullURI = %q, want %q", init.FullURI, want)
	}

	// Media segments must be shifted by the init slot, so indices stay
	// contiguous and never collide with the init index. The fixture's
	// MEDIA-SEQUENCE is 1, so they start at 2.
	for i, seg := range playlist.Segments[1:] {
		if seg.IsInit {
			t.Errorf("Segments[%d].IsInit = true, want false", i+1)
		}
		if seg.Index != i+2 {
			t.Errorf("Segments[%d].Index = %d, want %d", i+1, seg.Index, i+2)
		}
	}

	seen := make(map[int]bool)
	for _, seg := range playlist.Segments {
		if seen[seg.Index] {
			t.Errorf("duplicate segment index %d; the index must be unique per segment", seg.Index)
		}
		seen[seg.Index] = true
	}
}

func TestParseM3U8TransportStreamUnchanged(t *testing.T) {
	playlist := ParseM3U8(tsPlaylistFixture, baseURL+"hls-480p-9d3e2.m3u8?h=AAA%3D")

	if playlist.IsFragmentedMP4 {
		t.Error("IsFragmentedMP4 = true, want false for a plain TS playlist")
	}
	if len(playlist.Segments) != 2 {
		t.Fatalf("segments = %d, want 2", len(playlist.Segments))
	}
	for i, seg := range playlist.Segments {
		if seg.IsInit {
			t.Errorf("Segments[%d].IsInit = true, want false", i)
		}
		// Indices must be unchanged for the existing TS path so cached
		// segment files keep matching after the parser change.
		if seg.Index != i {
			t.Errorf("Segments[%d].Index = %d, want %d", i, seg.Index, i)
		}
	}
}

// A non-zero MEDIA-SEQUENCE must not collide with the init segment index.
func TestParseM3U8FragmentedMP4WithMediaSequenceOffset(t *testing.T) {
	playlist := ParseM3U8(fmp4PlaylistFixture, baseURL+"index.m3u8")
	if !playlist.IsFragmentedMP4 {
		t.Fatal("IsFragmentedMP4 = false, want true")
	}
	// MEDIA-SEQUENCE is 1 in the fixture, so media starts at index 2.
	if got := playlist.Segments[1].Index; got != 2 {
		t.Errorf("first media segment Index = %d, want 2 (media sequence 1 shifted by the init slot)", got)
	}
}

func TestParseM3U8MasterStillSelectsVariants(t *testing.T) {
	master := `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=815104,RESOLUTION=854x480,NAME="480p"
hls-480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1634304,RESOLUTION=1280x720,NAME="720p"
hls-720p.m3u8
`
	playlist := ParseM3U8(master, "https://hls-cdn77.xvideos-cdn.com/u/6/hls.m3u8")
	if !playlist.IsMaster {
		t.Fatal("IsMaster = false, want true")
	}
	if len(playlist.Variants) != 2 {
		t.Fatalf("variants = %d, want 2", len(playlist.Variants))
	}
	if got := SelectBestVariant(playlist.Variants); got != "https://hls-cdn77.xvideos-cdn.com/u/6/hls-720p.m3u8" {
		t.Errorf("SelectBestVariant() = %q, want the 720p variant", got)
	}
}

func TestParseM3U8InvalidInput(t *testing.T) {
	playlist := ParseM3U8("not a playlist at all", baseURL)
	if playlist.IsMaster || len(playlist.Segments) != 0 {
		t.Errorf("expected an empty playlist, got master=%v segments=%d", playlist.IsMaster, len(playlist.Segments))
	}
}

func TestResolveURI(t *testing.T) {
	tests := []struct {
		uri  string
		base string
		want string
	}{
		{"seg.m4s", "https://a.example/d/index.m3u8", "https://a.example/d/seg.m4s"},
		{"/abs/seg.m4s", "https://a.example/d/index.m3u8", "https://a.example/abs/seg.m4s"},
		{"https://b.example/seg.m4s", "https://a.example/d/index.m3u8", "https://b.example/seg.m4s"},
	}
	for _, tt := range tests {
		if got := resolveURI(tt.uri, tt.base); got != tt.want {
			t.Errorf("resolveURI(%q, %q) = %q, want %q", tt.uri, tt.base, got, tt.want)
		}
	}
}

// The manifest drives merge order, so an init segment present in the parsed
// playlist must appear first in it.
func TestSegmentManifestKeepsInitFirst(t *testing.T) {
	playlist := ParseM3U8(fmp4PlaylistFixture, baseURL+"index.m3u8")
	manifest := SegmentManifest(playlist.Segments)
	if len(manifest) != 4 {
		t.Fatalf("manifest len = %d, want 4", len(manifest))
	}
	if manifest[0] != SegmentFileName(playlist.Segments[0]) {
		t.Error("manifest[0] does not match the init segment")
	}
	for i, name := range manifest {
		if name == "" {
			t.Errorf("manifest[%d] is empty", i)
		}
	}
}
