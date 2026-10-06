package dag

import (
	"context"
	"testing"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

type reconcileSyncRecorder struct {
	calls []string
}

func (r *reconcileSyncRecorder) sync(_ context.Context, dagID string, _ orchestrator.DagDefinition, aggregate string) {
	r.calls = append(r.calls, dagID+":"+aggregate)
}

func reconcileTestNode(dagID, nodeID string) (orchestrator.DagNodeDefinition, *orchestrator.TaskStateMachine) {
	def := orchestrator.DagNodeDefinition{
		ID:    nodeID,
		Phase: orchestrator.PhaseDownload,
	}
	return def, orchestrator.NewTaskStateMachine(dagID, nodeID, def.Phase, def)
}

// registerReconcileDag installs a video DAG whose nodes walked to the given
// states, mirroring the shape restoreDag produces after a restart.
func registerReconcileDag(t *testing.T, orch *DagOrchestrator, dagID string, nodeIDs []string, walk func(nodeID string, fsm *orchestrator.TaskStateMachine)) {
	t.Helper()
	nodes := make(map[string]*dagNodeInstance, len(nodeIDs))
	defs := make([]orchestrator.DagNodeDefinition, 0, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		def, fsm := reconcileTestNode(dagID, nodeID)
		walk(nodeID, fsm)
		nodes[nodeID] = &dagNodeInstance{definition: def, fsm: fsm}
		defs = append(defs, def)
	}
	orch.dags[dagID] = &dagInstance{
		id:         dagID,
		definition: orchestrator.DagDefinition{ID: dagID, TaskType: orchestrator.TaskTypeVideo, Nodes: defs},
		nodes:      nodes,
	}
}

func walkStates(t *testing.T, fsm *orchestrator.TaskStateMachine, states ...orchestrator.NodeState) {
	t.Helper()
	for _, st := range states {
		if err := fsm.Transition(st, orchestrator.TransitionContext{}); err != nil {
			t.Fatalf("transition to %s: %v", st, err)
		}
	}
}

// A DAG parked by restart recovery (scrape done, download PAUSED) must be
// reported as paused so the entity row stops claiming it waits for capacity.
func TestReconcileHealsRestartPausedDags(t *testing.T) {
	orch := NewDagOrchestrator(nil, slot.NewSlotPool())
	rec := &reconcileSyncRecorder{}
	orch.SetDagStatusSyncFn(rec.sync)

	registerReconcileDag(t, orch, "DAGPAUSED", []string{"vsc-A", "vdl-A"}, func(nodeID string, fsm *orchestrator.TaskStateMachine) {
		if nodeID == "vsc-A" {
			walkStates(t, fsm, orchestrator.NodeStateReady, orchestrator.NodeStateQueued,
				orchestrator.NodeStateAllocated, orchestrator.NodeStateRunning,
				orchestrator.NodeStateVerifying, orchestrator.NodeStateCompleted)
		} else {
			walkStates(t, fsm, orchestrator.NodeStateReady, orchestrator.NodeStatePaused)
		}
	})

	orch.ReconcileEntityStatuses(context.Background())

	if len(rec.calls) != 1 || rec.calls[0] != "DAGPAUSED:paused" {
		t.Fatalf("calls = %v, want [DAGPAUSED:paused]", rec.calls)
	}
}

// A still-pending DAG (never dispatched) aggregates to pending and must not
// produce any sync call.
func TestReconcileSkipsPendingAggregate(t *testing.T) {
	orch := NewDagOrchestrator(nil, slot.NewSlotPool())
	rec := &reconcileSyncRecorder{}
	orch.SetDagStatusSyncFn(rec.sync)

	registerReconcileDag(t, orch, "DAGWAIT", []string{"vsc-B", "vdl-B"}, func(_ string, _ *orchestrator.TaskStateMachine) {})

	orch.ReconcileEntityStatuses(context.Background())

	if len(rec.calls) != 0 {
		t.Fatalf("calls = %v, want none for pending aggregate", rec.calls)
	}
}

// The pre-existing terminal healing must keep working alongside the new
// paused branch when both DAG shapes are present.
func TestReconcileHealsTerminalAndPausedTogether(t *testing.T) {
	orch := NewDagOrchestrator(nil, slot.NewSlotPool())
	rec := &reconcileSyncRecorder{}
	orch.SetDagStatusSyncFn(rec.sync)

	registerReconcileDag(t, orch, "DAGDONE", []string{"vsc-C", "vdl-C"}, func(_ string, fsm *orchestrator.TaskStateMachine) {
		walkStates(t, fsm, orchestrator.NodeStateReady, orchestrator.NodeStateQueued,
			orchestrator.NodeStateAllocated, orchestrator.NodeStateRunning,
			orchestrator.NodeStateVerifying, orchestrator.NodeStateCompleted)
	})
	registerReconcileDag(t, orch, "DAGPARK", []string{"vdl-D"}, func(_ string, fsm *orchestrator.TaskStateMachine) {
		walkStates(t, fsm, orchestrator.NodeStateReady, orchestrator.NodeStatePaused)
	})

	orch.ReconcileEntityStatuses(context.Background())

	if len(rec.calls) != 2 {
		t.Fatalf("calls = %v, want two heals", rec.calls)
	}
	seen := map[string]bool{}
	for _, c := range rec.calls {
		seen[c] = true
	}
	if !seen["DAGDONE:completed"] || !seen["DAGPARK:paused"] {
		t.Fatalf("calls = %v, want DAGDONE:completed and DAGPARK:paused", rec.calls)
	}
}

// A nil sync callback must be a silent no-op, not a panic.
func TestReconcileNoopWithoutSyncFn(t *testing.T) {
	orch := NewDagOrchestrator(nil, slot.NewSlotPool())
	registerReconcileDag(t, orch, "DAGNIL", []string{"vdl-E"}, func(_ string, fsm *orchestrator.TaskStateMachine) {
		walkStates(t, fsm, orchestrator.NodeStateReady, orchestrator.NodeStatePaused)
	})
	orch.ReconcileEntityStatuses(context.Background())
}
