package dag_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/slot"
)

// TestDagOrchestratorUpdateNodePriority verifies dynamic priority
// adjustment persists to the definition, notifies the scheduler, and
// validates inputs.
func TestDagOrchestratorUpdateNodePriority(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)
	ctx := context.Background()

	dagID, err := o.SubmitDag(ctx, newSimpleDagDef("dag-prio"))
	require.NoError(t, err)

	// Node is queued (submitted): the scheduler must be notified.
	err = o.UpdateNodePriority(ctx, dagID, "node-1", orchestrator.PriorityHigh)
	require.NoError(t, err)
	require.Contains(t, sched.priorityUpdates, dagID+":node-1")

	// Invalid priority is rejected.
	err = o.UpdateNodePriority(ctx, dagID, "node-1", 0)
	require.Error(t, err)

	// Missing node is rejected.
	err = o.UpdateNodePriority(ctx, dagID, "nope", orchestrator.PriorityHigh)
	require.Error(t, err)

	// Missing DAG is rejected.
	err = o.UpdateNodePriority(ctx, "missing-dag", "node-1", orchestrator.PriorityHigh)
	require.Error(t, err)
}

// TestDagOrchestratorSubmitDagAppliesSlotQuotas verifies that a DAG
// declaring metadata.SlotLimits has its task-level slot quotas applied
// to a real SlotPool at submission time, and that the pool enforces
// them strictly.
func TestDagOrchestratorSubmitDagAppliesSlotQuotas(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	sp := slot.NewSlotPool()
	sp.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 5, Min: 1, Max: 10})
	sp.RegisterType(slot.SlotTypeDefinition{Key: "scraping", Label: "Scraping", DefaultMax: 3, Min: 1, Max: 5})
	orch := dag.NewDagOrchestrator(es, sp)
	sched := newMockScheduler(true)
	orch.SetScheduler(sched)
	ctx := context.Background()

	def := newSimpleDagDef("dag-quota")
	def.Metadata.SlotLimits = map[string]int{"download": 2, "scraping": 1}
	_, err := orch.SubmitDag(ctx, def)
	require.NoError(t, err)

	quota := sp.GetDagQuota("dag-quota")
	require.Equal(t, 2, quota["download"])
	require.Equal(t, 1, quota["scraping"])

	// The quota must be enforced by the pool: two concurrent download
	// slots for this DAG fit, a third is rejected.
	require.True(t, sp.Acquire("download", "dag-quota:dl-1"))
	require.True(t, sp.Acquire("download", "dag-quota:dl-2"))
	require.False(t, sp.Acquire("download", "dag-quota:dl-3"))
}

// TestDagOrchestratorRetryNonBlocking verifies that RetryDag transitions
// failed nodes to READY immediately and schedules re-submission without
// blocking (immediate path with zero backoff).
func TestDagOrchestratorRetryNonBlocking(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)
	ctx := context.Background()

	dagID, err := o.SubmitDag(ctx, newSimpleDagDef("dag-retry"))
	require.NoError(t, err)

	// Force the node to FAILED via the FSM (QUEUED -> ALLOCATED ->
	// RUNNING -> FAILED).
	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateAllocated, orchestrator.TransitionContext{}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateRunning, orchestrator.TransitionContext{}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateFailed, orchestrator.TransitionContext{Reason: "test"}))

	// Retry schedules an immediate re-submission.
	err = o.RetryDag(ctx, dagID, "")
	require.NoError(t, err)

	status := o.GetDagStatus(dagID)
	require.NotNil(t, status)
	require.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State)
	require.True(t, sched.HasNode(dagID, "node-1"))
}

// TestDagOrchestratorDelayedRetrySubmitsAfterBackoff verifies the
// non-blocking backoff path: RetryDag with a retryPolicy returns
// immediately, and the node is re-submitted after the delay.
func TestDagOrchestratorDelayedRetrySubmitsAfterBackoff(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)
	ctx := context.Background()

	// Give the node a retryPolicy with a short fixed backoff.
	def := newSimpleDagDef("dag-delay-retry")
	def.Nodes[0].TransitionPolicy = &orchestrator.TransitionPolicy{
		RetryPolicy: &orchestrator.RetryPolicy{
			MaxAttempts:     2,
			BackoffMs:       50,
			BackoffStrategy: "fixed",
		},
	}
	dagID, err := o.SubmitDag(ctx, def)
	require.NoError(t, err)

	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateAllocated, orchestrator.TransitionContext{}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateRunning, orchestrator.TransitionContext{}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "node-1", orchestrator.NodeStateFailed, orchestrator.TransitionContext{Reason: "test"}))

	start := time.Now()
	err = o.RetryDag(ctx, dagID, "")
	require.NoError(t, err)
	// Must return well before the 50ms backoff elapses (non-blocking).
	require.Less(t, time.Since(start), 30*time.Millisecond)

	// Node accepted the retry immediately (READY) but not yet queued.
	status := o.GetDagStatus(dagID)
	require.Equal(t, orchestrator.NodeStateReady, status.Nodes[0].State)

	// After the backoff the node is re-submitted (mock submits instantly).
	require.Eventually(t, func() bool {
		return sched.HasNode(dagID, "node-1")
	}, 2*time.Second, 10*time.Millisecond)
}
