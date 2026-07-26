//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, "postgres://puchipix:puchipix@127.0.0.1:5432/puchipix")
	if err != nil {
		fmt.Println("connection error:", err)
		return
	}
	defer pool.Close()

	// Check video_infos for task 10
	var taskID int
	var title, sourceURL, tags, actors, categories, director, resolution string
	var fileSize int64
	var duration float64
	err = pool.QueryRow(ctx, `
		SELECT task_id, title, source_url, file_size, duration, tags, actors, categories, director, resolution
		FROM video_infos WHERE task_id = 10
	`).Scan(&taskID, &title, &sourceURL, &fileSize, &duration, &tags, &actors, &categories, &director, &resolution)
	if err != nil {
		fmt.Println("video_infos query:", err)
	} else {
		fmt.Println("=== video_infos (task 10) ===")
		fmt.Printf("task_id: %d\n", taskID)
		fmt.Printf("title: %q\n", title)
		fmt.Printf("source_url: %q\n", sourceURL)
		fmt.Printf("file_size: %d (%.1f MB)\n", fileSize, float64(fileSize)/1024/1024)
		fmt.Printf("duration: %.2f min\n", duration)
		fmt.Printf("tags: %s\n", tags)
		fmt.Printf("actors: %s\n", actors)
		fmt.Printf("categories: %s\n", categories)
		fmt.Printf("director: %s\n", director)
		fmt.Printf("resolution: %s\n", resolution)
	}

	// Check download_tasks
	var id int
	var url, m3u8url, status, siteID, filePath string
	var progress float64
	err = pool.QueryRow(ctx, `
		SELECT id, url, m3u8_url, status, progress, site_id, file_path
		FROM download_tasks WHERE id = 10
	`).Scan(&id, &url, &m3u8url, &status, &progress, &siteID, &filePath)
	if err != nil {
		fmt.Println("download_tasks query:", err)
	} else {
		fmt.Println("\n=== download_tasks (id=10) ===")
		fmt.Printf("id: %d\n", id)
		fmt.Printf("url: %q\n", url)
		fmt.Printf("m3u8_url: %q\n", m3u8url)
		fmt.Printf("status: %q\n", status)
		fmt.Printf("progress: %.2f%%\n", progress)
		fmt.Printf("site_id: %q\n", siteID)
		fmt.Printf("file_path: %q\n", filePath)
	}

	// Check if file exists
	fmt.Println("\n=== File check ===")
	if filePath != "" {
		fullPath := "e:/data/Github/PuchiPix/backend/" + filePath
		info, err := os.Stat(fullPath)
		if err != nil {
			fmt.Printf("File not found: %s\nError: %v\n", fullPath, err)
		} else {
			fmt.Printf("File exists: %s\n", fullPath)
			fmt.Printf("Size: %.1f MB\n", float64(info.Size())/1024/1024)
		}
	}

	// List all files in videos directory
	entries, _ := os.ReadDir("e:/data/Github/PuchiPix/data/videos")
	fmt.Println("\n=== data/videos/ ===")
	for _, e := range entries {
		info, _ := e.Info()
		fmt.Printf("  %s  (%.1f MB)\n", e.Name(), float64(info.Size())/1024/1024)
	}
}
