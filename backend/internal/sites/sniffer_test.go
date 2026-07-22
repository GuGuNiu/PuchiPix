package sites

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSnifferStart verifies that the sniffer transitions to running
// state and records the target URL.
func TestSnifferStart(t *testing.T) {
	s := NewSniffer()
	err := s.Start(context.Background(), "https://example.com/video")
	require.NoError(t, err)

	status := s.GetStatus()
	assert.True(t, status.Running)
	assert.Equal(t, "https://example.com/video", status.TargetURL)
}

// TestSnifferStartAlreadyRunning verifies that starting an already
// running sniffer returns an error, preventing concurrent sessions.
func TestSnifferStartAlreadyRunning(t *testing.T) {
	s := NewSniffer()
	err := s.Start(context.Background(), "https://example.com/video1")
	require.NoError(t, err)

	err = s.Start(context.Background(), "https://example.com/video2")
	assert.Error(t, err)
	assert.Equal(t, ErrSnifferAlreadyRunning, err)
}

// TestSnifferStop verifies that stopping the sniffer sets running
// to false while preserving captured URLs.
func TestSnifferStop(t *testing.T) {
	s := NewSniffer()
	s.Start(context.Background(), "https://example.com/video")
	s.AddCapturedURL("https://example.com/stream.m3u8", "video.mp4")
	s.Stop()

	status := s.GetStatus()
	assert.False(t, status.Running)
	assert.Equal(t, 1, status.Captured, "captured URLs should be preserved after stop")
}

// TestSnifferAddCapturedURL verifies that URLs are added to the
// capture list with the correct type and metadata.
func TestSnifferAddCapturedURL(t *testing.T) {
	s := NewSniffer()
	s.Start(context.Background(), "https://example.com/video")

	s.AddCapturedURL("https://example.com/stream.m3u8", "video.mp4")
	urls := s.GetCapturedURLs()
	require.Len(t, urls, 1)
	assert.Equal(t, "https://example.com/stream.m3u8", urls[0].URL)
	assert.Equal(t, "m3u8", urls[0].Type)
	assert.Equal(t, "video.mp4", urls[0].Filename)
}

// TestSnifferAddCapturedURLDuplicate verifies that duplicate URLs
// are not added twice, preventing redundant entries.
func TestSnifferAddCapturedURLDuplicate(t *testing.T) {
	s := NewSniffer()
	s.Start(context.Background(), "https://example.com/video")

	s.AddCapturedURL("https://example.com/stream.m3u8", "a.mp4")
	s.AddCapturedURL("https://example.com/stream.m3u8", "b.mp4")

	urls := s.GetCapturedURLs()
	assert.Len(t, urls, 1, "duplicate URL should not be added")
}

// TestSnifferGetM3U8URLs verifies that only M3U8-type URLs are
// returned by GetM3U8URLs.
func TestSnifferGetM3U8URLs(t *testing.T) {
	s := NewSniffer()
	s.Start(context.Background(), "https://example.com/video")
	s.AddCapturedURL("https://example.com/stream.m3u8", "video.mp4")

	m3u8urls := s.GetM3U8URLs()
	require.Len(t, m3u8urls, 1)
	assert.Equal(t, "m3u8", m3u8urls[0].Type)
}

// TestSnifferGetStatusIdle verifies that a fresh sniffer reports
// not running with zero captures.
func TestSnifferGetStatusIdle(t *testing.T) {
	s := NewSniffer()
	status := s.GetStatus()
	assert.False(t, status.Running)
	assert.Equal(t, 0, status.Captured)
	assert.Empty(t, status.TargetURL)
}

// TestSnifferGetCapturedURLsCopy verifies that the returned slice
// is a copy, preventing external mutation of internal state.
func TestSnifferGetCapturedURLsCopy(t *testing.T) {
	s := NewSniffer()
	s.Start(context.Background(), "https://example.com")
	s.AddCapturedURL("https://example.com/a.m3u8", "a.mp4")

	urls := s.GetCapturedURLs()
	urls[0].URL = "modified"

	urls2 := s.GetCapturedURLs()
	assert.NotEqual(t, "modified", urls2[0].URL, "internal state should not be affected by external modification")
}
