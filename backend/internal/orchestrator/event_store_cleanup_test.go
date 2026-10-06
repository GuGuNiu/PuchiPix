package orchestrator

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// seedDAGRows inserts events and a snapshot for one DAG, plus rows for a
// second DAG that must survive the first one's removal.
func seedDAGRows(t *testing.T, database *db.Database, dagID string, at time.Time) {
	t.Helper()
	ctx := context.Background()
	// seq is globally UNIQUE in dag_events, so each seeded row takes the next
	// value rather than a fixed offset.
	for i := 0; i < 3; i++ {
		var seq int64
		if err := database.QueryRow(ctx,
			"SELECT COALESCE(MAX(seq), 0) + 1 FROM "+db.TableDagEvent).Scan(&seq); err != nil {
			t.Fatalf("next seq: %v", err)
		}
		if _, err := database.Exec(ctx,
			"INSERT INTO "+db.TableDagEvent+" (seq, dag_id, node_id, type, payload, timestamp) VALUES (?,?,?,?,?,?)",
			seq, dagID, "node-1", "dag:nodeStateChanged", "{}", at); err != nil {
			t.Fatalf("seed event: %v", err)
		}
	}
	var lastSeq int64
	if err := database.QueryRow(ctx,
		"SELECT COALESCE(MAX(seq), 0) FROM "+db.TableDagEvent).Scan(&lastSeq); err != nil {
		t.Fatalf("last seq: %v", err)
	}
	if _, err := database.Exec(ctx,
		"INSERT INTO "+db.TableDagSnapshot+" (dag_id, state, last_seq, created_at) VALUES (?,?,?,?)",
		dagID, "{}", lastSeq, at); err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}
}

func countRows(t *testing.T, database *db.Database, table, dagID string) int {
	t.Helper()
	var n int
	if err := database.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM "+table+" WHERE dag_id = ?", dagID).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func newTestEventStore(t *testing.T) *EventStore {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "events.db"), infra.NewLogger("EventStoreTest"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(database.Close)
	return NewEventStore(database, infra.NewEventBus())
}

// TestDeleteDagDataRemovesBothTables covers the leak where deleting a DAG
// left its event history and snapshot behind forever.
func TestDeleteDagDataRemovesBothTables(t *testing.T) {
	store := newTestEventStore(t)
	database := store.db
	ctx := context.Background()

	seedDAGRows(t, database, "DAGKEEP", time.Now())
	seedDAGRows(t, database, "DAGGONE", time.Now())

	store.DeleteDagData(ctx, "DAGGONE")

	if n := countRows(t, database, db.TableDagEvent, "DAGGONE"); n != 0 {
		t.Fatalf("expected 0 events for deleted DAG, got %d", n)
	}
	if n := countRows(t, database, db.TableDagSnapshot, "DAGGONE"); n != 0 {
		t.Fatalf("expected 0 snapshots for deleted DAG, got %d", n)
	}
	// Another DAG's rows must be untouched.
	if n := countRows(t, database, db.TableDagEvent, "DAGKEEP"); n != 3 {
		t.Fatalf("deleted DAG removal affected another DAG: got %d events, want 3", n)
	}
	if n := countRows(t, database, db.TableDagSnapshot, "DAGKEEP"); n != 1 {
		t.Fatalf("deleted DAG removal affected another DAG snapshot: got %d, want 1", n)
	}
}

// TestDeleteDagDataIsIdempotentAndSafe guards the empty/unknown cases the
// async call site can produce.
func TestDeleteDagDataIsIdempotentAndSafe(t *testing.T) {
	store := newTestEventStore(t)
	ctx := context.Background()

	store.DeleteDagData(ctx, "NEVER_EXISTED") // must not panic or error
	seedDAGRows(t, store.db, "DAGONE", time.Now())
	store.DeleteDagData(ctx, "DAGONE")
	store.DeleteDagData(ctx, "DAGONE") // second call must be a no-op
	store.DeleteDagData(ctx, "")       // empty id must be ignored

	if n := countRows(t, store.db, db.TableDagEvent, "DAGONE"); n != 0 {
		t.Fatalf("expected 0 events after repeated deletes, got %d", n)
	}
}

// TestPruneExpiredRemovesOldRowsOnly verifies the retention sweep clears
// orphans (e.g. left by a restart) without touching recent audit rows.
func TestPruneExpiredRemovesOldRowsOnly(t *testing.T) {
	store := newTestEventStore(t)
	database := store.db
	ctx := context.Background()

	old := time.Now().Add(-30 * 24 * time.Hour)
	recent := time.Now().Add(-1 * time.Hour)

	seedDAGRows(t, database, "DAGOLD", old)
	seedDAGRows(t, database, "DAGNEW", recent)

	store.PruneExpired(ctx, 7*24*time.Hour)

	if n := countRows(t, database, db.TableDagEvent, "DAGOLD"); n != 0 {
		t.Fatalf("expired events survived prune: got %d, want 0", n)
	}
	if n := countRows(t, database, db.TableDagSnapshot, "DAGOLD"); n != 0 {
		t.Fatalf("expired snapshots survived prune: got %d, want 0", n)
	}
	if n := countRows(t, database, db.TableDagEvent, "DAGNEW"); n != 3 {
		t.Fatalf("prune removed recent events: got %d, want 3", n)
	}
	if n := countRows(t, database, db.TableDagSnapshot, "DAGNEW"); n != 1 {
		t.Fatalf("prune removed recent snapshot: got %d, want 1", n)
	}
}

// TestPruneExpiredZeroRetentionUsesDefault confirms retention<=0 selects the
// package default rather than pruning everything.
func TestPruneExpiredZeroRetentionUsesDefault(t *testing.T) {
	store := newTestEventStore(t)
	database := store.db
	ctx := context.Background()

	seedDAGRows(t, database, "DAGRECENT", time.Now().Add(-1*time.Hour))
	store.PruneExpired(ctx, 0) // default retention (7 days)

	if n := countRows(t, database, db.TableDagEvent, "DAGRECENT"); n != 3 {
		t.Fatalf("default retention pruned recent rows: got %d, want 3", n)
	}
}

// TestNilDatabaseIsNoOp ensures the pruning and delete helpers tolerate a
// store constructed without a database (the in-memory test configuration).
func TestNilDatabaseIsNoOp(t *testing.T) {
	store := NewEventStore(nil, nil)
	ctx := context.Background()

	store.DeleteDagData(ctx, "ANY")
	store.PruneExpired(ctx, 0)
	store.StartRetentionPruning(ctx, 0)
}
