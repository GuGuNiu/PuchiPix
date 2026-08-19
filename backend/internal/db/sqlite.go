package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"backend/internal/infra"

	_ "modernc.org/sqlite"
)

//go:embed migrations/init.sql
var schemaFS embed.FS

//go:embed migrations/site_configs.sql
var migration002FS embed.FS

//go:embed migrations/game_characters_models.sql
var migration003FS embed.FS

//go:embed migrations/gallery_file_progress.sql
var migration004FS embed.FS

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

	logger.Info("Opening database", "path", dbPath)

	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	// Use DSN-level PRAGMAs so EVERY connection in the pool inherits
	// busy_timeout and other per-connection settings. With MaxOpenConns > 1,
	// db.Exec("PRAGMA ...") only sets the pragma on the connection that
	// services that call — new pool connections get default values and
	// hit SQLITE_BUSY immediately on write contention instead of waiting.
	// modernc.org/sqlite supports _pragma=NAME(VALUE) query parameters.
	dsn := dbPath +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)" +
		"&_pragma=wal_autocheckpoint(1000)" +
		"&_pragma=foreign_keys(ON)" +
		"&_pragma=cache_size(-20000)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		logger.Error("Failed to open database", "error", err.Error())
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Verify PRAGMAs are effective on the first pooled connection.
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA foreign_keys = ON",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}

	// Allow concurrent read connections. WAL mode permits multiple
	// readers alongside a single writer; the busy_timeout pragma
	// handles write contention gracefully. With MaxOpenConns(1) every
	// query — including reads — serialized behind any in-flight write,
	// which caused multi-second stalls when the scheduler, event
	// handlers, and API all competed for the single connection.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxIdleTime(5 * time.Minute)

	// Ping: verify the connection is alive with a short timeout.
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	// Auto-migrate: create tables if they don't exist.
	// Uses a separate, longer timeout so large schema files (16+ tables,
	// 20+ indexes) do not get cut short by the 5-second Ping timeout.
	// Fixes the bug where the server starts with an empty database
	// (only PRAGMAs applied) but no schema tables, causing all
	// gallery/task queries to fail with HTTP 500.
	schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer schemaCancel()
	if err := applySchema(schemaCtx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	logger.Info("SQLite connection initialized (WAL mode)")
	return &Database{DB: db, logger: logger}, nil
}

// applySchema reads the embedded migration files and executes them
// idempotently (all statements use IF NOT EXISTS). Each SQL file is
// split into individual statements and executed one at a time, so a
// failure in one table/index creation does not mask the exact location
// (the error includes the failed SQL snippet).
func applySchema(ctx context.Context, db *sql.DB) error {
	// Ordered list of migrations to apply.
	type migration struct {
		name string
		data []byte
	}
	migrations := []migration{
		{"init.sql", mustReadEmbed(schemaFS, "migrations/init.sql")},
		{"site_configs.sql", mustReadEmbed(migration002FS, "migrations/site_configs.sql")},
		{"game_characters_models.sql", mustReadEmbed(migration003FS, "migrations/game_characters_models.sql")},
		{"gallery_file_progress.sql", mustReadEmbed(migration004FS, "migrations/gallery_file_progress.sql")},
	}

	for _, m := range migrations {
		if err := execSQLStatements(ctx, db, m.name, string(m.data)); err != nil {
			return err
		}
	}
	return nil
}

// mustReadEmbed reads an embedded file, panicking on error so the
// binary refuses to start with a missing migration.
func mustReadEmbed(fs embed.FS, name string) []byte {
	data, err := fs.ReadFile(name)
	if err != nil {
		panic(fmt.Sprintf("missing embedded migration %q: %v", name, err))
	}
	return data
}

// execSQLStatements splits a SQL script on semicolons and executes each
// non-empty statement individually. This gives precise error location
// (filename + failed SQL snippet) compared to a single ExecContext that
// may return a generic "near line N" error without identifying the file.
//
// Handles schema drift: if an INDEX or FK references a column that does
// not yet exist (common when a pre-existing database was created from an
// older schema version), it attempts to ALTER TABLE ADD COLUMN with a
// sensible default type, then retries the failed statement.
func execSQLStatements(ctx context.Context, db *sql.DB, filename, script string) error {
	statements := splitSQL(script)
	for i, stmt := range statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, trimmed); err != nil {
			// Attempt to recover from "no such column" errors by
			// adding the missing column and retrying.
			if tryAddMissingColumn(ctx, db, trimmed, err) {
				if _, retryErr := db.ExecContext(ctx, trimmed); retryErr != nil {
					return fmt.Errorf("%s statement %d (retry failed): %w\nSQL: %s",
						filename, i+1, retryErr, truncateSQL(trimmed))
				}
				continue
			}
			return fmt.Errorf("%s statement %d: %w\nSQL: %s",
				filename, i+1, err, truncateSQL(trimmed))
		}
	}
	return nil
}

// truncateSQL shortens a SQL statement for error messages.
func truncateSQL(s string) string {
	if len(s) > 120 {
		return s[:120] + "..."
	}
	return s
}

// tryAddMissingColumn inspects a "no such column" error and, if the
// failed statement is a CREATE INDEX or similar, extracts the missing
// column name and parent table, then issues an ALTER TABLE ADD COLUMN
// with a TEXT default. Returns true if the column was successfully
// added (or already existed).
func tryAddMissingColumn(ctx context.Context, db *sql.DB, sqlStmt string, origErr error) bool {
	errStr := origErr.Error()
	idx := strings.Index(errStr, "no such column:")
	if idx < 0 {
		return false
	}
	// Extract column name from error message: "no such column: <name> (code)"
	colPart := errStr[idx+len("no such column:"):]
	colName := strings.TrimSpace(colPart)
	if spaceIdx := strings.Index(colName, " "); spaceIdx > 0 {
		colName = colName[:spaceIdx]
	}
	if colName == "" {
		return false
	}

	// Extract table name from CREATE INDEX ... ON <table>(...)
	upper := strings.ToUpper(sqlStmt)
	onIdx := strings.Index(upper, " ON ")
	if onIdx < 0 {
		return false
	}
	afterOn := sqlStmt[onIdx+4:]
	parenIdx := strings.Index(afterOn, "(")
	if parenIdx < 0 {
		return false
	}
	tableName := strings.TrimSpace(afterOn[:parenIdx])
	if tableName == "" {
		return false
	}

	// Attempt to add the column. Ignore "duplicate column name" errors
	// (column already exists).
	alterSQL := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s TEXT", tableName, colName)
	if _, err := db.ExecContext(ctx, alterSQL); err != nil {
		// If the column already exists, the ALTER fails but the
		// original CREATE INDEX will also fail — return false so
		// the caller reports the original error.
		return false
	}
	return true
}

// splitSQL splits a SQL script on semicolons, respecting single-line
// comments (--) and string literals to avoid false splits.
func splitSQL(script string) []string {
	var out []string
	var buf strings.Builder
	inSingleQuote := false
	inDoubleQuote := false

	for i := 0; i < len(script); i++ {
		ch := script[i]
		// Toggle quote states.
		if ch == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
		} else if ch == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
		}
		// Skip single-line comments when not inside a string.
		if !inSingleQuote && !inDoubleQuote && ch == '-' && i+1 < len(script) && script[i+1] == '-' {
			// Skip to end of line.
			for i < len(script) && script[i] != '\n' {
				i++
			}
			continue
		}
		// Split on semicolons outside strings.
		if ch == ';' && !inSingleQuote && !inDoubleQuote {
			out = append(out, buf.String())
			buf.Reset()
			continue
		}
		buf.WriteByte(ch)
	}
	// Append any remaining text after the last semicolon.
	if remaining := strings.TrimSpace(buf.String()); remaining != "" {
		out = append(out, remaining)
	}
	return out
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
