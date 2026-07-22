package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLoadDefaults verifies that all environment variables have
// sensible fallbacks so the server can start without a .env file.
func TestLoadDefaults(t *testing.T) {
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("SERVER_PORT")
	os.Unsetenv("LOG_LEVEL")
	os.Unsetenv("LOG_SINK_CAPACITY")
	os.Unsetenv("SQLITE_SOURCE_PATH")

	cfg, err := Load()
	require.NoError(t, err)

	assert.NotEmpty(t, cfg.DatabaseURL)
	assert.Equal(t, 10541, cfg.ServerPort)
	assert.Equal(t, "INFO", cfg.LogLevel)
	assert.Equal(t, 1000, cfg.LogSinkCapacity)
	assert.NotEmpty(t, cfg.SQLiteSourcePath)
}

// TestLoadEnvOverride verifies that environment variables take
// precedence over defaults, allowing runtime configuration.
func TestLoadEnvOverride(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/testdb")
	t.Setenv("SERVER_PORT", "8080")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("LOG_SINK_CAPACITY", "500")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "postgres://test:test@localhost:5432/testdb", cfg.DatabaseURL)
	assert.Equal(t, 8080, cfg.ServerPort)
	assert.Equal(t, "DEBUG", cfg.LogLevel)
	assert.Equal(t, 500, cfg.LogSinkCapacity)
}

// TestLoadInvalidLogLevel verifies that an unsupported log level
// is rejected, preventing silent misconfiguration.
func TestLoadInvalidLogLevel(t *testing.T) {
	t.Setenv("LOG_LEVEL", "TRACE")

	_, err := Load()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid LOG_LEVEL")
}

// TestLoadLowSinkCapacityClamped verifies that a sub-threshold
// sink capacity is clamped to the default, preventing a tiny ring
// buffer that would thrash under load.
func TestLoadLowSinkCapacityClamped(t *testing.T) {
	t.Setenv("LOG_SINK_CAPACITY", "10")

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, 1000, cfg.LogSinkCapacity, "capacity below 100 should be clamped to 1000")
}
