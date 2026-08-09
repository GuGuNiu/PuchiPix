package orchestrator_test

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
)

// newTestDatabase opens a throwaway SQLite database in the OS temp dir.
func newTestDatabase(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "eventstore-test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("TestDB"))
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return database
}

// TestEventStoreRestoreRoundTrip is a regression test for the
// "unsupported Scan, storing driver.Value type string into type
// *time.Time" bug. The modernc sqlite driver encodes time.Time
// arguments as Go time.Time.String() TEXT; scanning that into a
// *time.Time aborted RestoreFromSnapshot, so snapshot recovery never
// ran. This test exercises the full Snapshot -> RestoreFromSnapshot
// round trip against a real database.
func TestEventStoreRestoreRoundTrip(t *testing.T) {
	database := newTestDatabase(t)
	es := orchestrator.NewEventStore(database, nil)
	require.NoError(t, es.Initialize(context.Background()))

	snap := orchestrator.DagSnapshot{
		DagID:      "dag-1",
		Definition: orchestrator.DagDefinition{ID: "dag-1"},
		NodeStates: []orchestrator.NodeSnapshot{{NodeID: "node-1"}},
		CreatedAt:  time.Now().Add(-time.Minute),
	}
	require.NoError(t, es.Snapshot(context.Background(), []orchestrator.DagSnapshot{snap}))

	before := time.Now()
	require.NoError(t, es.Append(context.Background(), orchestrator.DagEvent{
		Type:   "dag:nodeStateChanged",
		DagID:  "dag-1",
		NodeID: "node-1",
	}))
	after := time.Now()

	var restored []orchestrator.DagSnapshot
	err := es.RestoreFromSnapshot(context.Background(),
		func(s orchestrator.DagSnapshot) error {
			restored = append(restored, s)
			return nil
		},
		func(event orchestrator.DagEvent) error { return nil },
	)
	require.NoError(t, err)
	require.Len(t, restored, 1)
	assert.Equal(t, "dag-1", restored[0].DagID)

	// The event timestamp column must be readable after the restore
	// path fix (second scan site, previously hidden by the first error).
	events, err := es.GetDagEvents(context.Background(), "dag-1")
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.False(t, events[0].Timestamp.IsZero(), "event timestamp must parse from driver TEXT encoding")
	assert.True(t, events[0].Timestamp.After(before.Add(-time.Second)))
	assert.True(t, events[0].Timestamp.Before(after.Add(time.Second)))
}

// TestEventStoreReplayReadsDriverTimestamp verifies Replay can read
// timestamps written by the driver's time.Time encoding.
func TestEventStoreReplayReadsDriverTimestamp(t *testing.T) {
	database := newTestDatabase(t)
	es := orchestrator.NewEventStore(database, nil)
	require.NoError(t, es.Initialize(context.Background()))

	require.NoError(t, es.Append(context.Background(), orchestrator.DagEvent{
		Type:   "dag:nodeCompleted",
		DagID:  "dag-2",
		NodeID: "node-2",
	}))

	events, err := es.Replay(context.Background(), 0, "dag-2")
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.False(t, events[0].Timestamp.IsZero(), "replayed event timestamp must parse from TEXT")
}

// TestEventStoreRFC3339Timestamp verifies rows written with an explicit
// RFC3339 string timestamp (the parse fallback branch) still parse.
func TestEventStoreRFC3339Timestamp(t *testing.T) {
	database := newTestDatabase(t)
	es := orchestrator.NewEventStore(database, nil)
	require.NoError(t, es.Initialize(context.Background()))

	ctx := context.Background()
	_, err := database.Exec(ctx,
		"INSERT INTO "+db.TableDagEvent+" (seq, dag_id, node_id, type, payload, timestamp) VALUES (1, 'dag-3', 'node-1', 'dag:created', '{}', ?)",
		"2026-01-02T15:04:05.123Z",
	)
	require.NoError(t, err)

	events, err := es.GetDagEvents(ctx, "dag-3")
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, 2026, events[0].Timestamp.Year())
}

// TestEventStoreReplayContiguity locks the fast-path boundary of
// Replay: the in-memory buffer is returned ONLY when its first entry
// is exactly fromSeq+1 (contiguous tail). With a nil db and a fromSeq
// that falls inside the truncated range, Replay must return the
// in-memory subset without a database round trip — and crucially, the
// == boundary means a fromSeq one below the head still returns the
// full tail, while a fromSeq deeper in the past would have gone to the
// DB (impossible here since db is nil).
func TestEventStoreReplayContiguity(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	for i := 0; i < 5; i++ {
		require.NoError(t, es.Append(context.Background(), orchestrator.DagEvent{
			Type:  "dag:created",
			DagID: "dag-c",
		}))
	}

	// fromSeq=0 -> first in-memory seq is 1 == 0+1: full tail returned.
	events, err := es.Replay(context.Background(), 0, "dag-c")
	require.NoError(t, err)
	assert.Len(t, events, 5, "contiguous tail from seq 1 must be served from memory")

	// fromSeq=2 -> first in-memory seq is 3 == 2+1: tail 3..5 returned.
	events, err = es.Replay(context.Background(), 2, "dag-c")
	require.NoError(t, err)
	assert.Len(t, events, 3)

	// fromSeq=5 -> nothing after it in memory: empty, no DB needed.
	events, err = es.Replay(context.Background(), 5, "dag-c")
	require.NoError(t, err)
	assert.Empty(t, events)
}
