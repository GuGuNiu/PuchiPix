// Package datarepo provides data seeding and repository services for
// model profiles and game character data. It loads pre-populated JSON
// from embedded data files and upserts them into PostgreSQL on startup.
package datarepo

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"strings"

	"backend/internal/db"
	"backend/internal/titleparser"
	"backend/resources"
)

// Seeder initializes the model and game character tables from
// embedded JSON, ensuring the database is populated on first run.
type Seeder struct {
	database *db.Database
}

// NewSeeder creates a data seeder backed by the given database.
func NewSeeder(database *db.Database) *Seeder {
	return &Seeder{database: database}
}

// EnsureTables creates the models and game_characters tables if
// they don't exist yet.
func (s *Seeder) EnsureTables(ctx context.Context) error {
	ddls := []string{
		`CREATE TABLE IF NOT EXISTS models (
			id            SERIAL PRIMARY KEY,
			name          TEXT        NOT NULL UNIQUE,
			pinyin        TEXT        NOT NULL DEFAULT '',
			aliases       TEXT        NOT NULL DEFAULT '[]',
			category      TEXT        NOT NULL DEFAULT 'coser',
			notes         TEXT        NOT NULL DEFAULT '',
			avatar_url    TEXT        NOT NULL DEFAULT '',
			bio           TEXT        NOT NULL DEFAULT '',
			gallery_count INTEGER     NOT NULL DEFAULT 0,
			created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_models_pinyin ON models(pinyin)`,
		`CREATE INDEX IF NOT EXISTS idx_models_category ON models(category)`,
		`CREATE INDEX IF NOT EXISTS idx_models_name ON models(name)`,
		`CREATE TABLE IF NOT EXISTS game_characters (
			id            SERIAL PRIMARY KEY,
			name          TEXT        NOT NULL,
			pinyin        TEXT        NOT NULL DEFAULT '',
			aliases       TEXT        NOT NULL DEFAULT '[]',
			game_name     TEXT        NOT NULL DEFAULT '',
			game_name_en  TEXT        NOT NULL DEFAULT '',
			created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name, game_name)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_game_characters_name ON game_characters(name)`,
		`CREATE INDEX IF NOT EXISTS idx_game_characters_game ON game_characters(game_name)`,
		`CREATE INDEX IF NOT EXISTS idx_game_characters_pinyin ON game_characters(pinyin)`,
	}

	for _, ddl := range ddls {
		if _, err := s.database.Exec(ctx, ddl); err != nil {
			return fmt.Errorf("ensure table: %w\nSQL: %s", err, ddl)
		}
	}
	return nil
}

// SeedModels upserts all models from the embedded JSON into the
// models table. Idempotent: existing rows are updated, new rows
// are inserted.
func (s *Seeder) SeedModels(ctx context.Context) error {
	type jsonModel struct {
		Name     string   `json:"name"`
		Pinyin   string   `json:"pinyin"`
		Aliases  []string `json:"aliases"`
		Category string   `json:"category"`
	}
	var wrapper struct {
		Models []jsonModel `json:"models"`
	}
	if err := json.Unmarshal(resources.CoserJSON, &wrapper); err != nil {
		return fmt.Errorf("parse coser JSON: %w", err)
	}

	for _, m := range wrapper.Models {
		aliasesJSON, _ := json.Marshal(m.Aliases)
		category := m.Category
		if category == "" {
			category = "coser"
		}
		_, err := s.database.Exec(ctx,
			`INSERT INTO models (name, pinyin, aliases, category)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (name) DO UPDATE SET
			   pinyin   = EXCLUDED.pinyin,
			   aliases  = EXCLUDED.aliases,
			   category = EXCLUDED.category,
			   updated_at = CURRENT_TIMESTAMP`,
			m.Name, m.Pinyin, string(aliasesJSON), category,
		)
		if err != nil {
			return fmt.Errorf("upsert model %q: %w", m.Name, err)
		}
	}

	log.Printf("[datarepo] Seeded %d models", len(wrapper.Models))
	return nil
}

// SeedGameCharacters upserts all game characters from the embedded
// per-game JSON files into the game_characters table. Idempotent.
func (s *Seeder) SeedGameCharacters(ctx context.Context) error {
	type jsonChar struct {
		Name    string   `json:"name"`
		Pinyin  string   `json:"pinyin"`
		Aliases []string `json:"aliases"`
	}
	type jsonGame struct {
		Name       string     `json:"name"`
		NameEn     string     `json:"nameEn"`
		Characters []jsonChar `json:"characters"`
	}

	entries, err := fs.ReadDir(resources.GameFS, "game")
	if err != nil {
		return fmt.Errorf("read game dir: %w", err)
	}

	totalChars := 0
	totalGames := 0

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		data, err := fs.ReadFile(resources.GameFS, "game/"+entry.Name())
		if err != nil {
			return fmt.Errorf("read game file %s: %w", entry.Name(), err)
		}

		var game jsonGame
		if err := json.Unmarshal(data, &game); err != nil {
			return fmt.Errorf("parse game file %s: %w", entry.Name(), err)
		}

		for _, c := range game.Characters {
			aliasesJSON, _ := json.Marshal(c.Aliases)
			_, err := s.database.Exec(ctx,
				`INSERT INTO game_characters (name, pinyin, aliases, game_name, game_name_en)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (name, game_name) DO UPDATE SET
				   pinyin      = EXCLUDED.pinyin,
				   aliases     = EXCLUDED.aliases,
				   game_name_en = EXCLUDED.game_name_en,
				   updated_at  = CURRENT_TIMESTAMP`,
				c.Name, c.Pinyin, string(aliasesJSON), game.Name, game.NameEn,
			)
			if err != nil {
				return fmt.Errorf("upsert char %q (%s): %w", c.Name, game.Name, err)
			}
			totalChars++
		}
		totalGames++
	}

	log.Printf("[datarepo] Seeded %d game characters across %d games", totalChars, totalGames)
	return nil
}

// SeedAll runs EnsureTables + SeedModels + SeedGameCharacters in
// sequence. Call this once during server startup.
func (s *Seeder) SeedAll(ctx context.Context) error {
	if err := s.EnsureTables(ctx); err != nil {
		return fmt.Errorf("ensure tables: %w", err)
	}
	if err := s.SeedModels(ctx); err != nil {
		return fmt.Errorf("seed models: %w", err)
	}
	if err := s.SeedGameCharacters(ctx); err != nil {
		return fmt.Errorf("seed game chars: %w", err)
	}
	return nil
}

// LoadModelsFromDB reads all models from the database and returns
// titleparser-compatible entries.
func (s *Seeder) LoadModelsFromDB(ctx context.Context) ([]titleparser.ModelEntry, error) {
	rows, err := s.database.Query(ctx,
		`SELECT name, pinyin, aliases FROM models ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("query models: %w", err)
	}
	defer rows.Close()

	var entries []titleparser.ModelEntry
	for rows.Next() {
		var name, pinyin, aliasesJSON string
		if err := rows.Scan(&name, &pinyin, &aliasesJSON); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		var aliases []string
		if aliasesJSON != "" {
			json.Unmarshal([]byte(aliasesJSON), &aliases)
		}
		entries = append(entries, titleparser.ModelEntry{
			Name:    name,
			Pinyin:  pinyin,
			Aliases: aliases,
		})
	}
	return entries, rows.Err()
}

// LoadGameCharactersFromDB reads all game characters from the database
// and returns titleparser-compatible entries.
func (s *Seeder) LoadGameCharactersFromDB(ctx context.Context) ([]titleparser.GameCharEntry, error) {
	rows, err := s.database.Query(ctx,
		`SELECT name, pinyin, aliases, game_name, game_name_en FROM game_characters ORDER BY game_name, name`)
	if err != nil {
		return nil, fmt.Errorf("query game_chars: %w", err)
	}
	defer rows.Close()

	var entries []titleparser.GameCharEntry
	for rows.Next() {
		var name, pinyin, aliasesJSON, gameName, gameNameEn string
		if err := rows.Scan(&name, &pinyin, &aliasesJSON, &gameName, &gameNameEn); err != nil {
			return nil, fmt.Errorf("scan game_char: %w", err)
		}
		var aliases []string
		if aliasesJSON != "" {
			json.Unmarshal([]byte(aliasesJSON), &aliases)
		}
		entries = append(entries, titleparser.GameCharEntry{
			Name:     name,
			Pinyin:   pinyin,
			Aliases:  aliases,
			GameName: gameName,
			GameEn:   gameNameEn,
		})
	}
	return entries, rows.Err()
}

// BuildTitleParser creates a fully-loaded title parser by reading
// all models and game characters from the database.
func (s *Seeder) BuildTitleParser(ctx context.Context) (*titleparser.Parser, error) {
	parser := titleparser.New()

	models, err := s.LoadModelsFromDB(ctx)
	if err != nil {
		return nil, fmt.Errorf("load models: %w", err)
	}
	parser.LoadModels(models)

	chars, err := s.LoadGameCharactersFromDB(ctx)
	if err != nil {
		return nil, fmt.Errorf("load game chars: %w", err)
	}
	parser.LoadGameCharacters(chars)

	log.Printf("[datarepo] Title parser built with %d models, %d game characters",
		len(models), len(chars))
	return parser, nil
}

// FixupGalleries adds missing columns and re-parses all existing gallery
// titles using the improved title parser. This is idempotent and should
// be called once after parser/model upgrades.
func (s *Seeder) FixupGalleries(ctx context.Context, parser *titleparser.Parser) error {
	// Step 1: Ensure raw_title column exists
	var exists bool
	s.database.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns
		 WHERE table_name='galleries' AND column_name='raw_title')`).Scan(&exists)
	if !exists {
		if _, err := s.database.Exec(ctx,
			`ALTER TABLE galleries ADD COLUMN raw_title TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add raw_title column: %w", err)
		}
		log.Println("[datarepo] Added raw_title column to galleries")
	}

	// Step 2: Fetch all galleries needing fixup
	rows, err := s.database.Query(ctx,
		`SELECT id, title FROM galleries WHERE title != '' ORDER BY id`)
	if err != nil {
		return fmt.Errorf("query galleries: %w", err)
	}
	defer rows.Close()

	type gRow struct {
		ID    int
		Title string
	}
	var galleries []gRow
	for rows.Next() {
		var g gRow
		if err := rows.Scan(&g.ID, &g.Title); err != nil {
			continue
		}
		galleries = append(galleries, g)
	}
	rows.Close()

	// Step 2.5: Restore original titles from raw_title if they were
	// accidentally cleaned in a previous fixup run (idempotent guard).
	restored, _ := s.database.Exec(ctx,
		`UPDATE galleries SET title = raw_title WHERE raw_title != '' AND raw_title != title`)
	if restored.RowsAffected() > 0 {
		log.Printf("[datarepo] Restored %d titles from raw_title", restored.RowsAffected())
	}

	// Step 3: Re-parse each gallery
	rawFilled := 0
	titleFixed := 0
	protoFixed := 0
	gcFixed := 0
	descFixed := 0

	for _, g := range galleries {
		rawTitle := g.Title // best-effort: current title was raw at scrape time

		// Clean cosplay preambles from both title and description.
		// Site-added prefixes like "COS福利", "Cosplay", "Coser",
		// "JK制服" are metadata, not part of the model name.
		cleanTitle := titleparser.StripCosplayPreamble(rawTitle)

		// Fill raw_title if empty (one-time)
		if _, err := s.database.Exec(ctx,
			`UPDATE galleries SET raw_title = $1 WHERE id = $2 AND raw_title = ''`,
			rawTitle, g.ID); err == nil {
			rawFilled++
		}

		// Re-parse using improved title parser
		result := parser.Parse(rawTitle)

		// Strip protagonist from title if it's still present —
		// only when the title actually contains the protagonist name,
		// to avoid double-stripping already-clean titles.
		titleHasProto := result.Protagonist != "" && stringContainsName(rawTitle, result.Protagonist)
		if titleHasProto {
			stripped := stripProtagonistFromTitle(cleanTitle, result.Protagonist)
			if stripped != cleanTitle && stripped != "" {
				cleanTitle = stripped
			}
		}

		// Update stored title if any cleaning changed it
		if cleanTitle != rawTitle {
			if _, err := s.database.Exec(ctx,
				`UPDATE galleries SET title = $1 WHERE id = $2`,
				cleanTitle, g.ID); err == nil {
				titleFixed++
			}
		}

		// Generate normalized description from the CLEAN title
		description := titleparser.NormalizeDirectoryName(cleanTitle)
		if result.Protagonist != "" {
			protoNorm := titleparser.NormalizeDirectoryName(result.Protagonist)
			description = strings.ReplaceAll(description, protoNorm, "")

			// Handle underscore-to-space normalization mismatch:
			// "KANEKO_咔喵" normalizes to "kaneko 咔喵" but
			// "KANEKO咔喵" normalizes to "kaneko咔喵" (no space).
			// Try the space-collapsed variant as a second pass.
			protoCompact := strings.ReplaceAll(protoNorm, " ", "")
			descCompact := strings.ReplaceAll(description, " ", "")
			descCompact = strings.ReplaceAll(descCompact, protoCompact, "")
			if len(descCompact) < len(description) {
				description = descCompact
			}

			description = strings.TrimLeft(strings.TrimSpace(description), "与- ")
		}

		gameCharsJSON := "[]"
		if len(result.GameCharacters) > 0 {
			b, _ := json.Marshal(result.GameCharacters)
			gameCharsJSON = string(b)
		}

		needsUpdate := result.Protagonist != "" || len(result.GameCharacters) > 0 || description != ""

		if needsUpdate {
			_, err := s.database.Exec(ctx,
				`UPDATE galleries SET
				 protagonist = $1,
				 description = $2,
				 game_characters = $3,
				 updated_at = CURRENT_TIMESTAMP
				 WHERE id = $4`,
				result.Protagonist, description, gameCharsJSON, g.ID)
			if err != nil {
				log.Printf("[datarepo] WARN: fixup gallery id=%d: %v", g.ID, err)
				continue
			}
			if result.Protagonist != "" {
				protoFixed++
			}
			if len(result.GameCharacters) > 0 {
				gcFixed++
			}
			if description != "" {
				descFixed++
			}
		}
	}

	// Step 4: Stats
	var total, withProto, withGC int
	s.database.QueryRow(ctx, `SELECT COUNT(*) FROM galleries`).Scan(&total)
	s.database.QueryRow(ctx, `SELECT COUNT(*) FROM galleries WHERE protagonist != ''`).Scan(&withProto)
	s.database.QueryRow(ctx, `SELECT COUNT(*) FROM galleries WHERE game_characters IS NOT NULL AND game_characters != '[]'`).Scan(&withGC)

	log.Printf("[datarepo] Gallery fixup complete: %d total | title_fixed: %d | raw_title: %d filled | protagonist: %d (%.0f%%) | game_chars: %d | desc: %d",
		total, titleFixed, rawFilled, withProto, float64(withProto)/float64(total)*100, withGC, descFixed)

	// Detailed verification pass: log any remaining issues
	verifyRows, err := s.database.Query(ctx, `SELECT id, title, protagonist, description, status FROM galleries ORDER BY id`)
	if err == nil {
		defer verifyRows.Close()
		issues := 0
		for verifyRows.Next() {
			var id int
			var title, proto, desc, status string
			verifyRows.Scan(&id, &title, &proto, &desc, &status)

			flag := ""
			if proto == "" {
				flag = "EMPTY_PROTO"
			} else if status == "scraping" {
				flag = "STUCK_SCRAPING"
			}
			if flag != "" {
				log.Printf("[datarepo] VERIFY ISSUE [%d] %s: title=%q proto=%q", id, flag, title, proto)
				issues++
			}
		}
		if issues == 0 {
			log.Printf("[datarepo] VERIFY: All %d galleries clean — 0 issues", total)
		}
	}

	return nil
}

// stripProtagonistFromTitle removes the protagonist name and following
// separator from the beginning of a title, leaving only the description.
func stripProtagonistFromTitle(title, protagonist string) string {
	if protagonist == "" {
		return title
	}

	lower := strings.ToLower(title)
	lowerProto := strings.ToLower(protagonist)

	// Direct prefix match: "星之迟迟 - 作品名" → "作品名"
	if strings.HasPrefix(lower, lowerProto) {
		rest := strings.TrimSpace(title[len(protagonist):])
		rest = strings.TrimLeft(rest, "-–—|｜:： ")
		return strings.TrimSpace(rest)
	}

	// Space-collapsed match: "KANEKO 咔喵" vs "KANEKO咔喵"
	collapsedTitle := collapseSpaces(title)
	collapsedProto := collapseSpaces(protagonist)
	if strings.HasPrefix(strings.ToLower(collapsedTitle), strings.ToLower(collapsedProto)) {
		// Walk the original title byte-by-byte, skipping spaces/underscores,
		// until we've consumed the same number of non-whitespace runes as the protagonist.
		protoRunes := len([]rune(protagonist))
		consumed := 0
		pos := 0
		for _, r := range title {
			if consumed >= protoRunes {
				break
			}
			if r != ' ' && r != '_' {
				consumed++
			}
			pos += len(string(r))
		}
		rest := strings.TrimSpace(title[pos:])
		rest = strings.TrimLeft(rest, "-–—|｜:： ")
		return strings.TrimSpace(rest)
	}

	return title
}

func collapseSpaces(s string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '_' {
			return -1
		}
		return r
	}, s)
}

// stringContainsName checks if the title contains the protagonist name
// using both direct and space-collapsed matching.
func stringContainsName(title, protagonist string) bool {
	if strings.Contains(title, protagonist) {
		return true
	}
	return strings.Contains(collapseSpaces(strings.ToLower(title)), collapseSpaces(strings.ToLower(protagonist)))
}
