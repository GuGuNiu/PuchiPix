package dbconfig

import (
	"os"
	"path/filepath"
)

// DefaultDBPath is the default database path computed at package init,
// ignoring the DB_PATH environment variable. Used by the CLI as a
// stable fallback when PUCHIPIX_DB_PATH is not set.
var DefaultDBPath = computeDefaultDBPath()

// computeDefaultDBPath resolves the default DB path without consulting
// the DB_PATH environment variable. Resolution order:
// 1. <exeDir>/../data/puchipix.db (when running compiled binary from backend/)
// 2. <cwd>/data/puchipix.db (when running `go run` from project root)
// 3. <cwd>/../data/puchipix.db (when running from backend/ directory)
func computeDefaultDBPath() string {
	// Candidate paths to try.
	var candidates []string

	// From executable directory: <exeDir>/../data/puchipix.db
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, filepath.Join(exeDir, "..", "data", "puchipix.db"))
	}

	// From working directory.
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "data", "puchipix.db"))
		candidates = append(candidates, filepath.Join(cwd, "..", "data", "puchipix.db"))
	}

	// Return the first candidate that exists.
	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil {
			if _, err := os.Stat(abs); err == nil {
				return abs
			}
		}
	}

	// Final fallback.
	abs, _ := filepath.Abs("../data/puchipix.db")
	return abs
}

// GetDBPath returns the SQLite database path. Resolution order:
// 1. DB_PATH environment variable
// 2. Default path (see computeDefaultDBPath)
func GetDBPath() string {
	// 1. Environment variable takes precedence.
	if envPath := os.Getenv("DB_PATH"); envPath != "" {
		return envPath
	}
	return DefaultDBPath
}

// GetDSN returns the SQLite DSN (bare file path) for database/sql
// compatibility. Kept for backward-compatibility with config.Load()
// which assigns the return value to Config.DatabasePath.
func GetDSN() string {
	return GetDBPath()
}
