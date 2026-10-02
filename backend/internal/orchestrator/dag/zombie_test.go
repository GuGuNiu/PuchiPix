package dag

import (
	"context"
	"testing"
	"time"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// recordingScheduler is a SchedulerInterface stub that records submissions
// and lets tests toggle IsExecuting.
type recordingScheduler struct {
	submitted []string
	executing bool
}

func (r *recordingScheduler) Submit(node orchestrator.SchedulableNode) bool {
	r.submitted = append(r.submitted, node.NodeID)
	return true
}

func (r *recordingScheduler) SubmitWithDelay(node orchestrator.SchedulableNode, delay time.Duration) {}

func (r *recordingScheduler) UpdateNodePriority(dagID, nodeID string, newPriority int) bool {
	return false
}

func (r *recordingScheduler) HasNode(dagID, nodeID string) bool { return false }

func (r *recordingScheduler) CancelNode(dagID, nodeID string) {}

func (r *recordingScheduler) CancelRunningNode(dagID, nodeID string) {}

func (r *recordingScheduler) IsExecuting(dagID, nodeID string) bool { return r.executing }

func (r *recordingScheduler) WaitForDag(ctx context.Context, dagID string) error { return nil }

func (r *recordingScheduler) OnSlotFreed(slotType string) {}

func zombieTestOrch(t *testing.T, dagID string, sched *recordingScheduler) (*DagOrchestrator, *orchestrator.TaskStateMachine, *slot.SlotPool) {
	t.Helper()
	def := orchestrator.DagNodeDefinition{
		ID:    "vdl-T1",
		Phase: orchestrator.PhaseDownload,
		ResourceRequirements: []orchestrator.ResourceRequirement{
			{SlotType: "download", Count: 1, HoldUntil: "node_complete"},
		},
	}
	fsm := orchestrator.NewTaskStateMachine(dagID, def.ID, def.Phase, def)
	dag := &dagInstance{
		id: dagID,
		definition: orchestrator.DagDefinition{
			ID:       dagID,
			TaskType: orchestrator.TaskTypeVideo,
			Nodes:    []orchestrator.DagNodeDefinition{def},
		},
		nodes: map[string]*dagNodeInstance{def.ID: {definition: def, fsm: fsm}},
	}
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 2, Min: 1, Max: 5})
	orch := NewDagOrchestrator(nil, pool)
	orch.SetScheduler(sched)
	orch.dags[dagID] = dag
	return orch, fsm, pool
}

func driveToRunning(t *testing.T, fsm *orchestrator.TaskStateMachine) {
	t.Helper()
	for _, st := range []orchestrator.NodeState{
		orchestrator.NodeStateReady,
		orchestrator.NodeStateQueued,
		orchestrator.NodeStateAllocated,
		orchestrator.NodeStateRunning,
	} {
		if err := fsm.Transition(st, orchestrator.TransitionContext{}); err != nil {
			t.Fatalf("transition to %s: %v", st, err)
		}
	}
}

func TestSweepZombieNodesRequeuesDeadExecutor(t *testing.T) {
	sched := &recordingScheduler{}
	orch, fsm, _ := zombieTestOrch(t, "dagZ1", sched)
	driveToRunning(t, fsm)

	if n := orch.SweepZombieNodes(context.Background()); n != 1 {
		t.Fatalf("sweep requeued %d nodes, want 1", n)
	}
	if state := fsm.State(); state != orchestrator.NodeStateQueued {
		t.Fatalf("zombie node state = %s, want queued", state)
	}
	if len(sched.submitted) != 1 || sched.submitted[0] != "vdl-T1" {
		t.Fatalf("scheduler submissions = %v, want [vdl-T1]", sched.submitted)
	}
}

func TestSweepZombieNodesSkipsLiveExecutor(t *testing.T) {
	sched := &recordingScheduler{executing: true}
	orch, fsm, _ := zombieTestOrch(t, "dagZ2", sched)
	driveToRunning(t, fsm)

	if n := orch.SweepZombieNodes(context.Background()); n != 0 {
		t.Fatalf("sweep requeued %d nodes, want 0 (executor alive)", n)
	}
	if state := fsm.State(); state != orchestrator.NodeStateRunning {
		t.Fatalf("node state = %s, want running (untouched)", state)
	}
}

func TestSweepZombieNodesSkipsHeldSlot(t *testing.T) {
	sched := &recordingScheduler{}
	orch, fsm, pool := zombieTestOrch(t, "dagZ3", sched)
	driveToRunning(t, fsm)

	// Dispatch window: the slot is acquired before the worker registers,
	// so a held slot means the node is alive even while IsExecuting is
	// still false.
	if !pool.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "dagZ3:vdl-T1") {
		t.Fatal("slot acquisition failed")
	}
	if n := orch.SweepZombieNodes(context.Background()); n != 0 {
		t.Fatalf("sweep requeued %d nodes, want 0 (slot held)", n)
	}
	if state := fsm.State(); state != orchestrator.NodeStateRunning {
		t.Fatalf("node state = %s, want running (untouched)", state)
	}
}
