package scheduler

import (
	"context"
	"sync"
	"testing"
	"time"

	"backend/internal/orchestrator/slot"
)

// recordingOrch is a DagOrchestratorInterface stub that records the
// transitions and completion reports the engine sends it.
type recordingOrch struct {
	mu          sync.Mutex
	transitions []string
	completions []string
}

func (r *recordingOrch) TransitionNode(dagID, nodeID string, toState string, reason, triggeredBy string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.transitions = append(r.transitions, toState)
	return nil
}

func (r *recordingOrch) OnNodeCompleted(dagID, nodeID string, success bool, data map[string]any, errMsg string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if success {
		r.completions = append(r.completions, "ok")
	} else {
		r.completions = append(r.completions, "fail:"+errMsg)
	}
	return nil
}

func (r *recordingOrch) ReactivateReadyNodes() {}

func (r *recordingOrch) GetNodeForVerification(dagID, nodeID string) interface{} { return nil }

func (r *recordingOrch) snapshot() ([]string, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.transitions...), append([]string(nil), r.completions...)
}

// TestExecuteNodeSettlesWhenExecutorBlocksForever locks in the supervisor
// contract: an executor that blocks on a wait ignoring its context must
// not wedge the node. The supervisor settles at the context deadline,
// releases the slot, and reports the timeout through OnNodeCompleted
// (which owns the FAILED transition and the failure cascade).
func TestExecuteNodeSettlesWhenExecutorBlocksForever(t *testing.T) {
	sp := slot.NewSlotPool()
	sp.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 2, Min: 1, Max: 5})
	s := NewSchedulerEngine(sp)
	orchState := &recordingOrch{}

	block := make(chan struct{})
	fn := func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		<-block // ignores ctx entirely: the pathological executor
		return true, nil
	}

	// Simulate the engine flow: Schedule acquires the slot before
	// dispatching executeNode.
	if !sp.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "d1:n1") {
		t.Fatal("slot acquisition failed")
	}

	node := SchedulableNodeAdapter{
		NodeID:               "n1",
		DagID:                "d1",
		TimeoutMs:            60,
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "download", Count: 1}},
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.executeNode(SchedulableNodeEntry{orchestratorNode: node}, fn, orchState)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("executeNode did not settle at the node timeout")
	}

	if usage := sp.GetUsage("download"); usage == nil || usage.Current != 0 {
		t.Fatalf("slot not released after timeout settle: %+v", usage)
	}
	if s.IsExecuting("d1", "n1") {
		t.Fatal("node still marked executing after settle")
	}
	transitions, completions := orchState.snapshot()
	if len(completions) != 1 || completions[0] != "fail:node execution timeout" {
		t.Fatalf("completions = %v, want one timeout failure", completions)
	}
	for _, tr := range transitions {
		if tr == "failed" {
			t.Fatal("supervisor must not pre-transition to failed: OnNodeCompleted owns the transition and the cascade")
		}
	}

	close(block) // let the detached worker exit
}

// TestLateSettleCannotTearDownRedispatch exercises the dispatch epoch:
// an out-of-FSM re-dispatch of the same holder while the first
// supervisor is still in flight must survive the first supervisor's
// late settle — its registration and slot stay intact, and the second
// settle releases everything.
func TestLateSettleCannotTearDownRedispatch(t *testing.T) {
	sp := slot.NewSlotPool()
	sp.RegisterType(slot.SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 2, Min: 1, Max: 5})
	s := NewSchedulerEngine(sp)
	orchState := &recordingOrch{}

	block1 := make(chan struct{})
	block2 := make(chan struct{})
	fn := func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		if run, _ := node.Config["run"].(int); run == 1 {
			<-block1
		} else {
			<-block2
		}
		return true, nil
	}

	if !sp.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "d1:n1") {
		t.Fatal("first slot acquisition failed")
	}
	run1 := SchedulableNodeAdapter{NodeID: "n1", DagID: "d1", TimeoutMs: 60, Config: map[string]any{"run": 1}}
	done1 := make(chan struct{})
	go func() {
		defer close(done1)
		s.executeNode(SchedulableNodeEntry{orchestratorNode: run1}, fn, orchState)
	}()
	time.Sleep(20 * time.Millisecond) // run1 registered, still blocked

	// Out-of-FSM re-dispatch while run1's supervisor is still in flight.
	if !sp.AcquireBatch([]slot.ResourceRequirement{{SlotType: "download", Count: 1}}, "d1:n1") {
		t.Fatal("second slot acquisition failed")
	}
	run2 := SchedulableNodeAdapter{NodeID: "n1", DagID: "d1", TimeoutMs: 5000, Config: map[string]any{"run": 2}}
	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		s.executeNode(SchedulableNodeEntry{orchestratorNode: run2}, fn, orchState)
	}()
	time.Sleep(120 * time.Millisecond) // run1's 60ms timeout fired and settled

	if !s.IsExecuting("d1", "n1") {
		t.Fatal("run2 registration was torn down by run1's late settle")
	}
	if usage := sp.GetUsage("download"); usage == nil || usage.Current != 2 {
		t.Fatalf("slot usage = %+v, want 2 (run1's release skipped by epoch, run2 holds its own)", usage)
	}

	close(block1) // first worker finally returns — must be a no-op
	time.Sleep(50 * time.Millisecond)
	if usage := sp.GetUsage("download"); usage == nil || usage.Current != 2 {
		t.Fatalf("late first worker disturbed the re-dispatched run: %+v", usage)
	}

	close(block2)
	select {
	case <-done2:
	case <-time.After(3 * time.Second):
		t.Fatal("second dispatch never settled")
	}
	if usage := sp.GetUsage("download"); usage == nil || usage.Current != 0 {
		t.Fatalf("slot not fully released after second settle: %+v", usage)
	}
	if s.IsExecuting("d1", "n1") {
		t.Fatal("node still marked executing after second settle")
	}
}
