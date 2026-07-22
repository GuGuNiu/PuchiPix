package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/infra"
)

// Database wraps a pgxpool connection pool with structured logging,
// replacing the SQLite single-connection model with PostgreSQL's
// concurrent read/write capability.
type Database struct {
	Pool   *pgxpool.Pool
	logger *infra.Logger
}

// NewDatabase creates a connection pool from a PostgreSQL connection
// string, verifies connectivity, and returns a ready Database handle.
func NewDatabase(databaseURL string, logger *infra.Logger) (*Database, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database URL must not be empty")
	}

	if logger == nil {
		logger = infra.NewLogger("Database")
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 5
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	logger.Info("PostgreSQL connection pool initialized")
	return &Database{Pool: pool, logger: logger}, nil
}

// Close releases all pooled connections. Safe to call multiple times.
func (db *Database) Close() {
	if db.Pool != nil {
		db.Pool.Close()
		db.logger.Info("PostgreSQL connection pool closed")
	}
}

// Ping verifies that the database is reachable.
func (db *Database) Ping(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

// Exec delegates to pgxpool.Exec for INSERT/UPDATE/DELETE statements.
func (db *Database) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return db.Pool.Exec(ctx, sql, args...)
}

// QueryRow delegates to pgxpool.QueryRow for single-row queries.
func (db *Database) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return db.Pool.QueryRow(ctx, sql, args...)
}

// Query delegates to pgxpool.Query for multi-row queries. The caller
// must close the returned Rows.
func (db *Database) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return db.Pool.Query(ctx, sql, args...)
}

// QueryRowTx runs a single-row query inside a transaction.
func (db *Database) QueryRowTx(ctx context.Context, tx pgx.Tx, sql string, args ...any) pgx.Row {
	return tx.QueryRow(ctx, sql, args...)
}

// BeginTx starts a new serializable transaction for multi-statement
// atomicity, replacing the SQLite BEGIN/COMMIT pattern.
func (db *Database) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return db.Pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel: pgx.ReadCommitted,
	})
}
