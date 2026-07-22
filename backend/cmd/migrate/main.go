package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5"

	_ "modernc.org/sqlite"
)

// tableDefinition describes a table to migrate, in FK-safe order.
type tableDefinition struct {
	Name    string   // PG table name
	SQLite  string   // SQLite table name (same as PG for this schema)
	Columns []string // column names in order (excluding auto-generated columns like SERIAL id)
}

// Tables are ordered to satisfy foreign-key dependencies:
// parents first, children later.
var tables = []tableDefinition{
	// ── No FK dependencies ──
	{Name: "download_tasks", SQLite: "download_tasks", Columns: []string{
		"id", "url", "m3u8_url", "status", "progress", "file_path",
		"format", "priority", "error_msg", "seq", "created_at", "updated_at",
	}},
	{Name: "galleries", SQLite: "galleries", Columns: []string{
		"id", "seq", "source_url", "site_id", "scraped_domain",
		"title", "protagonist", "description", "category", "tags",
		"cover_url", "cover_local_path", "image_count", "video_count",
		"page_count", "status", "error_msg", "download_method",
		"expected_image_count", "expected_video_count", "content_verified",
		"save_path", "total_size", "downloaded_size", "game_characters",
		"publish_time", "scraped_at", "completed_at", "created_at", "updated_at",
	}},
	{Name: "sniff_tasks", SQLite: "sniff_tasks", Columns: []string{
		"id", "seq", "url", "site_id", "status",
		"total_found", "total_created", "total_skipped",
		"error_msg", "completed_at", "created_at", "updated_at",
	}},
	{Name: "app_configs", SQLite: "app_configs", Columns: []string{
		"id", "key", "value", "created_at", "updated_at",
	}},
	{Name: "site_accounts", SQLite: "site_accounts", Columns: []string{
		"id", "site_id", "username", "password", "domain",
		"status", "auth_cookies", "cookie_prefix",
		"last_login_at", "last_used_at", "fail_count", "remark",
		"created_at", "updated_at",
	}},
	{Name: "persons", SQLite: "persons", Columns: []string{
		"id", "name", "pinyin", "aliases", "source",
		"source_game", "gallery_count", "confirmed",
		"created_at", "updated_at",
	}},
	{Name: "blocklist_rules", SQLite: "blocklist_rules", Columns: []string{
		"id", "site_id", "field_type", "keyword", "match_mode",
		"enabled", "remark", "created_at", "updated_at",
	}},
	{Name: "user_preferences", SQLite: "user_preferences", Columns: []string{
		"id", "key", "value", "category", "created_at", "updated_at",
	}},
	{Name: "dag_events", SQLite: "dag_events", Columns: []string{
		"id", "seq", "dag_id", "node_id", "type",
		"payload", "timestamp",
	}},
	{Name: "dag_snapshots", SQLite: "dag_snapshots", Columns: []string{
		"id", "dag_id", "state", "last_seq", "created_at",
	}},
	{Name: "download_history", SQLite: "download_history", Columns: []string{
		"id", "site_id", "gallery_id", "url", "status",
		"image_count", "video_count", "title", "protagonist",
		"save_path", "created_at", "updated_at",
	}},
	{Name: "sjs_bookmarks", SQLite: "sjs_bookmarks", Columns: []string{
		"id", "url", "thread_id", "title", "cover_url",
		"author", "post_date", "forum_section", "notes",
		"created_at", "updated_at",
	}},
	{Name: "site_configs", SQLite: "site_configs", Columns: []string{
		"id", "site_id", "config_key", "config_value",
		"created_at", "updated_at",
	}},
	// ── FK to download_tasks ──
	{Name: "video_infos", SQLite: "video_infos", Columns: []string{
		"id", "task_id", "title", "source_url", "file_size",
		"duration", "tags", "actors", "categories", "director",
		"resolution", "created_at",
	}},
	// ── FK to galleries ──
	{Name: "gallery_images", SQLite: "gallery_images", Columns: []string{
		"id", "gallery_id", "url", "local_path", "file_name",
		"file_size", "width", "height", "format", "page_index",
		"order_index", "status", "error_msg", "completed_at",
		"created_at", "updated_at",
	}},
	{Name: "gallery_videos", SQLite: "gallery_videos", Columns: []string{
		"id", "gallery_id", "url", "local_path", "file_name",
		"file_size", "duration", "resolution", "format",
		"status", "error_msg", "completed_at",
		"created_at", "updated_at",
	}},
	{Name: "gallery_download_infos", SQLite: "gallery_download_infos", Columns: []string{
		"id", "gallery_id", "title", "file_count", "file_size_text",
		"image_dimensions", "password", "download_url", "download_source",
		"ouo_url", "resolved_direct_url", "provider",
		"requires_login", "requires_email", "status",
		"local_path", "extracted_path", "actual_size", "zip_file_name",
		"parallelism", "avg_speed", "verified_count", "count_matched",
		"created_at", "updated_at",
	}},
}

func main() {
	code := run()
	os.Exit(code)
}

func run() int {
	fmt.Println("=== PuchiPix SQLite → PostgreSQL Migration ===")
	fmt.Println()

	// Paths
	projectRoot := resolveProjectRoot()
	// SQLite DB is at <workspace>/data/puchipix.db (one level above backend/).
	sqlitePath := filepath.Join(projectRoot, "..", "data", "puchipix.db")
	dumpSchema(sqlitePath)

	// ── Step 1: Start embedded PostgreSQL ──
	fmt.Print("Starting embedded PostgreSQL... ")
	pg := startEmbeddedPG()
	if pg == nil {
		fmt.Println("FAILED")
		return 1
	}
	defer func() {
		fmt.Print("Stopping PostgreSQL... ")
		if err := pg.Stop(); err != nil {
			fmt.Printf("error: %v\n", err)
		} else {
			fmt.Println("ok")
		}
	}()
	fmt.Println("ok")

	// ── Step 2: Connect to PostgreSQL ──
	pgConnStr := "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"
	ctx := context.Background()
	pgConn, err := pgx.Connect(ctx, pgConnStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "PostgreSQL connect failed: %v\n", err)
		return 1
	}
	defer pgConn.Close(ctx)

	// ── Step 3: Create PG tables ──
	fmt.Print("Creating tables... ")
	if err := createTables(ctx, pgConn); err != nil {
		fmt.Fprintf(os.Stderr, "\nCreate tables failed: %v\n", err)
		return 1
	}
	fmt.Println("ok")

	// ── Step 3b: Truncate (idempotent re-run safety) ──
	fmt.Print("Truncating tables... ")
	if err := truncateAll(ctx, pgConn); err != nil {
		fmt.Fprintf(os.Stderr, "\nTruncate failed: %v\n", err)
		return 1
	}
	fmt.Println("ok")

	// ── Step 4: Open SQLite ──
	fmt.Print("Opening SQLite... ")
	sqliteDB, err := sql.Open("sqlite", sqlitePath+"?_journal_mode=WAL&mode=ro")
	if err != nil {
		fmt.Fprintf(os.Stderr, "\nSQLite open failed: %v\n", err)
		return 1
	}
	defer sqliteDB.Close()
	sqliteDB.SetMaxOpenConns(1) // single reader for migration
	fmt.Println("ok")

	// ── Step 5: Migrate tables ──
	migrated := 0
	rows := 0
	for _, t := range tables {
		count := sqliteRowCount(sqliteDB, t.SQLite)
		if count == 0 {
			fmt.Printf("  %-30s (empty, skip)\n", t.Name)
			continue
		}
		fmt.Printf("  %-30s %d rows →", t.Name, count)

		n, err := migrateTable(ctx, sqliteDB, pgConn, t)
		if err != nil {
			fmt.Fprintf(os.Stderr, "\n  ERROR: %v\n", err)
			return 1
		}
		fmt.Printf("%d migrated\n", n)

		// Reset sequence for SERIAL columns
		resetSequence(ctx, pgConn, t.Name, "id")

		migrated++
		rows += n
	}

	fmt.Println()
	fmt.Printf("Migration complete: %d tables, %d rows\n\n", migrated, rows)

	// ── Step 6: Verify ──
	fmt.Println("=== Verification ===")
	allOk := true
	for _, t := range tables {
		pgCount := pgRowCount(ctx, pgConn, t.Name)
		sqlCount := sqliteRowCount(sqliteDB, t.SQLite)
		status := "OK"
		if pgCount != sqlCount {
			status = "MISMATCH"
			allOk = false
		}
		fmt.Printf("  %-30s SQLite=%d PG=%d %s\n", t.Name, sqlCount, pgCount, status)
	}
	if !allOk {
		fmt.Println("\n✗ Row count mismatch detected — review the mismatched tables.")
		return 2
	}
	fmt.Println("\n✓ All tables verified.")
	return 0
}

// dumpSchema prints a quick summary of the SQLite database.
func dumpSchema(path string) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&mode=ro")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot open SQLite for schema scan: %v\n", err)
		return
	}
	defer db.Close()

	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	if err != nil {
		return
	}
	defer rows.Close()

	fmt.Printf("SQLite: %s\n", path)
	fmt.Print("Tables: ")
	var names []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		names = append(names, name)
	}
	fmt.Println(strings.Join(names, ", "))
	fmt.Println()
}

// sqliteRowCount returns the number of rows in a SQLite table.
func sqliteRowCount(db *sql.DB, table string) int {
	var count int
	_ = db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %q", table)).Scan(&count)
	return count
}

// pgRowCount returns the number of rows in a PostgreSQL table.
func pgRowCount(ctx context.Context, conn *pgx.Conn, table string) int {
	var count int
	_ = conn.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", table)).Scan(&count)
	return count
}

// boolColumns lists columns that should be converted from SQLite INTEGER
// (0/1 as int64) to Go bool for PostgreSQL BOOLEAN columns.
var boolColumns = map[string]bool{
	"content_verified": true,
	"enabled":          true,
	"confirmed":        true,
	"requires_login":   true,
	"requires_email":   true,
	"count_matched":    true,
}

// migrateTable copies all rows from SQLite to PostgreSQL.
// IDs are explicitly transferred; sequences must be reset afterward.
func migrateTable(ctx context.Context, sqlDB *sql.DB, pgConn *pgx.Conn, t tableDefinition) (int, error) {
	rows, err := sqlDB.Query(fmt.Sprintf("SELECT %s FROM %q", strings.Join(t.Columns, ", "), t.SQLite))
	if err != nil {
		return 0, fmt.Errorf("SQLite query: %w", err)
	}
	defer rows.Close()

	placeholders := make([]string, len(t.Columns))
	for i := range placeholders {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	insertSQL := fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s)",
		t.Name,
		strings.Join(t.Columns, ", "),
		strings.Join(placeholders, ", "),
	)

	count := 0
	for rows.Next() {
		values := make([]any, len(t.Columns))
		ptrs := make([]any, len(t.Columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return count, fmt.Errorf("scan row: %w", err)
		}

		// Type normalization: SQLite → PostgreSQL
		for i, v := range values {
			// []byte → string (TEXT columns)
			if b, ok := v.([]byte); ok {
				values[i] = string(b)
				continue
			}
			// int64 → bool (BOOLEAN columns)
			if boolColumns[t.Columns[i]] {
				if n, ok := v.(int64); ok {
					values[i] = n != 0
				}
			}
		}

		if _, err := pgConn.Exec(ctx, insertSQL, values...); err != nil {
			return count, fmt.Errorf("insert into %s: %w", t.Name, err)
		}
		count++
	}
	return count, rows.Err()
}

// resetSequence sets the sequence for a SERIAL column to max(id)+1.
func resetSequence(ctx context.Context, conn *pgx.Conn, table, column string) {
	seqName := fmt.Sprintf("%s_%s_seq", table, column)
	_, _ = conn.Exec(ctx,
		fmt.Sprintf("SELECT setval('%s', COALESCE((SELECT MAX(%s) FROM %s), 0) + 1, false)",
			seqName, column, table))
}

// truncateAll truncates all tables in FK-safe order for idempotent re-runs.
func truncateAll(ctx context.Context, conn *pgx.Conn) error {
	// TRUNCATE with CASCADE handles FK dependencies in one statement
	_, err := conn.Exec(ctx, `TRUNCATE TABLE 
		gallery_download_infos, gallery_videos, gallery_images,
		video_infos, download_history, sjs_bookmarks, site_configs,
		dag_events, dag_snapshots,
		galleries, download_tasks, sniff_tasks,
		app_configs, site_accounts, persons, blocklist_rules, user_preferences
		RESTART IDENTITY CASCADE`)
	return err
}

// createTables executes the embedded migration SQL to create all tables.
func createTables(ctx context.Context, conn *pgx.Conn) error {
	ddl := getMigrationDDL()
	for _, stmt := range strings.Split(ddl, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" || strings.HasPrefix(stmt, "--") {
			continue
		}
		if _, err := conn.Exec(ctx, stmt+";"); err != nil {
			return fmt.Errorf("exec: %w\nSQL: %s", err, stmt)
		}
	}
	return nil
}

// startEmbeddedPG starts a project-local PostgreSQL 16 instance.
func startEmbeddedPG() *embeddedpostgres.EmbeddedPostgres {
	basePath := filepath.Join(resolveProjectRoot(), "..", "data", "postgres")

	pgCfg := embeddedpostgres.DefaultConfig().
		Username("puchipix").
		Password("puchipix").
		Database("puchipix").
		Version(embeddedpostgres.V16).
		Port(5432).
		RuntimePath(filepath.Join(basePath, "run")).
		DataPath(filepath.Join(basePath, "data")).
		BinariesPath(filepath.Join(basePath, "bin")).
		StartTimeout(60 * time.Second).
		Logger(io.Discard)

	pg := embeddedpostgres.NewDatabase(pgCfg)
	if err := pg.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "embedded-postgres: %v\n", err)
		return nil
	}
	return pg
}

// resolveProjectRoot finds the backend directory root.
// migrate is always run from the backend directory.
func resolveProjectRoot() string {
	// Try current working directory first
	cwd, _ := os.Getwd()
	if _, err := os.Stat(filepath.Join(cwd, "go.mod")); err == nil {
		return cwd
	}
	// Fallback: resolve relative to the binary
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	for range 5 {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return "."
}

// getMigrationDDL returns the full PostgreSQL schema DDL.
// Keep in sync with internal/db/migrations/001_init.sql.
func getMigrationDDL() string {
	return `
CREATE TABLE IF NOT EXISTS download_tasks (
    id          SERIAL PRIMARY KEY,
    url         TEXT        NOT NULL,
    m3u8_url    TEXT        NOT NULL DEFAULT '',
    status      TEXT        NOT NULL DEFAULT 'pending',
    progress    DOUBLE PRECISION NOT NULL DEFAULT 0,
    file_path   TEXT        NOT NULL DEFAULT '',
    format      TEXT        NOT NULL DEFAULT 'mp4',
    priority    INTEGER     NOT NULL DEFAULT 1,
    error_msg   TEXT        NOT NULL DEFAULT '',
    seq         TEXT,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_infos (
    id          SERIAL PRIMARY KEY,
    task_id     INTEGER     NOT NULL UNIQUE REFERENCES download_tasks(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL DEFAULT '',
    source_url  TEXT        NOT NULL DEFAULT '',
    file_size   BIGINT      NOT NULL DEFAULT 0,
    duration    DOUBLE PRECISION NOT NULL DEFAULT 0,
    tags        TEXT        NOT NULL DEFAULT '',
    actors      TEXT        NOT NULL DEFAULT '',
    categories  TEXT        NOT NULL DEFAULT '',
    director    TEXT        NOT NULL DEFAULT '',
    resolution  TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS galleries (
    id                   SERIAL PRIMARY KEY,
    seq                  TEXT,
    source_url           TEXT        NOT NULL UNIQUE,
    site_id              TEXT        NOT NULL DEFAULT 'aimeizizi',
    scraped_domain       TEXT        NOT NULL DEFAULT '',
    title                TEXT        NOT NULL DEFAULT '',
    protagonist          TEXT        NOT NULL DEFAULT '',
    description          TEXT        NOT NULL DEFAULT '',
    category             TEXT        NOT NULL DEFAULT '',
    tags                 TEXT        NOT NULL DEFAULT '',
    cover_url            TEXT        NOT NULL DEFAULT '',
    cover_local_path     TEXT        NOT NULL DEFAULT '',
    image_count          INTEGER     NOT NULL DEFAULT 0,
    video_count          INTEGER     NOT NULL DEFAULT 0,
    page_count           INTEGER     NOT NULL DEFAULT 0,
    status               TEXT        NOT NULL DEFAULT 'pending',
    error_msg            TEXT        NOT NULL DEFAULT '',
    download_method      TEXT        NOT NULL DEFAULT 'pending',
    expected_image_count INTEGER     NOT NULL DEFAULT 0,
    expected_video_count INTEGER     NOT NULL DEFAULT 0,
    content_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
    save_path            TEXT        NOT NULL DEFAULT '',
    total_size           BIGINT      NOT NULL DEFAULT 0,
    downloaded_size      BIGINT      NOT NULL DEFAULT 0,
    game_characters      TEXT,
    publish_time         TEXT,
    scraped_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    created_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery_images (
    id           SERIAL PRIMARY KEY,
    gallery_id   INTEGER     NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    url          TEXT        NOT NULL,
    local_path   TEXT        NOT NULL DEFAULT '',
    file_name    TEXT        NOT NULL DEFAULT '',
    file_size    BIGINT      NOT NULL DEFAULT 0,
    width        INTEGER     NOT NULL DEFAULT 0,
    height       INTEGER     NOT NULL DEFAULT 0,
    format       TEXT        NOT NULL DEFAULT '',
    page_index   INTEGER     NOT NULL DEFAULT 0,
    order_index  INTEGER     NOT NULL DEFAULT 0,
    status       TEXT        NOT NULL DEFAULT 'pending',
    error_msg    TEXT        NOT NULL DEFAULT '',
    completed_at TIMESTAMP,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery_videos (
    id           SERIAL PRIMARY KEY,
    gallery_id   INTEGER     NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    url          TEXT        NOT NULL,
    local_path   TEXT        NOT NULL DEFAULT '',
    file_name    TEXT        NOT NULL DEFAULT '',
    file_size    BIGINT      NOT NULL DEFAULT 0,
    duration     DOUBLE PRECISION NOT NULL DEFAULT 0,
    resolution   TEXT        NOT NULL DEFAULT '',
    format       TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'pending',
    error_msg    TEXT        NOT NULL DEFAULT '',
    completed_at TIMESTAMP,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery_download_infos (
    id                 SERIAL PRIMARY KEY,
    gallery_id         INTEGER     NOT NULL UNIQUE REFERENCES galleries(id) ON DELETE CASCADE,
    title              TEXT        NOT NULL DEFAULT '',
    file_count         INTEGER     NOT NULL DEFAULT 0,
    file_size_text     TEXT        NOT NULL DEFAULT '',
    image_dimensions   TEXT        NOT NULL DEFAULT '',
    password           TEXT        NOT NULL DEFAULT '',
    download_url       TEXT        NOT NULL DEFAULT '',
    download_source    TEXT        NOT NULL DEFAULT 'unknown',
    ouo_url            TEXT        NOT NULL DEFAULT '',
    resolved_direct_url TEXT       NOT NULL DEFAULT '',
    provider           TEXT        NOT NULL DEFAULT '',
    requires_login     BOOLEAN     NOT NULL DEFAULT FALSE,
    requires_email     BOOLEAN     NOT NULL DEFAULT FALSE,
    status             TEXT        NOT NULL DEFAULT 'available',
    local_path         TEXT        NOT NULL DEFAULT '',
    extracted_path     TEXT        NOT NULL DEFAULT '',
    actual_size        BIGINT      NOT NULL DEFAULT 0,
    zip_file_name      TEXT        NOT NULL DEFAULT '',
    parallelism        INTEGER     NOT NULL DEFAULT 0,
    avg_speed          INTEGER     NOT NULL DEFAULT 0,
    verified_count     INTEGER     NOT NULL DEFAULT 0,
    count_matched      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sniff_tasks (
    id            SERIAL PRIMARY KEY,
    seq           TEXT,
    url           TEXT        NOT NULL,
    site_id       TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'pending',
    total_found   INTEGER     NOT NULL DEFAULT 0,
    total_created INTEGER     NOT NULL DEFAULT 0,
    total_skipped INTEGER     NOT NULL DEFAULT 0,
    error_msg     TEXT        NOT NULL DEFAULT '',
    completed_at  TIMESTAMP,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_configs (
    id          SERIAL PRIMARY KEY,
    key         TEXT        NOT NULL UNIQUE,
    value       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_accounts (
    id            SERIAL PRIMARY KEY,
    site_id       TEXT        NOT NULL,
    username      TEXT        NOT NULL,
    password      TEXT        NOT NULL,
    domain        TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'active',
    auth_cookies  TEXT        NOT NULL DEFAULT '',
    cookie_prefix TEXT        NOT NULL DEFAULT '',
    last_login_at TIMESTAMP,
    last_used_at  TIMESTAMP,
    fail_count    INTEGER     NOT NULL DEFAULT 0,
    remark        TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persons (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL UNIQUE,
    pinyin        TEXT        NOT NULL DEFAULT '',
    aliases       TEXT        NOT NULL DEFAULT '[]',
    source        TEXT        NOT NULL DEFAULT 'auto',
    source_game   TEXT,
    gallery_count INTEGER     NOT NULL DEFAULT 0,
    confirmed     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocklist_rules (
    id         SERIAL PRIMARY KEY,
    site_id    TEXT        NOT NULL DEFAULT 'all',
    field_type TEXT        NOT NULL,
    keyword    TEXT        NOT NULL,
    match_mode TEXT        NOT NULL DEFAULT 'includes',
    enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
    remark     TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id         SERIAL PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    value      TEXT        NOT NULL DEFAULT '',
    category   TEXT        NOT NULL DEFAULT 'general',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dag_events (
    id        SERIAL PRIMARY KEY,
    seq       INTEGER     NOT NULL UNIQUE,
    dag_id    TEXT        NOT NULL,
    node_id   TEXT,
    type      TEXT        NOT NULL,
    payload   TEXT        NOT NULL,
    timestamp TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dag_snapshots (
    id         SERIAL PRIMARY KEY,
    dag_id     TEXT        NOT NULL,
    state      TEXT        NOT NULL,
    last_seq   INTEGER     NOT NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS download_history (
    id           TEXT        PRIMARY KEY,
    site_id      TEXT        NOT NULL,
    gallery_id   INTEGER     NOT NULL,
    url          TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'completed',
    image_count  INTEGER     NOT NULL DEFAULT 0,
    video_count  INTEGER     NOT NULL DEFAULT 0,
    title        TEXT        NOT NULL DEFAULT '',
    protagonist  TEXT        NOT NULL DEFAULT '',
    save_path    TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, gallery_id)
);

CREATE TABLE IF NOT EXISTS sjs_bookmarks (
    id            SERIAL PRIMARY KEY,
    url           TEXT        NOT NULL UNIQUE,
    thread_id     TEXT        NOT NULL,
    title         TEXT        NOT NULL DEFAULT '',
    cover_url     TEXT        NOT NULL DEFAULT '',
    author        TEXT        NOT NULL DEFAULT '',
    post_date     TEXT        NOT NULL DEFAULT '',
    forum_section TEXT        NOT NULL DEFAULT '',
    notes         TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_configs (
    id           SERIAL PRIMARY KEY,
    site_id      TEXT        NOT NULL DEFAULT '',
    config_key   TEXT        NOT NULL DEFAULT '',
    config_value TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
}
