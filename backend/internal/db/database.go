package db

import (
	"context"
	"database/sql"
)

// Store abstracts the database operations consumed by API handlers,
// enabling test doubles without a live SQLite connection.
type Store interface {
	Ping(ctx context.Context) error
	Exec(ctx context.Context, sql string, args ...any) (sql.Result, error)
	QueryRow(ctx context.Context, sql string, args ...any) *sql.Row
	Query(ctx context.Context, sql string, args ...any) (*sql.Rows, error)
}
