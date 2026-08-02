package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"backend/internal/infra"

	_ "modernc.org/sqlite"
)

//go:embed migrations/001_init.sql
var schemaFS embed.FS

// Database wraps a *sql.DB handle with structured logging,
// providing WAL-mode SQLite concurrency for the DAG scheduler
// and API handlers.
type Database struct {
	DB     *sql.DB
	logger *infra.Logger
}

// NewDatabase opens a SQLite file at dbPath, applies WAL-mode PRAGMAs,
// and returns a ready Database handle. The parent directory is created
// if it does not exist so first-run startup is zero-config.
func NewDatabase(dbPath string, logger *infra.Logger) (*Database, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("database path must not be empty")
	}

	if logger == nil {
		logger = infra.NewLogger("Database")
	}

	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA wal_autocheckpoint = 1000",
		"PRAGMA foreign_keys = ON",
		"PRAGMA cache_size = -20000",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}

	db.SetMaxOpenConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	// Auto-migrate: create tables if they don't exist.
	// Fixes the bug where the server starts with an empty database
	// (only PRAGMAs applied) but no schema tables, causing all
	// gallery/task queries to fail with HTTP 500.
	if err := applySchema(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	logger.Info("SQLite connection initialized (WAL mode)")
	return &Database{DB: db, logger: logger}, nil
}

// applySchema reads the embedded 001_init.sql migration and executes it
// idempotently (all statements use IF NOT EXISTS).
func applySchema(ctx context.Context, db *sql.DB) error {
	schemaSQL, err := schemaFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return fmt.Errorf("read schema file: %w", err)
	}
	if _, err := db.ExecContext(ctx, string(schemaSQL)); err != nil {
		return fmt.Errorf("execute schema: %w", err)
	}
	return nil
}

// Close releases the database handle. Safe to call multiple times.
func (db *Database) Close() {
	if db.DB != nil {
		db.DB.Close()
		db.logger.Info("SQLite connection closed")
	}
}

// Ping verifies that the database is reachable.
func (db *Database) Ping(ctx context.Context) error {
	return db.DB.PingContext(ctx)
}

// Exec delegates to *sql.DB.ExecContext for INSERT/UPDATE/DELETE statements.
func (db *Database) Exec(ctx context.Context, sql string, args ...any) (sql.Result, error) {
	return db.DB.ExecContext(ctx, sql, args...)
}

// QueryRow delegates to *sql.DB.QueryRowContext for single-row queries.
func (db *Database) QueryRow(ctx context.Context, sql string, args ...any) *sql.Row {
	return db.DB.QueryRowContext(ctx, sql, args...)
}

// Query delegates to *sql.DB.QueryContext for multi-row queries.
// The caller must close the returned Rows.
func (db *Database) Query(ctx context.Context, sql string, args ...any) (*sql.Rows, error) {
	return db.DB.QueryContext(ctx, sql, args...)
}

// BeginTx starts a new read-committed transaction for multi-statement
// atomicity. The caller is responsible for Commit or Rollback.
func (db *Database) BeginTx(ctx context.Context) (*sql.Tx, error) {
	return db.DB.BeginTx(ctx, &sql.TxOptions{
		Isolation: sql.LevelReadCommitted,
	})
}
