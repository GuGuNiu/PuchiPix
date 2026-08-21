package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"backend/internal/db/dbconfig"
)

// Config holds all runtime configuration for the PuchiPix backend.
type Config struct {
	DatabasePath     string
	ServerPort       int
	LogLevel         string
	LogSinkCapacity  int
	SQLiteSourcePath string
	DataDir          string
	// Download tuning — multi-thread Range download and concurrency.
	DownloadMultiThread    bool
	DownloadConcurrency    int
	DownloadMaxSpeed       int64
	DownloadMinFileSize    int64
	GalleryImageConcurrent int
	VideoMaxConcurrent     int
	// TSegmentConcurrent limits concurrent TS segment downloads within a
	// single gallery-embedded M3U8 stream. This mirrors the independent
	// video pipeline's ts_segment_concurrent setting so the two channels
	// (gallery image vs video segment) stay independently tunable.
	TSegmentConcurrent int
	// GlobalDownloadConcurrent caps the TOTAL number of simultaneous
	// HTTP download requests (images, files, and video TS segments) across
	// the process. Acts as an aggregate pressure valve on top of the DAG
	// scheduler's task-level slot pool so a large batch import cannot
	// burst past this many in-flight requests. 0 restores the default.
	GlobalDownloadConcurrent int
}

func Load() (*Config, error) {
	dbPath := dbconfig.GetDSN()

	cfg := &Config{
		DatabasePath:     dbPath,
		ServerPort:       getEnvInt("SERVER_PORT", 10541),
		LogLevel:         strings.ToUpper(getEnv("LOG_LEVEL", "INFO")),
		LogSinkCapacity:  getEnvInt("LOG_SINK_CAPACITY", 1000),
		SQLiteSourcePath: dbPath,
		DataDir:          resolveDataDir(dbPath),

		DownloadMultiThread:    getEnvBool("DOWNLOAD_MULTI_THREAD", false),
		DownloadConcurrency:    clampInt(getEnvInt("DOWNLOAD_CONCURRENCY", 4), 2, 8),
		DownloadMaxSpeed:       getEnvInt64("DOWNLOAD_MAX_SPEED", 0),
		DownloadMinFileSize:    getEnvInt64("DOWNLOAD_MIN_FILE_SIZE", 1<<20),
		GalleryImageConcurrent: clampInt(getEnvInt("GALLERY_IMAGE_CONCURRENT", 5), 1, 20),
		VideoMaxConcurrent:     clampInt(getEnvInt("VIDEO_MAX_CONCURRENT", 3), 1, 10),
		TSegmentConcurrent:     clampInt(getEnvInt("TS_SEGMENT_CONCURRENT", 10), 1, 50),
		GlobalDownloadConcurrent: clampInt(getEnvInt("GLOBAL_DOWNLOAD_CONCURRENT", 64), 4, 256),
	}

	if cfg.LogSinkCapacity < 100 {
		cfg.LogSinkCapacity = 1000
	}
	if cfg.DownloadMinFileSize < 0 {
		cfg.DownloadMinFileSize = 1 << 20
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	validLevels := map[string]bool{
		"DEBUG": true,
		"INFO":  true,
		"WARN":  true,
		"ERROR": true,
	}
	if !validLevels[c.LogLevel] {
		return fmt.Errorf("invalid LOG_LEVEL %q: must be DEBUG, INFO, WARN, or ERROR", c.LogLevel)
	}
	if c.DatabasePath == "" {
		return fmt.Errorf("database path must not be empty")
	}
	if c.ServerPort < 1 || c.ServerPort > 65535 {
		return fmt.Errorf("SERVER_PORT must be between 1 and 65535, got %d", c.ServerPort)
	}
	return nil
}

// resolveDataDir computes an absolute data directory path so downloads
// always land in PuchiPix/data/ regardless of the current working directory.
func resolveDataDir(dbPath string) string {
	if envDir := os.Getenv("DATA_DIR"); envDir != "" {
		if abs, err := filepath.Abs(envDir); err == nil {
			return abs
		}
		return envDir
	}

	if dbPath != "" {
		dir := filepath.Dir(dbPath)
		if abs, err := filepath.Abs(dir); err == nil {
			return abs
		}
		return dir
	}

	abs, _ := filepath.Abs("../data")
	return abs
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if num, err := strconv.Atoi(val); err == nil {
			return num
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if val := os.Getenv(key); val != "" {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if val := os.Getenv(key); val != "" {
		if num, err := strconv.ParseInt(val, 10, 64); err == nil {
			return num
		}
	}
	return fallback
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
