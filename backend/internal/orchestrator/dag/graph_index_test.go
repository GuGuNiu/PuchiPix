package dag_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// buildChainDagDef builds a linear DAG: node-0 -> node-1 -> ... -> node-(n-1).
func buildChainDagDef(dagID string, n int) orchestrator.DagDefinition {
	nodes := make([]orchestrator.DagNodeDefinition, 0, n)
	for i := 0; i < n; i++ {
		node := orchestrator.DagNodeDefinition{
			ID:       fmt.Sprintf("node-%d", i),
			TaskType: orchestrator.TaskTypeGallery,
			Phase:    orchestrator.PhaseScrape,
			Executor: "scrape",
			Priority: orchestrator.PriorityNormal,
		}
		if i > 0 {
			node.Dependencies = []string{fmt.Sprintf("node-%d", i-1)}
		}
		nodes = append(nodes, node)
	}
	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes:    nodes,
	}
}

// buildFanOutDagDef builds a DAG where one root has (n-1) direct dependents.
func buildFanOutDagDef(dagID string, n int) orchestrator.DagDefinition {
	nodes := make([]orchestrator.DagNodeDefinition, 0, n)
	nodes = append(nodes, orchestrator.DagNodeDefinition{
		ID:       "root",
		TaskType: orchestrator.TaskTypeGallery,
		Phase:    orchestrator.PhaseScrape,
		Executor: "scrape",
		Priority: orchestrator.PriorityNormal,
	})
	for i := 1; i < n; i++ {
		nodes = append(nodes, orchestrator.DagNodeDefinition{
			ID:           fmt.Sprintf("leaf-%d", i),
			TaskType:     orchestrator.TaskTypeGallery,
			Phase:        orchestrator.PhaseDownload,
			Executor:     "download",
			Priority:     orchestrator.PriorityNormal,
			Dependencies: []string{"root"},
		})
	}
	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes:    nodes,
	}
}

// completeNode drives a node through the legal transition path to COMPLETED.
func completeNode(t *testing.T, o *dag.DagOrchestrator, dagID, nodeID string) {
	t.Helper()
	ctx := context.Background()
	for _, state := range []orchestrator.NodeState{
		orchestrator.NodeStateAllocated,
		orchestrator.NodeStateRunning,
		orchestrator.NodeStateVerifying,
		orchestrator.NodeStateCompleted,
	} {
		require.NoError(t, o.TransitionNode(ctx, dagID, nodeID, state,
			orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"}))
	}
}

// TestGraphIndexChainActivation verifies that completing nodes in a chain
// activates exactly one successor at a time via incremental O(d) activation.
func TestGraphIndexChainActivation(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	const n = 8
	_, err := o.SubmitDag(context.Background(), buildChainDagDef("dag-chain", n))
	require.NoError(t, err)

	for i := 0; i < n; i++ {
		nodeID := fmt.Sprintf("node-%d", i)
		status := o.GetDagStatus("dag-chain")
		require.NotNil(t, status)
		stateOf := func(id string) orchestrator.NodeState {
			for _, ns := range status.Nodes {
				if ns.NodeID == id {
					return ns.State
				}
			}
			return ""
		}
		assert.Equal(t, orchestrator.NodeStateQueued, stateOf(nodeID),
			"node %s should be QUEUED at step %d", nodeID, i)

		completeNode(t, o, "dag-chain", nodeID)
		require.NoError(t, o.OnNodeCompleted(context.Background(), "dag-chain", nodeID,
			orchestrator.NodeExecutionResult{Success: true}))
	}

	// All nodes should now be completed.
	status := o.GetDagStatus("dag-chain")
	for _, ns := range status.Nodes {
		assert.Equal(t, orchestrator.NodeStateCompleted, ns.State)
	}
}

// TestGraphIndexFanOutActivation verifies that completing a root with many
// dependents activates all of them in a single O(d) pass.
func TestGraphIndexFanOutActivation(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	const n = 50
	_, err := o.SubmitDag(context.Background(), buildFanOutDagDef("dag-fan", n))
	require.NoError(t, err)

	completeNode(t, o, "dag-fan", "root")
	require.NoError(t, o.OnNodeCompleted(context.Background(), "dag-fan", "root",
		orchestrator.NodeExecutionResult{Success: true}))

	status := o.GetDagStatus("dag-fan")
	require.NotNil(t, status)
	queued := 0
	for _, ns := range status.Nodes {
		if ns.State == orchestrator.NodeStateQueued {
			queued++
		}
	}
	assert.Equal(t, n-1, queued, "all %d leaves should be QUEUED after root completes", n-1)
}

// TestGraphIndexCycleRejected verifies that a cyclic DAG definition is
// rejected at SubmitDag time via the graph library's cycle detection.
func TestGraphIndexCycleRejected(t *testing.T) {
	o := newTestDagOrchestrator()
	def := orchestrator.DagDefinition{
		ID:       "dag-cycle",
		TaskType: orchestrator.TaskTypeGallery,
		Nodes: []orchestrator.DagNodeDefinition{
			{ID: "a", TaskType: orchestrator.TaskTypeGallery, Phase: orchestrator.PhaseScrape, Executor: "scrape", Dependencies: []string{"b"}},
			{ID: "b", TaskType: orchestrator.TaskTypeGallery, Phase: orchestrator.PhaseScrape, Executor: "scrape", Dependencies: []string{"a"}},
		},
	}
	_, err := o.SubmitDag(context.Background(), def)
	assert.Error(t, err, "cyclic DAG should be rejected")
}

// TestGraphIndexRestoreConsistency verifies that after snapshot restore,
// the rebuilt graph index and recomputed counters activate downstream
// nodes identically to a live orchestrator.
func TestGraphIndexRestoreConsistency(t *testing.T) {
	ctx := context.Background()

	// Live orchestrator: submit a 4-node chain, complete the first two.
	o1 := newTestDagOrchestrator()
	require.NoError(t, o1.Initialize(ctx))
	_, err := o1.SubmitDag(ctx, buildChainDagDef("dag-restore", 4))
	require.NoError(t, err)
	completeNode(t, o1, "dag-restore", "node-0")
	require.NoError(t, o1.OnNodeCompleted(ctx, "dag-restore", "node-0", orchestrator.NodeExecutionResult{Success: true}))
	completeNode(t, o1, "dag-restore", "node-1")
	require.NoError(t, o1.OnNodeCompleted(ctx, "dag-restore", "node-1", orchestrator.NodeExecutionResult{Success: true}))

	// Take a snapshot and restore into a fresh orchestrator.
	snap := o1.GetDagSnapshot("dag-restore")
	require.NotNil(t, snap)

	o2 := newTestDagOrchestrator()
	sched2 := newMockScheduler(true)
	o2.SetScheduler(sched2)
	require.NoError(t, o2.RestoreDagForTest(*snap))

	// After restore, node-2 was QUEUED in the snapshot but is now
	// PAUSED (per the design requirement: all non-terminal nodes
	// transition to PAUSED on restart so the user controls execution).
	// Simulate a user "resume" by transitioning PAUSED → READY → QUEUED.
	require.NoError(t, o2.TransitionNode(ctx, "dag-restore", "node-2",
		orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "user resume", TriggeredBy: "user"}))
	require.NoError(t, o2.TransitionNode(ctx, "dag-restore", "node-2",
		orchestrator.NodeStateQueued, orchestrator.TransitionContext{Reason: "re-queued", TriggeredBy: "system"}))

	// Drive the legal QUEUED → ALLOCATED → ... → COMPLETED path.
	completeNode(t, o2, "dag-restore", "node-2")
	require.NoError(t, o2.OnNodeCompleted(ctx, "dag-restore", "node-2", orchestrator.NodeExecutionResult{Success: true}))

	status := o2.GetDagStatus("dag-restore")
	require.NotNil(t, status)
	stateOf := func(id string) orchestrator.NodeState {
		for _, ns := range status.Nodes {
			if ns.NodeID == id {
				return ns.State
			}
		}
		return ""
	}
	assert.Equal(t, orchestrator.NodeStateQueued, stateOf("node-3"),
		"node-3 should activate after restore + incremental completion")
}

// BenchmarkPropagateCompletion measures incremental activation cost on a
// fan-out DAG with n leaves (d = n-1 direct successors of the root).
func BenchmarkPropagateCompletion(b *testing.B) {
	for _, n := range []int{100, 1000} {
		b.Run(fmt.Sprintf("fanout-%d", n), func(b *testing.B) {
			o := newTestDagOrchestrator()
			sched := newMockScheduler(true)
			o.SetScheduler(sched)
			ctx := context.Background()

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				dagID := fmt.Sprintf("dag-bench-%d", i)
				_, _ = o.SubmitDag(ctx, buildFanOutDagDef(dagID, n))
				// Drive root to COMPLETED (transitions, not timed).
				for _, state := range []orchestrator.NodeState{
					orchestrator.NodeStateAllocated,
					orchestrator.NodeStateRunning,
					orchestrator.NodeStateVerifying,
					orchestrator.NodeStateCompleted,
				} {
					_ = o.TransitionNode(ctx, dagID, "root", state,
						orchestrator.TransitionContext{Reason: "bench", TriggeredBy: "bench"})
				}
				b.StartTimer()
				// Timed section: incremental activation of n-1 successors.
				_ = o.OnNodeCompleted(ctx, dagID, "root", orchestrator.NodeExecutionResult{Success: true})
			}
		})
	}
}
