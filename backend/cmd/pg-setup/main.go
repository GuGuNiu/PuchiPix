package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"
	}

	// Connect to template1 default DB to create puchipix DB
	adminDSN := "postgres://puchipix:puchipix@localhost:5432/template1?sslmode=disable"
	pool, err := pgxpool.New(context.Background(), adminDSN)
	if err != nil {
		log.Fatalf("connect to postgres db: %v", err)
	}
	defer pool.Close()
	ctx := context.Background()

	// Create puchipix database if not exists
	var exists bool
	pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'puchipix')`).Scan(&exists)
	if !exists {
		_, err = pool.Exec(ctx, `CREATE DATABASE puchipix`)
		if err != nil {
			log.Fatalf("create database: %v", err)
		}
		fmt.Println("Created database 'puchipix'")
	} else {
		fmt.Println("Database 'puchipix' already exists")
	}
	pool.Close()

	// Now connect to puchipix and create tables
	pool2, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("connect to puchipix: %v", err)
	}
	defer pool2.Close()

	// Create galleries table
	ddls := []string{
		`CREATE TABLE IF NOT EXISTS models (
			id            SERIAL PRIMARY KEY,
			name          TEXT NOT NULL UNIQUE,
			pinyin        TEXT NOT NULL DEFAULT '',
			aliases       TEXT NOT NULL DEFAULT '[]',
			category      TEXT NOT NULL DEFAULT 'coser',
			notes         TEXT NOT NULL DEFAULT '',
			avatar_url    TEXT NOT NULL DEFAULT '',
			bio           TEXT NOT NULL DEFAULT '',
			gallery_count INTEGER NOT NULL DEFAULT 0,
			created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS game_characters (
			id            SERIAL PRIMARY KEY,
			name          TEXT NOT NULL,
			pinyin        TEXT NOT NULL DEFAULT '',
			aliases       TEXT NOT NULL DEFAULT '[]',
			game_name     TEXT NOT NULL DEFAULT '',
			game_name_en  TEXT NOT NULL DEFAULT '',
			created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(name, game_name)
		)`,
		`CREATE TABLE IF NOT EXISTS galleries (
			id                   SERIAL PRIMARY KEY,
			seq                  TEXT,
			source_url           TEXT NOT NULL UNIQUE,
			site_id              TEXT NOT NULL DEFAULT 'aimeizizi',
			scraped_domain       TEXT NOT NULL DEFAULT '',
			title                TEXT NOT NULL DEFAULT '',
			protagonist          TEXT NOT NULL DEFAULT '',
			description          TEXT NOT NULL DEFAULT '',
			category             TEXT NOT NULL DEFAULT '',
			tags                 TEXT NOT NULL DEFAULT '',
			cover_url            TEXT NOT NULL DEFAULT '',
			cover_local_path     TEXT NOT NULL DEFAULT '',
			image_count          INTEGER NOT NULL DEFAULT 0,
			video_count          INTEGER NOT NULL DEFAULT 0,
			page_count           INTEGER NOT NULL DEFAULT 0,
			status               TEXT NOT NULL DEFAULT 'pending',
			error_msg            TEXT NOT NULL DEFAULT '',
			download_method      TEXT NOT NULL DEFAULT 'pending',
			expected_image_count INTEGER NOT NULL DEFAULT 0,
			expected_video_count INTEGER NOT NULL DEFAULT 0,
			content_verified     BOOLEAN NOT NULL DEFAULT FALSE,
			save_path            TEXT NOT NULL DEFAULT '',
			total_size           BIGINT NOT NULL DEFAULT 0,
			downloaded_size      BIGINT NOT NULL DEFAULT 0,
			game_characters      TEXT,
			publish_time         TEXT,
			raw_title            TEXT NOT NULL DEFAULT '',
			scraped_at           TIMESTAMP,
			completed_at         TIMESTAMP,
			created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, ddl := range ddls {
		if _, err := pool2.Exec(ctx, ddl); err != nil {
			log.Fatalf("DDL: %v\nSQL: %s", err, ddl)
		}
	}
	fmt.Println("Tables created successfully")

	// Seed models from embedded JSON
	modelData, err := os.ReadFile("resources/model/coser.json")
	if err != nil {
		log.Fatalf("read coser.json: %v", err)
	}
	var modelWrapper struct {
		Models []struct {
			Name     string   `json:"name"`
			Pinyin   string   `json:"pinyin"`
			Aliases  []string `json:"aliases"`
			Category string   `json:"category"`
		} `json:"models"`
	}
	if err := json.Unmarshal(modelData, &modelWrapper); err != nil {
		log.Fatalf("parse coser.json: %v", err)
	}
	for _, m := range modelWrapper.Models {
		aliasesJSON, _ := json.Marshal(m.Aliases)
		cat := m.Category
		if cat == "" {
			cat = "coser"
		}
		pool2.Exec(ctx,
			`INSERT INTO models (name, pinyin, aliases, category)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (name) DO UPDATE SET
			   pinyin = EXCLUDED.pinyin,
			   aliases = EXCLUDED.aliases,
			   category = EXCLUDED.category`,
			m.Name, m.Pinyin, string(aliasesJSON), cat)
	}
	fmt.Printf("Seeded %d models\n", len(modelWrapper.Models))

	fmt.Println("Setup complete!")
}
