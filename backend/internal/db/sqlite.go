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

// NewDatabase opens a SQLite file at dbPath, applies WAL-mode PRAGMAs, and
// returns a ready handle. The parent directory is created when missing so a
// first run needs no manual setup.
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

	// DSN-level PRAGMAs, so every pooled connection inherits busy_timeout
	// and the other per-connection settings. db.Exec("PRAGMA ...") only
	// affects the one connection that services the call, and later pool
	// connections fall back to defaults that fail with SQLITE_BUSY instead
	// of waiting. modernc.org/sqlite exposes _pragma=NAME(VALUE) parameters.
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

	// WAL permits multiple readers alongside a single writer and
	// busy_timeout absorbs write contention. MaxOpenConns(1) would instead
	// queue reads behind any in-flight write, so the scheduler, event
	// handlers, and API handlers would stall each other for seconds.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxIdleTime(5 * time.Minute)

	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	// A dedicated 30s budget keeps large schema files (16+ tables, 20+
	// indexes) from being cut short by the 5s ping timeout above.
	schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer schemaCancel()
	if err := applySchema(schemaCtx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	logger.Info("SQLite connection initialized (WAL mode)")
	return &Database{DB: db, logger: logger}, nil
}

// applySchema executes the embedded migration files, each of which is
// idempotent because every statement uses IF NOT EXISTS.
func applySchema(ctx context.Context, db *sql.DB) error {
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

	// Column backfills for databases created before a column existed:
	// CREATE TABLE IF NOT EXISTS leaves old tables untouched, so each
	// added column is ensured here idempotently.
	ensureColumns := []struct{ table, column, ddl string }{
		{"download_tasks", "file_size", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, c := range ensureColumns {
		if err := ensureColumn(ctx, db, c.table, c.column, c.ddl); err != nil {
			return fmt.Errorf("ensure column %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

// ensureColumn adds the column to the table when missing. PRAGMA
// table_info drives the check, so repeated opens are no-ops.
func ensureColumn(ctx context.Context, db *sql.DB, table, column, ddl string) error {
	rows, err := db.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return err
	}
	defer rows.Close()
	exists := false
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dfltValue any
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == column {
			exists = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	if exists {
		return nil
	}
	_, err = db.ExecContext(ctx, "ALTER TABLE "+table+" ADD COLUMN "+column+" "+ddl)
	return err
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

// execSQLStatements splits a SQL script on semicolons and runs each
// non-empty statement on its own, so a failure reports the filename and the
// failing snippet instead of a bare "near line N".
//
// Schema drift: when an INDEX or FK names a column that does not exist yet
// (a database created from an older schema), a missing column is added
// before the statement is retried.
func execSQLStatements(ctx context.Context, db *sql.DB, filename, script string) error {
	statements := splitSQL(script)
	for i, stmt := range statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, trimmed); err != nil {
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
	colPart := errStr[idx+len("no such column:"):]
	colName := strings.TrimSpace(colPart)
	if spaceIdx := strings.Index(colName, " "); spaceIdx > 0 {
		colName = colName[:spaceIdx]
	}
	if colName == "" {
		return false
	}

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

	alterSQL := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s TEXT", tableName, colName)
	if _, err := db.ExecContext(ctx, alterSQL); err != nil {
		// A failed ALTER means the retry will fail too, so report the
		// original error instead of the ALTER failure.
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
		if ch == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
		} else if ch == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
		}
		if !inSingleQuote && !inDoubleQuote && ch == '-' && i+1 < len(script) && script[i+1] == '-' {
			for i < len(script) && script[i] != '\n' {
				i++
			}
			continue
		}
		if ch == ';' && !inSingleQuote && !inDoubleQuote {
			out = append(out, buf.String())
			buf.Reset()
			continue
		}
		buf.WriteByte(ch)
	}
	if remaining := strings.TrimSpace(buf.String()); remaining != "" {
		out = append(out, remaining)
	}
	return out
}

// Close releases the database handle. Repeated calls are a no-op.
func (db *Database) Close() {
	if db.DB != nil {
		db.DB.Close()
		db.logger.Info("SQLite connection closed")
	}
}

func (db *Database) Ping(ctx context.Context) error {
	return db.DB.PingContext(ctx)
}

func (db *Database) Exec(ctx context.Context, sql string, args ...any) (sql.Result, error) {
	return db.DB.ExecContext(ctx, sql, args...)
}

func (db *Database) QueryRow(ctx context.Context, sql string, args ...any) *sql.Row {
	return db.DB.QueryRowContext(ctx, sql, args...)
}

// Query returns rows that the caller must close.
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
