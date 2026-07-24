package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/titleparser"
	"backend/resources"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	ctx := context.Background()

	// Step 1: Add raw_title column if missing
	var exists bool
	pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM information_schema.columns
		 WHERE table_name='galleries' AND column_name='raw_title')`).Scan(&exists)
	if !exists {
		if _, err := pool.Exec(ctx, `ALTER TABLE galleries ADD COLUMN raw_title TEXT NOT NULL DEFAULT ''`); err != nil {
			log.Fatalf("add raw_title: %v", err)
		}
		log.Println("Added raw_title column to galleries")
	} else {
		log.Println("raw_title column already exists")
	}

	// Step 2: Build title parser with embedded model/character data
	parser := titleparser.New()

	// Load models from embedded JSON
	models, err := titleparser.LoadModelsFromJSON(resources.CoserJSON)
	if err != nil {
		log.Fatalf("load models: %v", err)
	}
	parser.LoadModels(models)
	log.Printf("Loaded %d models", len(models))

	// Load game characters from embedded FS
	entries, err := resources.GameFS.ReadDir("game")
	if err != nil {
		log.Fatalf("read game dir: %v", err)
	}
	totalChars := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := resources.GameFS.ReadFile("game/" + entry.Name())
		if err != nil {
			continue
		}
		chars, err := titleparser.LoadGameCharactersFromJSON(data)
		if err != nil {
			continue
		}
		parser.LoadGameCharacters(chars)
		totalChars += len(chars)
	}
	log.Printf("Loaded %d game characters", totalChars)

	// Step 3: Fetch all galleries
	rows, err := pool.Query(ctx,
		`SELECT id, title, site_id, protagonist FROM galleries ORDER BY id`)
	if err != nil {
		log.Fatalf("query: %v", err)
	}
	defer rows.Close()

	type galleryRow struct {
		ID          int
		Title       string
		SiteID      string
		Protagonist string
	}
	var galleries []galleryRow
	for rows.Next() {
		var g galleryRow
		if err := rows.Scan(&g.ID, &g.Title, &g.SiteID, &g.Protagonist); err != nil {
			continue
		}
		galleries = append(galleries, g)
	}
	rows.Close()

	log.Printf("Loaded %d galleries from DB", len(galleries))

	// Step 5: Re-parse each gallery title and update DB
	updated := 0
	protoFixed := 0
	gcFixed := 0

	for _, g := range galleries {
		if g.Title == "" {
			continue
		}

		// The stored title is already "cleaned" by the old algorithm.
		// For aimeizizi, the raw title would have been in the HTML's <h1> tag.
		// Since we can't recover it, use current title as raw_title and
		// re-parse protagonist/description/gameCharacters from it.
		rawTitle := g.Title

		// Set raw_title (idempotent)
		if _, err := pool.Exec(ctx,
			`UPDATE galleries SET raw_title = $1 WHERE id = $2 AND raw_title = ''`,
			rawTitle, g.ID); err != nil {
			log.Printf("WARN: update raw_title for id=%d: %v", g.ID, err)
		}

		// Re-parse protagonist using improved title parser
		result := parser.Parse(rawTitle)

		// Build description as normalized directory name (for future save_path consistency)
		description := titleparser.NormalizeDirectoryName(rawTitle)
		// Remove protagonist from description to avoid redundancy
		if result.Protagonist != "" {
			protoNorm := titleparser.NormalizeDirectoryName(result.Protagonist)
			description = strings.ReplaceAll(description, protoNorm, "")
			description = strings.TrimSpace(description)
			// Clean up leading "与" or " -" separators
			description = strings.TrimLeft(description, "与- ")
		}

		gameCharsJSON := "[]"
		if len(result.GameCharacters) > 0 {
			b, _ := json.Marshal(result.GameCharacters)
			gameCharsJSON = string(b)
		}

		// Only update if protagonist actually changed or was empty
		var shouldUpdateProto bool
		if result.Protagonist != "" && (g.Protagonist == "" || result.Protagonist != g.Protagonist) {
			shouldUpdateProto = true
		}

		if shouldUpdateProto || true { // always update game_chars + description
			_, err := pool.Exec(ctx,
				`UPDATE galleries SET
				 protagonist = $1,
				 description = $2,
				 game_characters = $3,
				 updated_at = CURRENT_TIMESTAMP
				 WHERE id = $4`,
				result.Protagonist, description, gameCharsJSON, g.ID)
			if err != nil {
				log.Printf("WARN: update gallery id=%d: %v", g.ID, err)
				continue
			}
			if shouldUpdateProto {
				protoFixed++
			}
			if len(result.GameCharacters) > 0 {
				gcFixed++
			}
			updated++
		}
	}

	log.Printf("Updated %d galleries (protagonist: %d, game_chars: %d)", updated, protoFixed, gcFixed)

	// Step 6: Stats
	var total, withProto, withGC, withRaw int
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM galleries`).Scan(&total)
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM galleries WHERE protagonist != ''`).Scan(&withProto)
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM galleries WHERE game_characters IS NOT NULL AND game_characters != '[]'`).Scan(&withGC)
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM galleries WHERE raw_title != ''`).Scan(&withRaw)

	fmt.Println()
	fmt.Printf("=== Final Stats ===\n")
	fmt.Printf("Total galleries:           %d\n", total)
	fmt.Printf("With protagonist:          %d (%.1f%%)\n", withProto, float64(withProto)/float64(total)*100)
	fmt.Printf("With game characters:      %d\n", withGC)
	fmt.Printf("With raw_title:            %d\n", withRaw)
	fmt.Printf("Protagonists fixed:        %d\n", protoFixed)
	fmt.Println()
	fmt.Println("Done.")
}
