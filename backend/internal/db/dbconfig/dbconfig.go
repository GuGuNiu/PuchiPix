package dbconfig

import (
	"fmt"
	"os"
	"path/filepath"
)

// DefaultDBPath is the fallback SQLite database location when no
// environment variable overrides it.
const DefaultDBPath = "./data/puchipix.db"

// GetDBPath returns the SQLite database path from the DB_PATH
// environment variable, falling back to DefaultDBPath. The parent
// directory is ensured to exist so callers can open the path
// without an extra MkdirAll.
func GetDBPath() string {
	p := getEnv("DB_PATH", DefaultDBPath)
	if p == "" {
		p = DefaultDBPath
	}
	if dir := filepath.Dir(p); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
	}
	return p
}

// GetDSN returns the SQLite DSN (bare file path) for database/sql
// compatibility. Kept for backward-compatibility with config.Load()
// which assigns the return value to Config.DatabasePath.
func GetDSN() string {
	return GetDBPath()
}

// ConnectionString is an alias for GetDBPath, retained for callers
// that use this naming convention.
func ConnectionString() string {
	return GetDBPath()
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// EnsureDir is exported for test convenience.
func EnsureDir(p string) error {
	if dir := filepath.Dir(p); dir != "" && dir != "." {
		return os.MkdirAll(dir, 0755)
	}
	return nil
}

// FormatPath returns an absolute-friendly representation for logging.
func FormatPath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}

// String returns a human-readable description for logging.
func String() string {
	return fmt.Sprintf("DB_PATH=%s", GetDBPath())
}
