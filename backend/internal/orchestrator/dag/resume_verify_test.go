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

// TestRestartRecovery_AllNonTerminalToPaused verifies that all non-terminal
// node states are transitioned to PAUSED during restoreDag, per the design
// requirement that unfinished tasks should not auto-execute after restart.
func TestRestartRecovery_AllNonTerminalToPaused(t *testing.T) {
	// Helper to build a snapshot whose node ends in the given state.
	makeSnap := func(dagID string, finalState orchestrator.NodeState) orchestrator.DagSnapshot {
		// Build a minimal history that ends in finalState.
		// The exact path doesn't matter; only the last transition's To.
		states := []orchestrator.NodeState{
			orchestrator.NodeStatePending,
			orchestrator.NodeStateReady,
			orchestrator.NodeStateQueued,
			orchestrator.NodeStateAllocated,
			orchestrator.NodeStateRunning,
		}
		history := make([]orchestrator.StateTransitionRecord, 0, len(states))
		prev := orchestrator.NodeStatePending
		for _, s := range states {
			if s == finalState {
				break
			}
			history = append(history, orchestrator.StateTransitionRecord{
				NodeID: "node-1", DagID: dagID, From: prev, To: s, Timestamp: timeNow(),
			})
			prev = s
		}
		// Add the final transition to finalState if not already there.
		if prev != finalState {
			history = append(history, orchestrator.StateTransitionRecord{
				NodeID: "node-1", DagID: dagID, From: prev, To: finalState, Timestamp: timeNow(),
			})
		}
		return orchestrator.DagSnapshot{
			DagID:      dagID,
			CreatedAt:  timeNow(),
			Definition: newSimpleDagDef(dagID),
			NodeStates: []orchestrator.NodeSnapshot{
				{NodeID: "node-1", History: history},
			},
		}
	}

	// All non-terminal, non-PENDING states should be transitioned to PAUSED.
	testStates := []orchestrator.NodeState{
		orchestrator.NodeStateReady,
		orchestrator.NodeStateQueued,
		orchestrator.NodeStateAllocated,
		orchestrator.NodeStateRunning,
		orchestrator.NodeStateVerifying,
		orchestrator.NodeStateResumeVerify,
		orchestrator.NodeStateNeedsRetry,
	}

	for _, state := range testStates {
		t.Run(string(state), func(t *testing.T) {
			o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
			o1.SetScheduler(newMockScheduler(true))

			dagID := "dag-" + string(state)
			snap := makeSnap(dagID, state)
			require.NoError(t, o1.RestoreDagForTest(snap))

			// After restoration, the node must be in PAUSED.
			status := o1.GetDagStatus(dagID)
			require.NotNil(t, status)
			require.Len(t, status.Nodes, 1)
			assert.Equal(t, orchestrator.NodeStatePaused, status.Nodes[0].State,
				"node in %s should be transitioned to PAUSED on restart", state)

			// ReactivateReadyNodes must NOT re-submit the paused node.
			o1.ReactivateReadyNodes(context.Background())

			status = o1.GetDagStatus(dagID)
			require.NotNil(t, status)
			require.Len(t, status.Nodes, 1)
			assert.Equal(t, orchestrator.NodeStatePaused, status.Nodes[0].State,
				"PAUSED node must not be re-submitted by ReactivateReadyNodes")
		})
	}
}

// TestRestartRecovery_PendingStaysPending verifies that PENDING nodes are
// left untouched (they haven't started yet and are already "waiting").
func TestRestartRecovery_PendingStaysPending(t *testing.T) {
	o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
	o1.SetScheduler(newMockScheduler(true))

	snap := orchestrator.DagSnapshot{
		DagID:      "dag-pending",
		CreatedAt:  timeNow(),
		Definition: newSimpleDagDef("dag-pending"),
		NodeStates: []orchestrator.NodeSnapshot{
			{
				NodeID: "node-1",
				History: []orchestrator.StateTransitionRecord{
					{NodeID: "node-1", DagID: "dag-pending", From: orchestrator.NodeStatePending, To: orchestrator.NodeStatePending, Timestamp: timeNow()},
				},
			},
		},
	}
	// RestoreFromSnapshot with empty history leaves the node in PENDING.
	snap.NodeStates[0].History = nil
	require.NoError(t, o1.RestoreDagForTest(snap))

	status := o1.GetDagStatus("dag-pending")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStatePending, status.Nodes[0].State,
		"PENDING node should remain PENDING after restart")
}

// TestRestartRecovery_TerminalStaysTerminal verifies that terminal states
// (COMPLETED, FAILED, CANCELLED, TIMEOUT) are not transitioned.
func TestRestartRecovery_TerminalStaysTerminal(t *testing.T) {
	terminalStates := []orchestrator.NodeState{
		orchestrator.NodeStateCompleted,
		orchestrator.NodeStateFailed,
		orchestrator.NodeStateCancelled,
		orchestrator.NodeStateTimeout,
	}

	for _, state := range terminalStates {
		t.Run(string(state), func(t *testing.T) {
			o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})

			dagID := "dag-" + string(state)
			snap := orchestrator.DagSnapshot{
				DagID:      dagID,
				CreatedAt:  timeNow(),
				Definition: newSimpleDagDef(dagID),
				NodeStates: []orchestrator.NodeSnapshot{
					{
						NodeID: "node-1",
						History: []orchestrator.StateTransitionRecord{
							{NodeID: "node-1", DagID: dagID, From: orchestrator.NodeStateRunning, To: state, Timestamp: timeNow()},
						},
					},
				},
			}
			require.NoError(t, o1.RestoreDagForTest(snap))

			status := o1.GetDagStatus(dagID)
			require.NotNil(t, status)
			require.Len(t, status.Nodes, 1)
			assert.Equal(t, state, status.Nodes[0].State,
				"terminal state %s should not be transitioned on restart", state)
		})
	}
}
