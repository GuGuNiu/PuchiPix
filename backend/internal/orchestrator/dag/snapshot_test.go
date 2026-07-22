package dag_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// TestSnapshotCacheGetDagSnapshotNotFound verifies that querying a
// non-existent DAG from the cache returns nil rather than panicking.
func TestSnapshotCacheGetDagSnapshotNotFound(t *testing.T) {
	cache := dag.NewSnapshotCache()

	snap := cache.GetDagSnapshot("nonexistent")
	assert.Nil(t, snap)
}

// TestSnapshotCacheGetAgeBeforeUpdate verifies that GetAge returns -1
// when the cache has never been updated, allowing consumers to detect
// stale or uninitialized cache state.
func TestSnapshotCacheGetAgeBeforeUpdate(t *testing.T) {
	cache := dag.NewSnapshotCache()
	assert.Equal(t, int64(-1), cache.GetAge())
}

// TestSnapshotCacheGetAgeAfterUpdate verifies that GetAge returns a
// non-negative value after the cache has been updated, indicating the
// cache is live and tracking freshness.
func TestSnapshotCacheGetAgeAfterUpdate(t *testing.T) {
	cache := dag.NewSnapshotCache()
	cache.Update(dag.SnapshotSyncPayload{
		Dags:       []orchestrator.DagSnapshot{{DagID: "dag-1"}},
		DagStats:   orchestrator.DagOrchestratorStats{TotalDags: 1},
		CurrentSeq: 1,
	})

	age := cache.GetAge()
	assert.GreaterOrEqual(t, age, int64(0), "age should be non-negative after update")
}

// TestSnapshotCacheGetAllDagSnapshotsEmpty verifies that an empty cache
// returns an empty (non-nil) slice, preventing nil-iteration panics in
// consumers.
func TestSnapshotCacheGetAllDagSnapshotsEmpty(t *testing.T) {
	cache := dag.NewSnapshotCache()
	all := cache.GetAllDagSnapshots()
	assert.NotNil(t, all)
	assert.Empty(t, all)
}

// TestSnapshotCacheDefaultValues verifies that a fresh cache returns
// zero-value statistics and sequence numbers.
func TestSnapshotCacheDefaultValues(t *testing.T) {
	cache := dag.NewSnapshotCache()

	stats := cache.GetDagStats()
	assert.Equal(t, 0, stats.TotalDags)
	assert.Equal(t, 0, stats.ActiveDags)
	assert.Equal(t, 0, stats.TotalNodes)

	assert.Equal(t, int64(0), cache.GetCurrentSeq())
}

// TestSnapshotCacheMultipleUpdates verifies that successive updates
// replace previous data entirely, preventing stale DAG entries from
// accumulating in the cache.
func TestSnapshotCacheMultipleUpdates(t *testing.T) {
	cache := dag.NewSnapshotCache()

	cache.Update(dag.SnapshotSyncPayload{
		Dags: []orchestrator.DagSnapshot{
			{DagID: "dag-1"},
			{DagID: "dag-2"},
			{DagID: "dag-3"},
		},
		DagStats:   orchestrator.DagOrchestratorStats{TotalDags: 3},
		CurrentSeq: 50,
	})

	cache.Update(dag.SnapshotSyncPayload{
		Dags: []orchestrator.DagSnapshot{
			{DagID: "dag-1"},
		},
		DagStats:   orchestrator.DagOrchestratorStats{TotalDags: 1},
		CurrentSeq: 100,
	})

	all := cache.GetAllDagSnapshots()
	assert.Len(t, all, 1, "second update should replace all previous entries")

	snap := cache.GetDagSnapshot("dag-2")
	assert.Nil(t, snap, "dag-2 should no longer exist after second update")

	stats := cache.GetDagStats()
	assert.Equal(t, 1, stats.TotalDags)
	assert.Equal(t, int64(100), cache.GetCurrentSeq())
}

// TestSnapshotCacheClearResetsValues verifies that Clear resets all
// cached values to their zero state, including stats and sequence.
func TestSnapshotCacheClearResetsValues(t *testing.T) {
	cache := dag.NewSnapshotCache()
	cache.Update(dag.SnapshotSyncPayload{
		Dags:       []orchestrator.DagSnapshot{{DagID: "dag-1"}},
		DagStats:   orchestrator.DagOrchestratorStats{TotalDags: 1, ActiveDags: 1, TotalNodes: 2},
		CurrentSeq: 42,
	})

	cache.Clear()

	assert.False(t, cache.IsAvailable())
	assert.Equal(t, int64(0), cache.GetCurrentSeq())
	assert.Equal(t, int64(-1), cache.GetAge())

	stats := cache.GetDagStats()
	assert.Equal(t, 0, stats.TotalDags)
	assert.Equal(t, 0, stats.TotalNodes)

	all := cache.GetAllDagSnapshots()
	assert.Empty(t, all)
}

// TestSnapshotCacheIsAvailableAfterUpdate verifies that IsAvailable
// transitions from false to true after the first update.
func TestSnapshotCacheIsAvailableAfterUpdate(t *testing.T) {
	cache := dag.NewSnapshotCache()
	assert.False(t, cache.IsAvailable())

	cache.Update(dag.SnapshotSyncPayload{
		Dags: []orchestrator.DagSnapshot{{DagID: "dag-1"}},
	})
	assert.True(t, cache.IsAvailable())
}

// TestSnapshotCacheGetDagStatsAfterUpdate verifies that the cached stats
// match what was provided in the update payload.
func TestSnapshotCacheGetDagStatsAfterUpdate(t *testing.T) {
	cache := dag.NewSnapshotCache()
	expected := orchestrator.DagOrchestratorStats{TotalDags: 5, ActiveDags: 3, TotalNodes: 12}

	cache.Update(dag.SnapshotSyncPayload{
		Dags:     []orchestrator.DagSnapshot{{DagID: "dag-1"}},
		DagStats: expected,
	})

	got := cache.GetDagStats()
	assert.Equal(t, expected, got)
}
