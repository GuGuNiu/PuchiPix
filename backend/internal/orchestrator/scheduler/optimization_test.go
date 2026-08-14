package scheduler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator/slot"
)

// TestReadyQueueCrossDagFairness verifies that when two DAGs submit
// same-priority nodes, PopBest alternates between them rather than
// draining one DAG entirely before the other. This prevents a DAG
// with a large batch of same-priority nodes from monopolizing the
// scheduler.
func TestReadyQueueCrossDagFairness(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()

	// Push 3 nodes from DAG-A and 3 from DAG-B, all at NORMAL priority.
	// Interleave pushes to verify that the dagDispatchCount sorting
	// overrides the FIFO order.
	for i := 0; i < 3; i++ {
		q.Push(makeNode("dag-a", "a-"+string(rune('1'+i)), 5, now))
		q.Push(makeNode("dag-b", "b-"+string(rune('1'+i)), 5, now))
	}

	// Pop all 6 nodes; verify DAG-A and DAG-B alternate.
	var order []string
	for {
		n := q.PopBest(fitsAll)
		if n == nil {
			break
		}
		order = append(order, n.DagID)
	}

	// The first two pops should be from different DAGs (alternation).
	assert.Equal(t, "dag-a", order[0])
	assert.Equal(t, "dag-b", order[1])
	// The third should go back to dag-a (its count is now 1, same as
	// dag-b's, so FIFO tie-break picks dag-a which was submitted first).
	assert.Equal(t, "dag-a", order[2])
	assert.Equal(t, "dag-b", order[3])
	assert.Equal(t, "dag-a", order[4])
	assert.Equal(t, "dag-b", order[5])
}

// TestReadyQueueDagDispatchReset verifies that when a DAG's last queued
// node is removed (not popped), its dispatch count is cleaned up so
// future re-submissions are not penalized by stale history.
func TestReadyQueueDagDispatchReset(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()

	// Push and pop a node from dag-a to bump its dispatch count.
	q.Push(makeNode("dag-a", "a-1", 5, now))
	n := q.PopBest(fitsAll)
	require.NotNil(t, n)
	require.Equal(t, "dag-a", n.DagID)

	// dag-a now has dispatch count = 1 but no queued nodes.
	// Push a new node from dag-a and one from dag-b at the same priority.
	// dag-a should NOT be penalized: its count was reset when the last
	// node was popped.
	q.Push(makeNode("dag-a", "a-2", 5, now))
	q.Push(makeNode("dag-b", "b-1", 5, now))

	n = q.PopBest(fitsAll)
	require.NotNil(t, n)
	// Both have dispatchCount=0, so FIFO by submittedAt wins.
	// a-2 was pushed first, so it should come out first.
	assert.Equal(t, "dag-a", n.DagID)
}

// TestReadyQueueDagDispatchRemoveCleanup verifies that Remove also
// triggers the dispatch count cleanup when a DAG's last node is
// cancelled rather than popped.
func TestReadyQueueDagDispatchRemoveCleanup(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()

	// Push and pop a node from dag-a to bump its dispatch count.
	q.Push(makeNode("dag-a", "a-1", 5, now))
	n := q.PopBest(fitsAll)
	require.NotNil(t, n)

	// Push another node from dag-a, then cancel it.
	q.Push(makeNode("dag-a", "a-2", 5, now))
	q.Remove("dag-a", "a-2")

	// dag-a should have no dispatch count now.
	// Push nodes from dag-a and dag-b; dag-a should not be penalized.
	q.Push(makeNode("dag-a", "a-3", 5, now))
	q.Push(makeNode("dag-b", "b-1", 5, now))

	n = q.PopBest(fitsAll)
	require.NotNil(t, n)
	assert.Equal(t, "dag-a", n.DagID, "dag-a should not be penalized after cleanup")
}

// TestSchedulerMetricsBasic verifies that the metrics counters are
// incremented correctly during Submit, Schedule, and dispatch.
func TestSchedulerMetricsBasic(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 2, Min: 1, Max: 10})
	engine := NewSchedulerEngine(pool)

	mockOrch := newMockDagOrchestrator()
	engine.SetDagOrchestrator(mockOrch)

	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		return true, nil
	})

	// Submit a node — it should be dispatched immediately.
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		Priority:             5,
		TaskType:             "gallery",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})

	// Wait for completion.
	mockOrch.waitForCompletion(t)

	metrics := engine.GetMetrics()
	assert.Equal(t, int64(1), metrics.TotalScheduled, "one node should have been dispatched")
	assert.GreaterOrEqual(t, metrics.TotalSchedulePasses, int64(1), "at least one schedule pass should have run")
	assert.Equal(t, int64(0), metrics.TotalRejected, "no nodes should have been rejected")
	assert.Equal(t, int64(0), metrics.TotalSlotRaceLost, "no slot races should have been lost")
	assert.GreaterOrEqual(t, metrics.LastScheduleAt, time.Now().Unix()-10, "last schedule should be recent")
}

// TestSchedulerMetricsRejected verifies that rejected submissions
// increment the TotalRejected counter.
func TestSchedulerMetricsRejected(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "sniff", DefaultMax: 0, Min: 0, Max: 10})
	engine := NewSchedulerEngine(pool)

	// sniff has maxQueueSize = 1 by default.
	// Fill the queue with 1 node, then submit a second to trigger rejection.
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "sniff", Count: 1}},
	})
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-2",
		DagID:                "dag-2",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "sniff", Count: 1}},
	})

	metrics := engine.GetMetrics()
	assert.Equal(t, int64(1), metrics.TotalRejected, "second sniff node should have been rejected")
}

// TestSchedulerMetricsNoopPass verifies that a Schedule() call that
// dispatches nothing increments the TotalNoopPasses counter.
func TestSchedulerMetricsNoopPass(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 10})
	engine := NewSchedulerEngine(pool)

	// No nodes in queue — Schedule should be a no-op pass.
	engine.Schedule()

	metrics := engine.GetMetrics()
	assert.Equal(t, int64(1), metrics.TotalNoopPasses, "one no-op pass should have been recorded")
	assert.Equal(t, int64(0), metrics.TotalScheduled, "no nodes should have been dispatched")
}
