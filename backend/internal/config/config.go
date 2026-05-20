package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Port            string `json:"port"`
	DBPath          string `json:"db_path"`
	DownloadPath    string `json:"download_path"`
	ChromeDriverPath string `json:"chromedriver_path"`
	LogLevel        string `json:"log_level"`
	CORSEnabled     bool   `json:"cors_enabled"`
	MaxConcurrent   int    `json:"max_concurrent"`
	SegmentRetries  int    `json:"segment_retries"`
	FFmpegPath      string `json:"ffmpeg_path"`
}

func DefaultConfig() *Config {
	baseDir, _ := os.Getwd()
	dataDir := filepath.Join(baseDir, "data")
	videosDir := filepath.Join(dataDir, "videos")

	return &Config{
		Port:            "10540",
		DBPath:          filepath.Join(dataDir, "puchipix.db"),
		DownloadPath:    videosDir,
		ChromeDriverPath: filepath.Join(baseDir, "chromedriver.exe"),
		LogLevel:        "INFO",
		CORSEnabled:     true,
		MaxConcurrent:   5,
		SegmentRetries:  3,
		FFmpegPath:      "ffmpeg",
	}
}

func Load() (*Config, error) {
	cfg := DefaultConfig()

	configFile := filepath.Join(filepath.Dir(cfg.DBPath), "config.json")
	data, err := os.ReadFile(configFile)
	if err == nil {
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, err
		}
	}

	if port := os.Getenv("PUCHIPIX_PORT"); port != "" {
		cfg.Port = port
	}
	if dbPath := os.Getenv("PUCHIPIX_DB_PATH"); dbPath != "" {
		cfg.DBPath = dbPath
	}
	if dlPath := os.Getenv("PUCHIPIX_DOWNLOAD_PATH"); dlPath != "" {
		cfg.DownloadPath = dlPath
	}
	if chromePath := os.Getenv("PUCHIPIX_CHROMEDRIVER_PATH"); chromePath != "" {
		cfg.ChromeDriverPath = chromePath
	}
	if logLevel := os.Getenv("PUCHIPIX_LOG_LEVEL"); logLevel != "" {
		cfg.LogLevel = logLevel
	}

	if err := os.MkdirAll(cfg.DownloadPath, 0755); err != nil {
		return nil, err
	}
	dbDir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) Save() error {
	configFile := filepath.Join(filepath.Dir(c.DBPath), "config.json")
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFile, data, 0644)
}