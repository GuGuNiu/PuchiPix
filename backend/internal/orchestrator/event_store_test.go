package orchestrator_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/infra"
	"backend/internal/orchestrator"
)

// TestEventStoreAppendAndSequence verifies that Append assigns
// monotonically increasing sequence numbers and stores events in the
// in-memory ring buffer, enabling replay without a database.
func TestEventStoreAppendAndSequence(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	assert.Equal(t, int64(0), es.CurrentSequence())

	err := es.Append(context.Background(), orchestrator.DagEvent{
		Type:  "dag:created",
		DagID: "dag-1",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), es.CurrentSequence())

	err = es.Append(context.Background(), orchestrator.DagEvent{
		Type:  "dag:nodeStateChanged",
		DagID: "dag-1",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2), es.CurrentSequence())
}

// TestEventStoreAppendEmitsEventBus verifies that Append fans out events
// to the EventBus, allowing real-time subscribers to react to DAG state
// changes without polling the event store.
func TestEventStoreAppendEmitsEventBus(t *testing.T) {
	bus := infra.NewEventBus()
	es := orchestrator.NewEventStore(nil, bus)

	var received []string
	bus.On("dag:created", func(payload any) {
		event := payload.(orchestrator.DagEvent)
		received = append(received, event.DagID)
	})

	err := es.Append(context.Background(), orchestrator.DagEvent{
		Type:  "dag:created",
		DagID: "dag-1",
	})
	require.NoError(t, err)

	assert.Equal(t, []string{"dag-1"}, received)
}

// TestEventStoreAppendAutoTimestamp verifies that events without a
// timestamp get one assigned automatically, preventing zero-time events
// from confusing downstream consumers.
func TestEventStoreAppendAutoTimestamp(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	before := time.Now()
	err := es.Append(context.Background(), orchestrator.DagEvent{
		Type:  "dag:created",
		DagID: "dag-1",
	})
	require.NoError(t, err)
	after := time.Now()

	events, err := es.GetDagEvents(context.Background(), "dag-1")
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.False(t, events[0].Timestamp.IsZero(), "timestamp should be auto-assigned")
	assert.True(t, events[0].Timestamp.After(before.Add(-time.Millisecond)))
	assert.True(t, events[0].Timestamp.Before(after.Add(time.Millisecond)))
}

// TestEventStoreGetDagEvents verifies that GetDagEvents returns only
// events for the specified DAG, filtered from the in-memory log.
func TestEventStoreGetDagEvents(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:created", DagID: "dag-1"})
	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:created", DagID: "dag-2"})
	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:nodeStateChanged", DagID: "dag-1", NodeID: "node-1"})

	events, err := es.GetDagEvents(context.Background(), "dag-1")
	require.NoError(t, err)
	assert.Len(t, events, 2)

	events2, err := es.GetDagEvents(context.Background(), "dag-2")
	require.NoError(t, err)
	assert.Len(t, events2, 1)
}

// TestEventStoreGetDagEventsEmpty verifies that querying a non-existent
// DAG returns an empty slice rather than an error.
func TestEventStoreGetDagEventsEmpty(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	events, err := es.GetDagEvents(context.Background(), "nonexistent")
	require.NoError(t, err)
	assert.Empty(t, events)
}

// TestEventStoreReplay verifies that Replay returns events with sequence
// numbers greater than the given offset, optionally filtered by DAG ID.
func TestEventStoreReplay(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:created", DagID: "dag-1"})
	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:created", DagID: "dag-2"})
	es.Append(context.Background(), orchestrator.DagEvent{Type: "dag:nodeStateChanged", DagID: "dag-1", NodeID: "node-1"})

	// Replay all events from seq 0
	events, err := es.Replay(context.Background(), 0, "")
	require.NoError(t, err)
	assert.Len(t, events, 3)

	// Replay from seq 1 (should get events 2 and 3)
	events, err = es.Replay(context.Background(), 1, "")
	require.NoError(t, err)
	assert.Len(t, events, 2)

	// Replay filtered by DAG
	events, err = es.Replay(context.Background(), 0, "dag-1")
	require.NoError(t, err)
	assert.Len(t, events, 2)
}

// TestEventStoreSnapshotNilDB verifies that Snapshot is a no-op when
// no database is connected, preventing nil pointer dereferences in
// test environments.
func TestEventStoreSnapshotNilDB(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	err := es.Snapshot(context.Background(), []orchestrator.DagSnapshot{
		{DagID: "dag-1"},
	})
	assert.NoError(t, err)
}

// TestEventStoreSnapshotEmpty verifies that Snapshot with an empty
// slice is a no-op regardless of database connection.
func TestEventStoreSnapshotEmpty(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	err := es.Snapshot(context.Background(), []orchestrator.DagSnapshot{})
	assert.NoError(t, err)
}

// TestEventStoreInitializeNilDB verifies that Initialize is a no-op
// when no database is connected, starting the sequence from 0.
func TestEventStoreInitializeNilDB(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	err := es.Initialize(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(0), es.CurrentSequence())
}

// TestEventStoreRestoreFromSnapshotNilDB verifies that RestoreFromSnapshot
// is a no-op when no database is connected, returning nil immediately.
func TestEventStoreRestoreFromSnapshotNilDB(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	restoreCalled := false
	err := es.RestoreFromSnapshot(context.Background(),
		func(snap orchestrator.DagSnapshot) error {
			restoreCalled = true
			return nil
		},
		func(event orchestrator.DagEvent) error { return nil },
	)
	require.NoError(t, err)
	assert.False(t, restoreCalled, "restoreDag should not be called with nil db")
}

// TestEventStoreSetSnapshotProvider verifies that the snapshot provider
// can be set and retrieved through the auto-snapshot mechanism by
// appending enough events to trigger the snapshot interval.
func TestEventStoreSetSnapshotProvider(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)

	var providerCalled atomic.Bool
	es.SetSnapshotProvider(func() []orchestrator.DagSnapshot {
		providerCalled.Store(true)
		return nil
	})

	// Append events up to the snapshot interval (100)
	for i := 0; i < 100; i++ {
		err := es.Append(context.Background(), orchestrator.DagEvent{
			Type:  "dag:created",
			DagID: "dag-1",
		})
		require.NoError(t, err)
	}

	// The auto-snapshot runs in a goroutine, so wait briefly
	time.Sleep(100 * time.Millisecond)
	assert.True(t, providerCalled.Load(), "snapshot provider should be called after 100 events")
}
