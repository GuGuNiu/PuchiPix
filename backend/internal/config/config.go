package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration for the PuchiPix backend.
type Config struct {
	DatabaseURL      string
	ServerPort       int
	LogLevel         string
	LogSinkCapacity  int
	SQLiteSourcePath string
}

// Load reads configuration from environment variables, applying defaults
// for any missing values so the server can start without a .env file.
func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:      getEnv("DATABASE_URL", "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"),
		ServerPort:       getEnvInt("SERVER_PORT", 10541),
		LogLevel:         strings.ToUpper(getEnv("LOG_LEVEL", "INFO")),
		LogSinkCapacity:  getEnvInt("LOG_SINK_CAPACITY", 1000),
		SQLiteSourcePath: getEnv("SQLITE_SOURCE_PATH", "../data/puchipix.db"),
	}

	if cfg.LogSinkCapacity < 100 {
		cfg.LogSinkCapacity = 1000
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
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL must not be empty")
	}
	if c.ServerPort < 1 || c.ServerPort > 65535 {
		return fmt.Errorf("SERVER_PORT must be between 1 and 65535, got %d", c.ServerPort)
	}
	return nil
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
