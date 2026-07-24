package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DBOptional connects to the configured PostgreSQL and performs:
//  1. URL backup  — dump all task-pool URLs to a plain text file
//  2. Error scan   — scan title + protagonist columns, classify error patterns
//
// Usage: go run ./cmd/db-scan/main.go
const (
	dsn          = "postgres://puchipix:puchipix@localhost:5432/puchipix?sslmode=disable"
	backupPath   = "../../task_pool_urls_backup.txt"
	reportPath   = "../../tmp/db_scan_report.txt"
	sampleLimit  = 4000
)

type galleryRow struct {
	ID           int
	SourceURL    string
	SiteID       string
	Title        string
	Protagonist  string
	Description  string
	GameChars    *string
	Status       string
}

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		die("connect PG: %v", err)
	}
	defer pool.Close()

	// ── 1. URL backup ──
	urls, err := dumpURLs(ctx, pool)
	if err != nil {
		die("dump URLs: %v", err)
	}
	if err := writeLines(backupPath, urls); err != nil {
		die("write backup: %v", err)
	}
	fmt.Printf("[backup] %d URLs → %s\n", len(urls), backupPath)

	// ── 2. Scan galleries ──
	rows, err := scanGalleries(ctx, pool)
	if err != nil {
		die("scan galleries: %v", err)
	}
	fmt.Printf("[scan] %d galleries loaded\n", len(rows))

	report := buildReport(rows)
	if err := os.WriteFile(reportPath, []byte(report), 0644); err != nil {
		die("write report: %v", err)
	}
	fmt.Printf("[report] → %s\n", reportPath)
	fmt.Println("\n" + report)
}

func dumpURLs(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	var urls []string

	// galleries.source_url — primary task pool
	gRows, err := pool.Query(ctx,
		`SELECT source_url FROM galleries WHERE source_url IS NOT NULL AND source_url <> '' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer gRows.Close()
	for gRows.Next() {
		var u string
		if err := gRows.Scan(&u); err != nil {
			return nil, err
		}
		urls = append(urls, u)
	}

	// sniff_tasks.url — discovery task pool
	sRows, err := pool.Query(ctx,
		`SELECT url FROM sniff_tasks WHERE url IS NOT NULL AND url <> '' ORDER BY id`)
	if err != nil {
		// non-fatal: sniff_tasks may be empty
		fmt.Fprintf(os.Stderr, "[warn] sniff_tasks query: %v\n", err)
	} else {
		defer sRows.Close()
		for sRows.Next() {
			var u string
			if err := sRows.Scan(&u); err == nil {
				urls = append(urls, u)
			}
		}
	}

	// download_tasks.url — video task pool
	dRows, err := pool.Query(ctx,
		`SELECT url FROM download_tasks WHERE url IS NOT NULL AND url <> '' ORDER BY id`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[warn] download_tasks query: %v\n", err)
	} else {
		defer dRows.Close()
		for dRows.Next() {
			var u string
			if err := dRows.Scan(&u); err == nil {
				urls = append(urls, u)
			}
		}
	}

	return urls, nil
}

func scanGalleries(ctx context.Context, pool *pgxpool.Pool) ([]galleryRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, source_url, site_id, title, protagonist, description, game_characters, status
		FROM galleries
		ORDER BY id
		LIMIT $1`, sampleLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []galleryRow
	for rows.Next() {
		var r galleryRow
		if err := rows.Scan(&r.ID, &r.SourceURL, &r.SiteID, &r.Title, &r.Protagonist,
			&r.Description, &r.GameChars, &r.Status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type errorClass struct {
	name   string
	count  int
	sample []string
}

func (e *errorClass) add(title, prot string) {
	e.count++
	if len(e.sample) < 6 {
		e.sample = append(e.sample, fmt.Sprintf("  • title=%q prot=%q", trunc(title, 60), trunc(prot, 30)))
	}
}

func buildReport(rows []galleryRow) string {
	var b strings.Builder
	total := len(rows)
	if total == 0 {
		return "# DB Scan Report\n\nNo galleries found.\n"
	}

	// overall stats
	bySite := map[string]int{}
	byStatus := map[string]int{}
	emptyProt := 0
	emptyTitle := 0
	for _, r := range rows {
		bySite[r.SiteID]++
		byStatus[r.Status]++
		if strings.TrimSpace(r.Protagonist) == "" {
			emptyProt++
		}
		if strings.TrimSpace(r.Title) == "" {
			emptyTitle++
		}
	}

	// error classification
	var (
		clsEmpty           errorClass
		clsGameCharAsProto errorClass
		clsDescFragAsProto errorClass
		clsCountAsProto    errorClass
		clsPureLatinProto  errorClass
		clsLooksOK         errorClass
		clsTooLongProto    errorClass
		clsDirtyTitle      errorClass
		clsDirtyProt       errorClass
	)
	clsEmpty.name = "A. 空主角 (ExtractProtagonist 未生效)"
	clsGameCharAsProto.name = "B. 游戏角色误判为主角"
	clsDescFragAsProto.name = "C. 描述片段误判为主角"
	clsCountAsProto.name = "D. 照片/视频数量误判为主角"
	clsPureLatinProto.name = "E. 纯拉丁串误判 (可能是目录编号/用户名)"
	clsLooksOK.name = "F. 看似正确 (在模特库或合理人名)"
	clsTooLongProto.name = "G. 主角过长 (>15 runes, 含描述)"
	clsDirtyTitle.name = "H. 标题含脏前缀 (COS福利/Cosplay/[xxx])"
	clsDirtyProt.name = "I. 主角含脏前缀/分隔符"

	gameNames := []string{"崩坏星穹铁道", "星穹铁道", "原神", "碧蓝航线", "碧蓝档案",
		"明日方舟", "尼尔", "英雄联盟", "崩坏3", "鸣潮", "绝区零", "火影忍者", "电锯人", "葬送的芙莉莲"}
	dirtyPreambles := []string{"COS福利", "Cos福利", "cos福利", "Cosplay", "COSPLAY",
		"cosplay", "Coser", "COSER", "coser", "JK制服", "jk制服", "[cos", "[Cos", "[私房", "[模特"}

	for _, r := range rows {
		title := strings.TrimSpace(r.Title)
		prot := strings.TrimSpace(r.Protagonist)

		if prot == "" {
			clsEmpty.add(title, prot)
			// still check dirty title
			if hasAny(title, dirtyPreambles) {
				clsDirtyTitle.add(title, prot)
			}
			continue
		}

		// dirty protagonist (contains separator or preamble)
		if strings.ContainsAny(prot, "_|-｜|：:") || hasAny(prot, dirtyPreambles) {
			clsDirtyProt.add(title, prot)
			continue
		}

		// count pattern as protagonist
		if isCountPattern(prot) {
			clsCountAsProto.add(title, prot)
			continue
		}

		// game character as protagonist
		if isGameCharName(prot, gameNames) {
			clsGameCharAsProto.add(title, prot)
			continue
		}

		// description fragment (contains 写真/合集/套图/福利/图包/私拍/同人)
		if hasAny(prot, []string{"写真", "合集", "套图", "福利", "图包", "私拍", "同人", "Cosplay", "cosplay"}) {
			clsDescFragAsProto.add(title, prot)
			continue
		}

		// pure latin (likely catalog number like JKL.022 or username)
		if isPureLatin(prot) {
			clsPureLatinProto.add(title, prot)
			continue
		}

		// too long
		if utf8.RuneCountInString(prot) > 15 {
			clsTooLongProto.add(title, prot)
			continue
		}

		clsLooksOK.add(title, prot)
	}

	allClasses := []*errorClass{&clsEmpty, &clsGameCharAsProto, &clsDescFragAsProto,
		&clsCountAsProto, &clsPureLatinProto, &clsTooLongProto, &clsDirtyTitle, &clsDirtyProt, &clsLooksOK}

	errorCount := total - clsLooksOK.count
	errorRate := float64(errorCount) * 100 / float64(total)

	fmt.Fprintf(&b, "# DB Scan Report — Galleries Title/Protagonist Error Analysis\n\n")
	fmt.Fprintf(&b, "Generated from PostgreSQL (puchipix@localhost:5432/puchipix)\n\n")
	fmt.Fprintf(&b, "## 1. Overall Statistics\n\n")
	fmt.Fprintf(&b, "| Metric | Value |\n|--------|-------|\n")
	fmt.Fprintf(&b, "| Total galleries scanned | %d |\n", total)
	fmt.Fprintf(&b, "| Empty protagonist | %d (%.1f%%) |\n", emptyProt, pct(emptyProt, total))
	fmt.Fprintf(&b, "| Empty title | %d |\n", emptyTitle)
	fmt.Fprintf(&b, "| **Error count (non-F)** | **%d** |\n", errorCount)
	fmt.Fprintf(&b, "| **Error rate** | **%.1f%%** |\n", errorRate)
	fmt.Fprintf(&b, "| Plausible-correct (F) | %d (%.1f%%) |\n", clsLooksOK.count, pct(clsLooksOK.count, total))

	fmt.Fprintf(&b, "\n### By site\n\n| Site | Count |\n|------|-------|\n")
	for _, k := range sortedKeys(bySite) {
		fmt.Fprintf(&b, "| %s | %d |\n", k, bySite[k])
	}
	fmt.Fprintf(&b, "\n### By status\n\n| Status | Count |\n|--------|-------|\n")
	for _, k := range sortedKeys(byStatus) {
		fmt.Fprintf(&b, "| %s | %d |\n", k, byStatus[k])
	}

	fmt.Fprintf(&b, "\n## 2. Error Pattern Classification\n\n")
	fmt.Fprintf(&b, "| Class | Count | %% | Description |\n|-------|-------|---|-------------|\n")
	for _, c := range allClasses {
		if c.name == "" {
			continue
		}
		fmt.Fprintf(&b, "| %s | %d | %.1f%% | |\n", c.name, c.count, pct(c.count, total))
	}

	fmt.Fprintf(&b, "\n## 3. Samples per class\n\n")
	for _, c := range allClasses {
		if c.name == "" || c.count == 0 {
			continue
		}
		fmt.Fprintf(&b, "### %s (%d)\n\n```\n%s\n```\n\n", c.name, c.count, strings.Join(c.sample, "\n"))
	}

	return b.String()
}

func hasAny(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func isCountPattern(s string) bool {
	lower := strings.ToLower(s)
	// 23P / 1V / 23P1V / 102P etc
	if strings.HasSuffix(lower, "p") || strings.HasSuffix(lower, "v") {
		core := strings.TrimRight(lower, "pv")
		core = strings.TrimRight(core, "0123456789")
		return core == ""
	}
	return false
}

func isGameCharName(s string, gameNames []string) bool {
	for _, gn := range gameNames {
		if strings.Contains(s, gn) {
			return true
		}
	}
	return false
}

func isPureLatin(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r >= 0x80 {
			return false
		}
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '.' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func pct(n, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(n) * 100 / float64(total)
}

func trunc(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n]) + "…"
}

func writeLines(path string, lines []string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, l := range lines {
		if _, err := fmt.Fprintln(f, l); err != nil {
			return err
		}
	}
	return nil
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FATAL: "+format+"\n", args...)
	os.Exit(1)
}
