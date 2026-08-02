package patrol

import (
	"context"
	"log"

	"backend/internal/db"
)

// EnsureTables creates the variant discovery and patrol tables if they
// do not already exist. Safe to call multiple times (idempotent).
func EnsureTables(database *db.Database) error {
	ctx := context.Background()

	ddls := []string{
		`CREATE TABLE IF NOT EXISTS model_variant_log (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			model_name  TEXT NOT NULL,
			variant     TEXT NOT NULL,
			variant_type TEXT NOT NULL,
			score       REAL NOT NULL,
			action      TEXT NOT NULL,
			gallery_ids TEXT,
			created_at  TEXT DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS model_variant_queue (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			model_name   TEXT NOT NULL,
			variant      TEXT NOT NULL,
			variant_type TEXT NOT NULL,
			score        REAL NOT NULL,
			status       TEXT DEFAULT 'pending',
			created_at   TEXT DEFAULT (datetime('now')),
			updated_at   TEXT DEFAULT (datetime('now')),
			UNIQUE(model_name, variant)
		)`,
		`CREATE TABLE IF NOT EXISTS model_variant_scan_state (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			last_scan_at      TEXT NOT NULL DEFAULT (datetime('now')),
			galleries_scanned INTEGER NOT NULL DEFAULT 0,
			variants_found    INTEGER NOT NULL DEFAULT 0,
			variants_promoted INTEGER NOT NULL DEFAULT 0,
			duration_ms       INTEGER NOT NULL DEFAULT 0
		)`,
	}

	for _, ddl := range ddls {
		if _, err := database.Exec(ctx, ddl); err != nil {
			return err
		}
	}

	log.Println("[variant] Variant discovery tables ensured")
	return nil
}
