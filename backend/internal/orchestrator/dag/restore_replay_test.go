package dag_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/db"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// newTestDatabase opens a throwaway SQLite database for orchestrator
// integration tests.
func newTestDatabase(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "orchestrator-restore-test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("TestDB"))
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return database
}

// TestRestoreReplayDeadlock is a regression test for two coupled bugs
// that only surfaced once snapshot restore actually ran:
//
//  1. EventStore scanned the TEXT created_at column into a *time.Time,
//     aborting restore before any event replay happened.
//  2. applyEvent leaked dag.mu on the "node not in this DAG" path
//     (and inside the nodeStateChanged payload guard via a bare
//     `continue`), so any later access to the affected DAG blocked
//     forever.
//
// To make the leak deterministic (map iteration order is random), a
// "ghost" event is inserted straight into dag_events: it belongs to
// dag-A (so Replay picks it up) but references a NodeID that exists in
// no restored DAG, forcing applyEvent down the !exists path. With the
// leaked mutex, ReactivateReadyNodes (the exact call main.go makes
// right after restore) blocks forever; the test timeout surfaces a
// goroutine dump if it regresses.
func TestRestoreReplayDeadlock(t *testing.T) {
	database := newTestDatabase(t)

	// First "process": persist a snapshot for dag-A.
	es1 := orchestrator.NewEventStore(database, nil)
	es1.StartAsyncWriter()
	o1 := dag.NewDagOrchestrator(es1, &mockSlotPool{})
	require.NoError(t, o1.Initialize(context.Background()))

	_, err := o1.SubmitDag(context.Background(), newSimpleDagDef("dag-A"))
	require.NoError(t, err)

	// Flush BEFORE the snapshot: events are persisted asynchronously,
	// and CreateSnapshot records last_seq from the in-memory counter.
	es1.Flush()
	require.NoError(t, o1.CreateSnapshot(context.Background()))
	lastSeq := es1.CurrentSequence()

	// Insert a "ghost" event after the snapshot: dag_id matches the
	// restored DAG (so Replay returns it) but node_id belongs to no
	// restored node (so applyEvent hits the !exists leak path).
	_, err = database.Exec(context.Background(),
		"INSERT INTO "+db.TableDagEvent+" (seq, dag_id, node_id, type, payload, timestamp) VALUES (?, 'dag-A', 'ghost-node', 'dag:nodeStateChanged', '{}', ?)",
		lastSeq+1, time.Now().Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Second "process": fresh EventStore + orchestrator on the same DB.
	// Restore must complete and the restored DAG must remain usable
	// (no leaked dag.mu).
	es2 := orchestrator.NewEventStore(database, nil)
	o2 := dag.NewDagOrchestrator(es2, &mockSlotPool{})
	require.NoError(t, o2.Initialize(context.Background()))

	done := make(chan struct{})
	go func() {
		// This mirrors the server startup sequence right after restore
		// (main.go: ReactivateReadyNodes). It locks the restored DAG's
		// mutex, so a leaked dag.mu from applyEvent blocks forever.
		o2.ReactivateReadyNodes(context.Background())
		close(done)
	}()

	select {
	case <-done:
		// restored DAG is reachable; replay finished without deadlock
	case <-time.After(5 * time.Second):
		t.Fatal("ReactivateReadyNodes blocked after restore: applyEvent likely leaked dag.mu (see goroutine dump)")
	}

	status := o2.GetDagStatus("dag-A")
	require.NotNil(t, status)
	assert.Equal(t, "dag-A", status.DagID)
}
