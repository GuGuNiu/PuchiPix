package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadDefaults(t *testing.T) {
	os.Unsetenv("DB_PATH")
	os.Unsetenv("SERVER_PORT")
	os.Unsetenv("LOG_LEVEL")
	os.Unsetenv("LOG_SINK_CAPACITY")
	os.Unsetenv("SQLITE_SOURCE_PATH")

	cfg, err := Load()
	require.NoError(t, err)

	assert.NotEmpty(t, cfg.DatabasePath)
	assert.Contains(t, cfg.DatabasePath, "puchipix.db")
	assert.Equal(t, 10541, cfg.ServerPort)
	assert.Equal(t, "INFO", cfg.LogLevel)
	assert.Equal(t, 1000, cfg.LogSinkCapacity)
	assert.NotEmpty(t, cfg.SQLiteSourcePath)
}

func TestLoadEnvOverride(t *testing.T) {
	t.Setenv("DB_PATH", "/tmp/test_puchipix.db")
	t.Setenv("SERVER_PORT", "8080")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("LOG_SINK_CAPACITY", "500")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "/tmp/test_puchipix.db", cfg.DatabasePath)
	assert.Equal(t, 8080, cfg.ServerPort)
	assert.Equal(t, "DEBUG", cfg.LogLevel)
	assert.Equal(t, 500, cfg.LogSinkCapacity)
}

func TestLoadInvalidLogLevel(t *testing.T) {
	t.Setenv("LOG_LEVEL", "TRACE")

	_, err := Load()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid LOG_LEVEL")
}

func TestLoadLowSinkCapacityClamped(t *testing.T) {
	t.Setenv("LOG_SINK_CAPACITY", "10")

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, 1000, cfg.LogSinkCapacity, "capacity below 100 should be clamped to 1000")
}

func TestLoadDownloadDefaults(t *testing.T) {
	os.Unsetenv("DOWNLOAD_MULTI_THREAD")
	os.Unsetenv("DOWNLOAD_CONCURRENCY")
	os.Unsetenv("DOWNLOAD_MAX_SPEED")
	os.Unsetenv("DOWNLOAD_MIN_FILE_SIZE")
	os.Unsetenv("GALLERY_IMAGE_CONCURRENT")
	os.Unsetenv("VIDEO_MAX_CONCURRENT")
	os.Unsetenv("TS_SEGMENT_CONCURRENT")

	cfg, err := Load()
	require.NoError(t, err)

	assert.False(t, cfg.DownloadMultiThread)
	assert.Equal(t, 4, cfg.DownloadConcurrency)
	assert.Equal(t, int64(0), cfg.DownloadMaxSpeed)
	assert.Equal(t, int64(1<<20), cfg.DownloadMinFileSize)
	assert.Equal(t, 5, cfg.GalleryImageConcurrent)
	assert.Equal(t, 3, cfg.VideoMaxConcurrent)
	assert.Equal(t, 10, cfg.TSegmentConcurrent)
}

func TestLoadDownloadConcurrencyClamped(t *testing.T) {
	t.Setenv("DOWNLOAD_CONCURRENCY", "1")
	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, 2, cfg.DownloadConcurrency, "below 2 should clamp to 2")

	t.Setenv("DOWNLOAD_CONCURRENCY", "99")
	cfg, err = Load()
	require.NoError(t, err)
	assert.Equal(t, 8, cfg.DownloadConcurrency, "above 8 should clamp to 8")
}

func TestLoadDownloadMultiThread(t *testing.T) {
	t.Setenv("DOWNLOAD_MULTI_THREAD", "true")
	cfg, err := Load()
	require.NoError(t, err)
	assert.True(t, cfg.DownloadMultiThread)
}
