package dag

import (
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator"
)

// SnapshotSyncPayload is the data pushed from the orchestrator to the
// snapshot cache, mirroring the TypeScript DagSnapshotSyncPayload.
type SnapshotSyncPayload struct {
	Dags               []orchestrator.DagSnapshot
	DagStats           orchestrator.DagOrchestratorStats
	CurrentSeq         int64
	Timestamp          time.Time
}

// SnapshotCache stores the latest DAG snapshot for API query when the
// API layer cannot access the orchestrator directly (e.g. in a split
// process deployment).
type SnapshotCache struct {
	mu         sync.RWMutex
	dags       map[string]orchestrator.DagSnapshot
	dagStats   orchestrator.DagOrchestratorStats
	currentSeq int64
	lastUpdated time.Time
	logger     *infra.Logger
}

// NewSnapshotCache creates an empty snapshot cache.
func NewSnapshotCache() *SnapshotCache {
	return &SnapshotCache{
		dags:   make(map[string]orchestrator.DagSnapshot),
		logger: infra.NewLogger("DagSnapshotCache"),
	}
}

// Update replaces the entire cache with a fresh snapshot from the
// orchestrator.
func (c *SnapshotCache) Update(payload SnapshotSyncPayload) {
	c.mu.Lock()
	defer c.mu.Unlock()

	next := make(map[string]orchestrator.DagSnapshot, len(payload.Dags))
	for _, snap := range payload.Dags {
		next[snap.DagID] = snap
	}
	c.dags = next
	c.dagStats = payload.DagStats
	c.currentSeq = payload.CurrentSeq
	c.lastUpdated = time.Now()

	c.logger.Debug("Snapshot cache updated", "dagCount", len(c.dags))
}

// Clear removes all cached data, used when the orchestrator restarts.
func (c *SnapshotCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dags = make(map[string]orchestrator.DagSnapshot)
	c.dagStats = orchestrator.DagOrchestratorStats{}
	c.currentSeq = 0
	c.lastUpdated = time.Time{}
}

// GetAllDagSnapshots returns all cached DAG snapshots.
func (c *SnapshotCache) GetAllDagSnapshots() []orchestrator.DagSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]orchestrator.DagSnapshot, 0, len(c.dags))
	for _, snap := range c.dags {
		out = append(out, snap)
	}
	return out
}

// GetDagSnapshot returns a single DAG's snapshot.
func (c *SnapshotCache) GetDagSnapshot(dagID string) *orchestrator.DagSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	snap, ok := c.dags[dagID]
	if !ok {
		return nil
	}
	return &snap
}

// GetDagStats returns the cached DAG statistics.
func (c *SnapshotCache) GetDagStats() orchestrator.DagOrchestratorStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.dagStats
}

// GetCurrentSeq returns the last event sequence number.
func (c *SnapshotCache) GetCurrentSeq() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentSeq
}

// IsAvailable reports whether the cache has received at least one update.
func (c *SnapshotCache) IsAvailable() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return !c.lastUpdated.IsZero()
}

// GetAge returns the milliseconds since the last update.
func (c *SnapshotCache) GetAge() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.lastUpdated.IsZero() {
		return -1
	}
	return time.Since(c.lastUpdated).Milliseconds()
}
