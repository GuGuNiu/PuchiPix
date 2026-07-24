package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type GalleryRow struct {
	ID                 int     `json:"id"`
	Seq                *string `json:"seq"`
	SourceURL          string  `json:"source_url"`
	SiteID             string  `json:"site_id"`
	ScrapedDomain      string  `json:"scraped_domain"`
	Title              string  `json:"title"`
	Protagonist        string  `json:"protagonist"`
	Description        string  `json:"description"`
	Category           string  `json:"category"`
	Tags               string  `json:"tags"`
	CoverURL           string  `json:"cover_url"`
	CoverLocalPath     string  `json:"cover_local_path"`
	ImageCount         int     `json:"image_count"`
	VideoCount         int     `json:"video_count"`
	PageCount          int     `json:"page_count"`
	Status             string  `json:"status"`
	ErrorMsg           string  `json:"error_msg"`
	DownloadMethod     string  `json:"download_method"`
	ExpectedImageCount int     `json:"expected_image_count"`
	ExpectedVideoCount int     `json:"expected_video_count"`
	ContentVerified    bool    `json:"content_verified"`
	SavePath           string  `json:"save_path"`
	TotalSize          int64   `json:"total_size"`
	DownloadedSize     int64   `json:"downloaded_size"`
	GameCharacters     *string `json:"game_characters"`
	PublishTime        *string `json:"publish_time"`
	RawTitle           string  `json:"raw_title"`
	ScrapedAt          *string `json:"scraped_at"`
	CompletedAt        *string `json:"completed_at"`
}

func getDSN() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	return "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: pg-reinit <export|import> [file.json]\n")
		os.Exit(1)
	}

	action := os.Args[1]
	dsn := getDSN()

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	ctx := context.Background()

	switch action {
	case "export":
		exportGalleries(ctx, pool)
	case "import":
		importFile := "galleries_export.json"
		if len(os.Args) > 2 {
			importFile = os.Args[2]
		}
		importGalleries(ctx, pool, importFile)
	default:
		log.Fatalf("unknown action: %s", action)
	}
}

func exportGalleries(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := pool.Query(ctx,
		`SELECT id, seq, source_url, site_id, scraped_domain, title, protagonist,
		        description, category, tags, cover_url, cover_local_path,
		        image_count, video_count, page_count, status, error_msg,
		        download_method, expected_image_count, expected_video_count,
		        content_verified, save_path, total_size, downloaded_size,
		        game_characters, publish_time,
		        COALESCE(raw_title, title) as raw_title,
		        scraped_at::text, completed_at::text
		 FROM galleries ORDER BY id`)
	if err != nil {
		log.Fatalf("query: %v", err)
	}
	defer rows.Close()

	var galleries []GalleryRow
	for rows.Next() {
		var g GalleryRow
		if err := rows.Scan(
			&g.ID, &g.Seq, &g.SourceURL, &g.SiteID, &g.ScrapedDomain,
			&g.Title, &g.Protagonist, &g.Description, &g.Category, &g.Tags,
			&g.CoverURL, &g.CoverLocalPath, &g.ImageCount, &g.VideoCount,
			&g.PageCount, &g.Status, &g.ErrorMsg, &g.DownloadMethod,
			&g.ExpectedImageCount, &g.ExpectedVideoCount, &g.ContentVerified,
			&g.SavePath, &g.TotalSize, &g.DownloadedSize,
			&g.GameCharacters, &g.PublishTime, &g.RawTitle,
			&g.ScrapedAt, &g.CompletedAt,
		); err != nil {
			log.Printf("WARN: scan row: %v", err)
			continue
		}
		// Ensure raw_title is never empty (fallback to title for old data)
		if g.RawTitle == "" {
			g.RawTitle = g.Title
		}
		galleries = append(galleries, g)
	}

	data, err := json.MarshalIndent(galleries, "", "  ")
	if err != nil {
		log.Fatalf("marshal: %v", err)
	}

	outFile := "galleries_export.json"
	if err := os.WriteFile(outFile, data, 0644); err != nil {
		log.Fatalf("write: %v", err)
	}

	fmt.Printf("Exported %d galleries to %s\n", len(galleries), outFile)
}

func importGalleries(ctx context.Context, pool *pgxpool.Pool, file string) {
	data, err := os.ReadFile(file)
	if err != nil {
		log.Fatalf("read %s: %v", file, err)
	}

	var galleries []GalleryRow
	if err := json.Unmarshal(data, &galleries); err != nil {
		log.Fatalf("unmarshal: %v", err)
	}

	// Reset the serial sequence to avoid ID conflicts
	pool.Exec(ctx, `SELECT setval('galleries_id_seq', 1, false)`)

	inserted := 0
	for _, g := range galleries {
		_, err := pool.Exec(ctx,
			`INSERT INTO galleries (
				id, seq, source_url, site_id, scraped_domain, title, protagonist,
				description, category, tags, cover_url, cover_local_path,
				image_count, video_count, page_count, status, error_msg,
				download_method, expected_image_count, expected_video_count,
				content_verified, save_path, total_size, downloaded_size,
				game_characters, publish_time, raw_title,
				scraped_at, completed_at
			) VALUES (
				$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
				$13,$14,$15,$16,$17,$18,$19,$20,
				$21,$22,$23,$24,$25,$26,$27,
				NULLIF($28, '')::timestamptz, NULLIF($29, '')::timestamptz
			)`,
			g.ID, g.Seq, g.SourceURL, g.SiteID, g.ScrapedDomain,
			g.Title, g.Protagonist, g.Description, g.Category, g.Tags,
			g.CoverURL, g.CoverLocalPath, g.ImageCount, g.VideoCount,
			g.PageCount, g.Status, g.ErrorMsg, g.DownloadMethod,
			g.ExpectedImageCount, g.ExpectedVideoCount, g.ContentVerified,
			g.SavePath, g.TotalSize, g.DownloadedSize,
			g.GameCharacters, g.PublishTime, g.RawTitle,
			g.ScrapedAt, g.CompletedAt,
		)
		if err != nil {
			log.Printf("WARN: insert id=%d: %v", g.ID, err)
			continue
		}
		inserted++
	}

	// Fix sequence to max id
	pool.Exec(ctx, `SELECT setval('galleries_id_seq', (SELECT COALESCE(MAX(id), 1) FROM galleries))`)

	fmt.Printf("Imported %d/%d galleries\n", inserted, len(galleries))
}

// nullStr wraps a string pointer for SQL NULL handling.
func nullStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// nullStrTrim handles tags that may have trailing whitespace.
func nullStrTrim(s string) string {
	return strings.TrimSpace(s)
}
