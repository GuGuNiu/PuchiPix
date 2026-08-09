package commands

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"backend/internal/cli/ui"
	_ "modernc.org/sqlite"
)

// dbCommand provides direct SQLite database access for local querying,
// schema inspection, and data dumping without going through the API.
type dbCommand struct{}

func (dbCommand) Name() string        { return "db" }
func (dbCommand) Description() string { return "Direct database access (tables / schema / query / count / dump)" }
func (dbCommand) Usage() string {
	return "puchipix-cli db <tables|schema|query|count|dump> [args]"
}
func (dbCommand) Aliases() []string { return []string{"database", "sqlite"} }

func (dbCommand) Execute(ctx CommandContext) error {
	subcommand := ""
	if len(ctx.Args) > 0 {
		subcommand = ctx.Args[0]
	}

	switch subcommand {
	case "", "tables":
		return dbTables(ctx)
	case "schema":
		return dbSchema(ctx)
	case "query", "sql", "q":
		return dbQuery(ctx)
	case "count":
		return dbCount(ctx)
	case "dump":
		return dbDump(ctx)
	default:
		fmt.Printf("%sUnknown subcommand: %s%s\n", ui.Red, subcommand, ui.Reset)
		printDBUsage()
		return nil
	}
}

func printDBUsage() {
	fmt.Printf("%sUsage:%s puchipix-cli db <subcommand> [args]\n", ui.Bold, ui.Reset)
	fmt.Printf("  %stables%s               List all database tables with row counts\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sschema <table>%s       Show CREATE TABLE statement\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %squery <sql>%s          Execute a read-only SQL query\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %scount <table>%s        Count rows in a table\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sdump <table> [limit]%s Dump table data (default limit 20)\n", ui.Cyan, ui.Reset)
	fmt.Println()
	fmt.Printf("  %s--db-path <path>%s    Database file path (default ./data/puchipix.db)\n", ui.Dim, ui.Reset)
}

// getDB returns the database connection, opening it if necessary.
// The connection is opened lazily so non-db commands don't incur overhead.
func getDB(ctx CommandContext) (*sql.DB, error) {
	if ctx.DB != nil {
		return ctx.DB, nil
	}

	// DB path is passed via environment variable or --db-path flag,
	// which main.go captures and opens before calling Execute.
	return nil, fmt.Errorf("database connection not available; use --db-path <path> or set PUCHIPIX_DB_PATH")
}

// dbTables lists all user tables with their row counts.
func dbTables(ctx CommandContext) error {
	db, err := getDB(ctx)
	if err != nil {
		return err
	}

	// Query sqlite_master for all user tables, excluding internal tables.
	query := `
		SELECT name FROM sqlite_master
		WHERE type='table'
		  AND name NOT LIKE 'sqlite_%'
		  AND name NOT LIKE '_litestream_%'
		ORDER BY name
	`
	rows, err := db.QueryContext(ctx.Ctx, query)
	if err != nil {
		return fmt.Errorf("query tables: %w", err)
	}

	type tableInfo struct {
		Name  string `json:"name"`
		Count int64  `json:"count"`
	}
	var tables []tableInfo

	// Collect all table names first to avoid nested queries
	// (would deadlock with MaxOpenConns=1).
	var tableNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		tableNames = append(tableNames, name)
	}
	rows.Close()

	// Now query counts sequentially.
	for _, name := range tableNames {
		var count int64
		countQuery := fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", name)
		_ = db.QueryRowContext(ctx.Ctx, countQuery).Scan(&count)
		tables = append(tables, tableInfo{Name: name, Count: count})
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(tables, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Database Tables (%d)", len(tables)))
	for _, t := range tables {
		fmt.Printf("  %-32s %s%d rows%s\n", ui.Cyan+t.Name+ui.Reset, ui.Dim, t.Count, ui.Reset)
	}

	return nil
}

// dbSchema shows the CREATE TABLE statement for a given table.
func dbSchema(ctx CommandContext) error {
	db, err := getDB(ctx)
	if err != nil {
		return err
	}

	args := ctx.Args
	if len(args) > 0 && args[0] == "schema" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli db schema <tableName>%s\n", ui.Red, ui.Reset)
		return nil
	}

	tableName := args[0]

	var createSQL string
	query := "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
	err = db.QueryRowContext(ctx.Ctx, query, tableName).Scan(&createSQL)
	if err != nil {
		if err == sql.ErrNoRows {
			fmt.Printf("%sTable '%s' not found%s\n", ui.Red, tableName, ui.Reset)
			return nil
		}
		return fmt.Errorf("query schema: %w", err)
	}

	if ctx.JSON {
		result := map[string]string{"table": tableName, "schema": createSQL}
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Schema: %s", tableName))
	// Pretty-print the SQL with indentation.
	formatted := formatSQL(createSQL)
	fmt.Println(formatted)

	return nil
}

// dbQuery executes a read-only SQL query and displays the results.
// Only SELECT statements are allowed to prevent accidental writes.
func dbQuery(ctx CommandContext) error {
	db, err := getDB(ctx)
	if err != nil {
		return err
	}

	args := ctx.Args
	if len(args) > 0 && (args[0] == "query" || args[0] == "sql" || args[0] == "q") {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli db query <SQL>%s\n", ui.Red, ui.Reset)
		fmt.Printf("%sNote: Only SELECT queries are allowed (read-only mode)%s\n", ui.Dim, ui.Reset)
		return nil
	}

	sqlQuery := strings.Join(args, " ")

	// Safety check: only allow SELECT queries.
	trimmed := strings.TrimSpace(strings.ToUpper(sqlQuery))
	if !strings.HasPrefix(trimmed, "SELECT") && !strings.HasPrefix(trimmed, "PRAGMA") && !strings.HasPrefix(trimmed, "EXPLAIN") {
		fmt.Printf("%sError: Only SELECT, PRAGMA, and EXPLAIN queries are allowed%s\n", ui.Red, ui.Reset)
		fmt.Printf("%sThis is a read-only interface to prevent accidental writes.%s\n", ui.Dim, ui.Reset)
		return nil
	}

	rows, err := db.QueryContext(ctx.Ctx, sqlQuery)
	if err != nil {
		return fmt.Errorf("execute query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("get columns: %w", err)
	}

	// Read all rows.
	var results []map[string]any
	for rows.Next() {
		columns := make([]any, len(cols))
		columnPtrs := make([]any, len(cols))
		for i := range columns {
			columnPtrs[i] = &columns[i]
		}
		if err := rows.Scan(columnPtrs...); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			val := columns[i]
			// Convert []byte (SQLite returns text as []byte) to string.
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(results, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	// Render as table.
	renderTable(cols, results)
	return nil
}

// dbCount shows the row count for a specific table.
func dbCount(ctx CommandContext) error {
	db, err := getDB(ctx)
	if err != nil {
		return err
	}

	args := ctx.Args
	if len(args) > 0 && args[0] == "count" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli db count <tableName>%s\n", ui.Red, ui.Reset)
		return nil
	}

	tableName := args[0]

	var count int64
	query := fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", tableName)
	err = db.QueryRowContext(ctx.Ctx, query).Scan(&count)
	if err != nil {
		return fmt.Errorf("count rows: %w", err)
	}

	if ctx.JSON {
		result := map[string]any{"table": tableName, "count": count}
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Table: %s", tableName))
	fmt.Printf("  %sRow count%s: %s%d%s\n", ui.Bold, ui.Reset, ui.Cyan, count, ui.Reset)

	return nil
}

// dbDump dumps table data with an optional limit.
func dbDump(ctx CommandContext) error {
	db, err := getDB(ctx)
	if err != nil {
		return err
	}

	args := ctx.Args
	if len(args) > 0 && args[0] == "dump" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli db dump <tableName> [limit]%s\n", ui.Red, ui.Reset)
		return nil
	}

	tableName := args[0]
	limit := 20
	if len(args) > 1 {
		var n int
		if _, err := fmt.Sscanf(args[1], "%d", &n); err == nil && n > 0 {
			limit = n
		}
	}

	query := fmt.Sprintf("SELECT * FROM \"%s\" LIMIT %d", tableName, limit)
	rows, err := db.QueryContext(ctx.Ctx, query)
	if err != nil {
		return fmt.Errorf("dump table: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("get columns: %w", err)
	}

	var results []map[string]any
	for rows.Next() {
		columns := make([]any, len(cols))
		columnPtrs := make([]any, len(cols))
		for i := range columns {
			columnPtrs[i] = &columns[i]
		}
		if err := rows.Scan(columnPtrs...); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			val := columns[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(results, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Dump: %s (limit %d, showing %d)", tableName, limit, len(results)))
	if len(results) == 0 {
		fmt.Printf("%s  (empty table)%s\n", ui.Dim, ui.Reset)
		return nil
	}
	renderTable(cols, results)
	return nil
}

// renderTable prints results in a formatted text table.
func renderTable(cols []string, rows []map[string]any) {
	if len(rows) == 0 {
		fmt.Printf("%s  (no results)%s\n", ui.Dim, ui.Reset)
		return
	}

	// Calculate column widths.
	widths := make([]int, len(cols))
	for i, col := range cols {
		widths[i] = len(col)
	}
	for _, row := range rows {
		for i, col := range cols {
			val := fmt.Sprintf("%v", row[col])
			if len(val) > widths[i] {
				widths[i] = len(val)
			}
			// Cap column width at 40.
			if widths[i] > 40 {
				widths[i] = 40
			}
		}
	}

	// Print header.
	header := "  "
	sep := "  "
	for i, col := range cols {
		header += fmt.Sprintf("%-*s", widths[i], col)
		sep += strings.Repeat("-", widths[i])
		if i < len(cols)-1 {
			header += " | "
			sep += "-+-"
		}
	}
	fmt.Printf("%s%s%s\n", ui.Bold, header, ui.Reset)
	fmt.Printf("%s%s%s\n", ui.Dim, sep, ui.Reset)

	// Print rows.
	for _, row := range rows {
		line := "  "
		for i, col := range cols {
			val := fmt.Sprintf("%v", row[col])
			if len(val) > 40 {
				val = val[:37] + "..."
			}
			line += fmt.Sprintf("%-*s", widths[i], val)
			if i < len(cols)-1 {
				line += " | "
			}
		}
		fmt.Println(line)
	}
	fmt.Printf("%s  %d row(s)%s\n\n", ui.Dim, len(rows), ui.Reset)
}

// formatSQL adds basic indentation to a CREATE TABLE statement.
func formatSQL(sql string) string {
	sql = strings.ReplaceAll(sql, "CREATE TABLE", "\nCREATE TABLE")
	sql = strings.ReplaceAll(sql, ", (", ",\n  (")
	sql = strings.ReplaceAll(sql, ",", ",\n  ")
	sql = strings.ReplaceAll(sql, " (", "\n  (")
	// Clean up excessive newlines.
	lines := strings.Split(sql, "\n")
	var result []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			result = append(result, "  "+trimmed)
		}
	}
	return strings.Join(result, "\n")
}

// openDB opens a SQLite database at the given path with read-only settings.
// It returns a *sql.DB configured for safe CLI querying.
func openDB(dbPath string) (*sql.DB, error) {
	// Use URI mode to enable read-only access.
	uri := fmt.Sprintf("file:%s?mode=ro", dbPath)
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// Set conservative connection limits.
	db.SetMaxOpenConns(1)
	return db, nil
}

// ensureDBPath checks if the database file exists and returns an error if not.
func ensureDBPath(dbPath string) error {
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("database file not found: %s", dbPath)
		}
		return fmt.Errorf("access database file: %w", err)
	}
	return nil
}
