package dbconfig

import (
	"os"
	"path/filepath"
)

// DefaultDBPath is the default database path computed at package init,
// ignoring the DB_PATH environment variable. Used by the CLI as a
// stable fallback when PUCHIPIX_DB_PATH is not set.
var DefaultDBPath = computeDefaultDBPath()

// computeDefaultDBPath resolves the default DB path without consulting DB_PATH.
//
// The working directory is searched before the executable directory: the
// launch directory carries a stronger signal of intent than the install
// location.
//   - <cwd>/data/puchipix.db (go run from the project root)
//   - <cwd>/../data/puchipix.db (go run from backend/)
//   - <exeDir>/../data/puchipix.db (compiled binary started from backend/)
func computeDefaultDBPath() string {
	var candidates []string

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "data", "puchipix.db"))
		candidates = append(candidates, filepath.Join(cwd, "..", "data", "puchipix.db"))
	}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, filepath.Join(exeDir, "..", "data", "puchipix.db"))
	}

	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil {
			if _, err := os.Stat(abs); err == nil {
				return abs
			}
		}
	}

	abs, _ := filepath.Abs("../data/puchipix.db")
	return abs
}

// GetDBPath returns the SQLite database path, preferring DB_PATH over the
// computed default.
func GetDBPath() string {
	if envPath := os.Getenv("DB_PATH"); envPath != "" {
		return envPath
	}
	return DefaultDBPath
}

// GetDSN returns the SQLite DSN (a bare file path) accepted by database/sql.
func GetDSN() string {
	return GetDBPath()
}
