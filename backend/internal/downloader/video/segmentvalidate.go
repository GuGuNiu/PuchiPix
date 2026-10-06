package video

import (
	"fmt"
	"os"
)

// tsPacketSize is the fixed packet length of an MPEG-TS segment. A TS
// segment is a whole number of these, so a length that is not a multiple of
// 188 means the file is truncated mid-packet.
const tsPacketSize = 188

// segmentContainer identifies the media container of a downloaded segment.
type segmentContainer int

const (
	containerUnknown segmentContainer = iota
	containerMPEGTS
	containerISOBMFF
)

func (c segmentContainer) String() string {
	switch c {
	case containerMPEGTS:
		return "mpegts"
	case containerISOBMFF:
		return "isobmff"
	default:
		return "unknown"
	}
}

// segmentHeaderBytes is the number of leading bytes needed to classify a
// segment: a TS sync byte, or an ISO base media file type box.
const segmentHeaderBytes = 12

// detectSegmentContainer classifies a segment from its leading bytes rather
// than from playlist metadata. Playlist declarations cannot be trusted for
// this: CMAF playlists carry a separate EXT-X-MAP init segment whose bytes
// look like fMP4 while the media segments alongside it may be TS, and a
// mislabelled segment must not be rejected on a metadata technicality.
//
// An unrecognized header returns containerUnknown, which callers treat as
// "apply only the generic size checks" so an exotic but valid container is
// never failed for being unfamiliar.
func detectSegmentContainer(head []byte) segmentContainer {
	if len(head) >= 1 && head[0] == 0x47 {
		return containerMPEGTS
	}
	// ISO base media files carry a 'ftyp' box type at offset 4.
	if len(head) >= 8 && string(head[4:8]) == "ftyp" {
		return containerISOBMFF
	}
	return containerUnknown
}

// validateSegmentFile rejects a downloaded segment for the failure modes that
// a successful write alone cannot detect:
//
//   - truncation: the body is shorter than the server declared. A connection
//     dropped mid-transfer still produces a non-zero file, so a size>0 test
//     reports success for a half-written segment.
//   - wrong content: a CDN error page or captive-portal interstitial served
//     with HTTP 200 lands on disk as a non-empty file with no TS structure.
//   - mid-packet truncation: a TS segment whose length is not a whole number
//     of 188-byte packets.
//
// expectedSize is the server-declared Content-Length, or 0 when unknown
// (chunked encoding), in which case the completeness check is skipped.
//
// This runs on both freshly downloaded and already-cached segments, so a bad
// file left behind by an earlier run is re-fetched instead of being treated
// as a valid resume point.
func validateSegmentFile(path string, expectedSize int64) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("segment stat failed: %w", err)
	}
	size := info.Size()
	if size == 0 {
		return fmt.Errorf("segment is 0 bytes")
	}
	if expectedSize > 0 && size != expectedSize {
		return fmt.Errorf("segment truncated: got %d bytes, server declared %d", size, expectedSize)
	}

	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("segment open failed: %w", err)
	}
	defer f.Close()

	head := make([]byte, segmentHeaderBytes)
	n, err := f.ReadAt(head, 0)
	if err != nil && n < segmentHeaderBytes {
		// Too short to classify; the size checks above are all that apply.
		return nil
	}
	container := detectSegmentContainer(head[:n])

	switch container {
	case containerMPEGTS:
		if size%tsPacketSize != 0 {
			return fmt.Errorf("ts segment length %d is not a multiple of %d (mid-packet truncation)", size, tsPacketSize)
		}
		// The final packet must also start with a sync byte. Offset 0 is
		// already known good, so this catches a tail that is padded or
		// otherwise damaged while still passing the modulo check.
		last := make([]byte, 1)
		if _, err := f.ReadAt(last, size-tsPacketSize); err == nil && last[0] != 0x47 {
			return fmt.Errorf("ts segment final packet at offset %d missing sync byte (0x%02x)", size-tsPacketSize, last[0])
		}
	case containerISOBMFF:
		// fMP4 segments have no packet grid, so the size and declared-length
		// checks above are the meaningful ones. Requiring the ftyp box to be
		// the first box rules out HTML served with a 200.
		if !(len(head) >= 8 && string(head[4:8]) == "ftyp") {
			return fmt.Errorf("isobmff segment missing leading ftyp box")
		}
	}

	return nil
}
