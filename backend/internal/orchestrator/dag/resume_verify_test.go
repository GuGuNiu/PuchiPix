package dag_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// timeNow is a tiny helper so snapshot tests can set a stable timestamp.
func timeNow() time.Time { return time.Now() }

// TestResumeVerifyActivationPassed verifies Phase 3 fix: a node stranded
// in RESUME_VERIFY (produced by restoreDag's onRestart policy) is
// re-driven by ReactivateReadyNodes. With no reconciler installed
// (runVerification defaults to "passed"), the node must transition
// RESUME_VERIFY -> COMPLETED.
func TestResumeVerifyActivationPassed(t *testing.T) {
	o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
	o1.SetScheduler(newMockScheduler(true))

	// Craft a snapshot whose node history ends in RESUME_VERIFY (exactly
	// what restoreDag produces when onRestart maps RUNNING/VERIFYING to
	// RESUME_VERIFY with resumableVerify=true).
	snap := orchestrator.DagSnapshot{
		DagID:      "dag-RV",
		CreatedAt:  timeNow(),
		Definition: newSimpleDagDef("dag-RV"),
		NodeStates: []orchestrator.NodeSnapshot{
			{
				NodeID: "node-1",
				History: []orchestrator.StateTransitionRecord{
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStatePending, To: orchestrator.NodeStateReady, Timestamp: timeNow()},
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStateReady, To: orchestrator.NodeStateQueued, Timestamp: timeNow()},
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStateQueued, To: orchestrator.NodeStateAllocated, Timestamp: timeNow()},
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStateAllocated, To: orchestrator.NodeStateRunning, Timestamp: timeNow()},
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStateRunning, To: orchestrator.NodeStateVerifying, Timestamp: timeNow()},
					{NodeID: "node-1", DagID: "dag-RV", From: orchestrator.NodeStateVerifying, To: orchestrator.NodeStateResumeVerify, Timestamp: timeNow()},
				},
			},
		},
	}
	require.NoError(t, o1.RestoreDagForTest(snap))

	// Before activation the node is stranded in RESUME_VERIFY.
	status := o1.GetDagStatus("dag-RV")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStateResumeVerify, status.Nodes[0].State)

	// ReactivateReadyNodes (the periodic scan) must drive verification.
	o1.ReactivateReadyNodes(context.Background())

	status = o1.GetDagStatus("dag-RV")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStateCompleted, status.Nodes[0].State,
		"RESUME_VERIFY node must reach COMPLETED when verification passes")
}

// TestResumeVerifyActivationNeedsRetry verifies the needs_retry path:
// when the reconciler flags retry (scrape produced no rows), the
// RESUME_VERIFY node is routed NEEDS_RETRY -> READY -> QUEUED and
// re-submitted to the scheduler instead of being stranded or hard-failed.
func TestResumeVerifyActivationNeedsRetry(t *testing.T) {
	database := newTestDatabase(t)
	o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
	sched := newMockScheduler(true)
	o1.SetScheduler(sched)
	o1.SetReconciler(orchestrator.NewStateReconciler(database))

	// Scrape node with a galleryId that has no rows in the DB, so
	// verifyScrapeNode returns needs_retry.
	def := orchestrator.DagDefinition{
		ID:       "dag-RV2",
		TaskType: orchestrator.TaskTypeGallery,
		Nodes: []orchestrator.DagNodeDefinition{
			{
				ID:       "scrape",
				TaskType: orchestrator.TaskTypeGallery,
				Phase:    orchestrator.PhaseScrape,
				Executor: "scrape",
				Priority: orchestrator.PriorityNormal,
				Config:   map[string]any{"galleryId": 999999},
			},
		},
		Metadata: orchestrator.DagMetadata{SourceURL: "https://example.com/rv2/1"},
	}

	snap := orchestrator.DagSnapshot{
		DagID:      "dag-RV2",
		CreatedAt:  timeNow(),
		Definition: def,
		NodeStates: []orchestrator.NodeSnapshot{
			{
				NodeID: "scrape",
				History: []orchestrator.StateTransitionRecord{
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStatePending, To: orchestrator.NodeStateReady, Timestamp: timeNow()},
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStateReady, To: orchestrator.NodeStateQueued, Timestamp: timeNow()},
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStateQueued, To: orchestrator.NodeStateAllocated, Timestamp: timeNow()},
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStateAllocated, To: orchestrator.NodeStateRunning, Timestamp: timeNow()},
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStateRunning, To: orchestrator.NodeStateVerifying, Timestamp: timeNow()},
					{NodeID: "scrape", DagID: "dag-RV2", From: orchestrator.NodeStateVerifying, To: orchestrator.NodeStateResumeVerify, Timestamp: timeNow()},
				},
			},
		},
	}
	require.NoError(t, o1.RestoreDagForTest(snap))

	o1.ReactivateReadyNodes(context.Background())

	// needs_retry path: node goes RESUME_VERIFY -> NEEDS_RETRY -> READY
	// -> QUEUED and is re-submitted to the scheduler.
	status := o1.GetDagStatus("dag-RV2")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State,
		"needs_retry RESUME_VERIFY node must be re-submitted (QUEUED)")

	sched.mu.Lock()
	submitted := sched.submitted["dag-RV2:scrape"]
	sched.mu.Unlock()
	assert.True(t, submitted, "needs_retry node must reach the scheduler")
}
