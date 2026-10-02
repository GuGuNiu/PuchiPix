package dag

import (
	"context"
	"testing"
	"time"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

func capTestNode(dagID, nodeID string) (orchestrator.DagNodeDefinition, *orchestrator.TaskStateMachine) {
	def := orchestrator.DagNodeDefinition{
		ID:    nodeID,
		Phase: orchestrator.PhaseDownload,
		ResourceRequirements: []orchestrator.ResourceRequirement{
			{SlotType: "download", Count: 1, HoldUntil: "node_complete"},
		},
	}
	fsm := orchestrator.NewTaskStateMachine(dagID, nodeID, def.Phase, def)
	return def, fsm
}

// EnforceSlotMax pauses the newest-held holders first so longer-running
// work keeps its progress.
func TestEnforceSlotMaxPausesNewestHolders(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 5, Min: 1, Max: 50})
	sched := &recordingScheduler{}
	orch := NewDagOrchestrator(nil, pool)
	orch.SetScheduler(sched)

	build := func(dagID, nodeID string) *orchestrator.TaskStateMachine {
		def, fsm := capTestNode(dagID, nodeID)
		dag := &dagInstance{
			id: dagID,
			definition: orchestrator.DagDefinition{
				ID:       dagID,
				TaskType: orchestrator.TaskTypeVideo,
				Nodes:    []orchestrator.DagNodeDefinition{def},
			},
			nodes: map[string]*dagNodeInstance{nodeID: {definition: def, fsm: fsm}},
		}
		orch.dags[dagID] = dag
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
		return fsm
	}

	fsmOld := build("dagOld", "vdl-OLD")
	if !pool.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "dagOld:vdl-OLD") {
		t.Fatal("old acquire failed")
	}
	time.Sleep(25 * time.Millisecond)
	fsmNew := build("dagNew", "vdl-NEW")
	if !pool.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "dagNew:vdl-NEW") {
		t.Fatal("new acquire failed")
	}

	if n := orch.EnforceSlotMax(context.Background(), "download", 1); n != 1 {
		t.Fatalf("enforcement paused %d nodes, want 1", n)
	}
	if state := fsmNew.State(); state != orchestrator.NodeStatePaused {
		t.Fatalf("newest node state = %s, want paused", state)
	}
	if state := fsmOld.State(); state != orchestrator.NodeStateRunning {
		t.Fatalf("older node state = %s, want running (progress preserved)", state)
	}
	if usage := pool.GetUsage("download"); usage == nil || usage.Current != 1 {
		t.Fatalf("download usage = %+v, want current=1", usage)
	}
}

func TestEnforceSlotMaxNoopWhenUnderCap(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 5, Min: 1, Max: 50})
	orch := NewDagOrchestrator(nil, pool)
	orch.SetScheduler(&recordingScheduler{})

	if n := orch.EnforceSlotMax(context.Background(), "download", 3); n != 0 {
		t.Fatalf("enforcement paused %d nodes with no holders, want 0", n)
	}
	// Raising the cap above the current holder count is also a no-op.
	if !pool.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "dagX:n1") {
		t.Fatal("acquire failed")
	}
	if n := orch.EnforceSlotMax(context.Background(), "download", 4); n != 0 {
		t.Fatalf("raising the cap paused %d nodes, want 0", n)
	}
}
