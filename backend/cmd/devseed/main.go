// Dev-only utility: seeds download_tasks with one row per TaskStatus so the
// Tasks page can be screenshot-tested without running real downloads. Rows
// carry the seed.local URL prefix and are replaced on every run, and no row
// gets a dag_id, so the orchestrator's boot reconcile never touches them.
//
// Usage: go run ./cmd/devseed [db-path]   (defaults to dbconfig.GetDBPath())
package main

import (
	"database/sql"
	"fmt"
	"os"

	"backend/internal/db/dbconfig"

	_ "modernc.org/sqlite"
)

const seedURLPrefix = "https://seed.local/task/"

type seedRow struct {
	status   string
	progress float64
	title    string
	errMsg   string
	minAgo   int
}

var rows = []seedRow{
	{"scraping", 0, "Seed · 解析中（不确定滑块）", "", 1},
	{"scrape_pending", 0, "Seed · 解析排队（不确定滑块）", "", 2},
	{"preparing", 0, "Seed · 准备中（不确定滑块）", "", 3},
	{"download_pending", 0, "Seed · 下载排队（不确定滑块）", "", 4},
	{"paused", 42.5, "Seed · 已暂停（不确定滑块）", "", 5},
	{"downloading", 67.3, "Seed · 下载中（蓝色渐变）", "", 6},
	{"scraped", 45, "Seed · 待下载（蓝色渐变）", "", 7},
	{"pending", 0, "Seed · 等待开始（灰色渐变）", "", 8},
	{"merging", 82.5, "Seed · 合并中（shimmer）", "", 9},
	{"transcoding", 88, "Seed · 转码中（shimmer）", "", 10},
	{"probing", 94, "Seed · 探测中（shimmer）", "", 11},
	{"completed", 100, "Seed · 已完成（实色绿）", "", 12},
	{"partial", 61.8, "Seed · 部分完成（琥珀渐变）", "", 13},
	{"failed", 30.2, "Seed · 失败（实色红）", "HTTP 404: source segment not found", 14},
	{"cancelled", 25, "Seed · 已取消（实色灰）", "", 15},
}

func main() {
	path := dbconfig.GetDBPath()
	if len(os.Args) > 1 {
		path = os.Args[1]
	}

	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		fmt.Fprintf(os.Stderr, "open %s: %v\n", path, err)
		os.Exit(1)
	}
	defer db.Close()

	if _, err := db.Exec(
		`DELETE FROM video_infos WHERE task_id IN (SELECT id FROM download_tasks WHERE url LIKE ?)`,
		seedURLPrefix+"%",
	); err != nil {
		fmt.Fprintf(os.Stderr, "clear video_infos: %v\n", err)
		os.Exit(1)
	}
	if _, err := db.Exec(`DELETE FROM download_tasks WHERE url LIKE ?`, seedURLPrefix+"%"); err != nil {
		fmt.Fprintf(os.Stderr, "clear download_tasks: %v\n", err)
		os.Exit(1)
	}

	for _, r := range rows {
		res, err := db.Exec(
			`INSERT INTO download_tasks (url, status, progress, error_msg, created_at, updated_at)
			 VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now'))`,
			seedURLPrefix+r.status, r.status, r.progress, r.errMsg, fmt.Sprintf("-%d minutes", r.minAgo),
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "insert %s: %v\n", r.status, err)
			os.Exit(1)
		}
		id, _ := res.LastInsertId()
		if _, err := db.Exec(
			`INSERT INTO video_infos (task_id, title, source_url) VALUES (?, ?, ?)`,
			id, r.title, seedURLPrefix+r.status,
		); err != nil {
			fmt.Fprintf(os.Stderr, "insert video_info %s: %v\n", r.status, err)
			os.Exit(1)
		}
	}

	fmt.Printf("seeded %d tasks into %s\n", len(rows), path)
}
