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
			id          SERIAL PRIMARY KEY,
			model_name  TEXT NOT NULL,
			variant     TEXT NOT NULL,
			variant_type TEXT NOT NULL,
			score       FLOAT NOT NULL,
			action      TEXT NOT NULL,
			gallery_ids INTEGER[],
			created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS model_variant_queue (
			id           SERIAL PRIMARY KEY,
			model_name   TEXT NOT NULL,
			variant      TEXT NOT NULL,
			variant_type TEXT NOT NULL,
			score        FLOAT NOT NULL,
			status       TEXT DEFAULT 'pending',
			created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(model_name, variant)
		)`,
		`CREATE TABLE IF NOT EXISTS model_variant_scan_state (
			id                SERIAL PRIMARY KEY,
			last_scan_at      TIMESTAMP NOT NULL DEFAULT NOW(),
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
