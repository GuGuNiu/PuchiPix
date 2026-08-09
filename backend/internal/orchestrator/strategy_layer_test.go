package orchestrator

import (
	"testing"
)

// TestTransitionPolicy_NilPolicyFallsBackToGlobal verifies that a node
// without a TransitionPolicy uses the global validTransitions table
// (backward compatibility ??the core guarantee of the strategy layer).
func TestTransitionPolicy_NilPolicyFallsBackToGlobal(t *testing.T) {
	def := DagNodeDefinition{ID: "n1", TaskType: TaskTypeGallery, Phase: PhaseScrape}
	fsm := NewTaskStateMachine("dag1", "n1", PhaseScrape, def)

	// PENDING ??READY is allowed globally.
	if err := fsm.Transition(NodeStateReady, TransitionContext{Reason: "test"}); err != nil {
		t.Fatalf("PENDING ??READY should be allowed without policy: %v", err)
	}
	// PENDING ??COMPLETED is NOT allowed globally (must go through READY).
	fsm2 := NewTaskStateMachine("dag1", "n2", PhaseScrape, def)
	if err := fsm2.Transition(NodeStateCompleted, TransitionContext{Reason: "test"}); err == nil {
		t.Fatal("PENDING ??COMPLETED should be rejected without policy")
	}
}

// TestTransitionPolicy_GuardRedirect verifies that a policy guard can
// redirect a transition to a fallback state.
func TestTransitionPolicy_GuardRedirect(t *testing.T) {
	// Policy: RUNNING ??VERIFYING is redirected to COMPLETED when a guard
	// rejects VERIFYING (simulating skipVerify=true).
	rejectVerify := func(_ StateMachineContext, _ TransitionContext) bool { return false }
	policy := &TransitionPolicy{
		Transitions: map[NodeState][]TransitionRule{
			NodeStateRunning: {
				{From: NodeStateRunning, To: NodeStateVerifying, Guard: rejectVerify, Fallback: NodeStateCompleted},
			},
		},
	}
	def := DagNodeDefinition{ID: "n1", TaskType: TaskTypeGallery, Phase: PhaseScrape, TransitionPolicy: policy}
	fsm := NewTaskStateMachine("dag1", "n1", PhaseScrape, def)

	// Drive to RUNNING.
	_ = fsm.Transition(NodeStateReady, TransitionContext{Reason: "test"})
	_ = fsm.Transition(NodeStateQueued, TransitionContext{Reason: "test"})
	_ = fsm.Transition(NodeStateAllocated, TransitionContext{Reason: "test"})
	_ = fsm.Transition(NodeStateRunning, TransitionContext{Reason: "test"})

	// Request VERIFYING ??guard rejects, should redirect to COMPLETED.
	if err := fsm.Transition(NodeStateVerifying, TransitionContext{Reason: "verify"}); err != nil {
		t.Fatalf("redirected transition should succeed: %v", err)
	}
	if fsm.State() != NodeStateCompleted {
		t.Fatalf("expected COMPLETED after guard redirect, got %s", fsm.State())
	}
}

// TestTransitionPolicy_ActionExecution verifies that the Action callback
// runs after a policy-driven transition.
func TestTransitionPolicy_ActionExecution(t *testing.T) {
	actionRan := false
	action := func(ctx *StateMachineContext, _ TransitionContext) {
		actionRan = true
		ctx.Extras["actionTag"] = "fired"
	}
	policy := &TransitionPolicy{
		Transitions: map[NodeState][]TransitionRule{
			NodeStatePending: {
				{From: NodeStatePending, To: NodeStateReady, Action: action},
			},
		},
	}
	def := DagNodeDefinition{ID: "n1", TaskType: TaskTypeGallery, Phase: PhaseScrape, TransitionPolicy: policy}
	fsm := NewTaskStateMachine("dag1", "n1", PhaseScrape, def)

	_ = fsm.Transition(NodeStateReady, TransitionContext{Reason: "test"})
	if !actionRan {
		t.Fatal("policy action should have run on PENDING ??READY")
	}
	if v, _ := fsm.Context().Extras["actionTag"].(string); v != "fired" {
		t.Fatalf("action should have set Extras[actionTag]=fired, got %v", v)
	}
}

// TestTaskTypeRegistry_RegisterAndGet verifies aggregator and policy
// registration/lookup.
func TestTaskTypeRegistry_RegisterAndGet(t *testing.T) {
	reg := NewTaskTypeRegistry()
	agg := func(_ TaskType, _ []NodeSnapshotInfo) string { return "custom" }
	pol := &TransitionPolicy{RetryPolicy: &RetryPolicy{MaxAttempts: 5}}

	reg.RegisterAggregator(TaskTypeGallery, agg)
	reg.RegisterTransitionPolicy(TaskTypeGallery, pol)

	if got := reg.GetAggregator(TaskTypeGallery); got == nil {
		t.Fatal("gallery aggregator should be registered")
	}
	if got := reg.GetTransitionPolicy(TaskTypeGallery); got == nil || got.RetryPolicy.MaxAttempts != 5 {
		t.Fatal("gallery policy should be registered with MaxAttempts=5")
	}
	// Unregistered TaskType returns nil.
	if got := reg.GetAggregator(TaskTypeVideo); got != nil {
		t.Fatal("video aggregator should be nil")
	}
}

// TestResolveTransitionPolicy_DefinitionPrecedence verifies that an
// explicit policy in the definition takes precedence over the registry.
func TestResolveTransitionPolicy_DefinitionPrecedence(t *testing.T) {
	reg := NewTaskTypeRegistry()
	regPol := &TransitionPolicy{RetryPolicy: &RetryPolicy{MaxAttempts: 3}}
	reg.RegisterTransitionPolicy(TaskTypeGallery, regPol)

	defPol := &TransitionPolicy{RetryPolicy: &RetryPolicy{MaxAttempts: 7}}
	def := DagNodeDefinition{TaskType: TaskTypeGallery, TransitionPolicy: defPol}

	got := ResolveTransitionPolicy(reg, def)
	if got != defPol {
		t.Fatal("definition policy should take precedence over registry")
	}

	// Without definition policy, registry is used.
	def2 := DagNodeDefinition{TaskType: TaskTypeGallery}
	got2 := ResolveTransitionPolicy(reg, def2)
	if got2 != regPol {
		t.Fatal("registry policy should be used when definition has none")
	}
}

// TestValidTransitions_RunningToCompleted verifies the P7 fix: RUNNING
// ??COMPLETED is now in validTransitions (needed for skipVerify nodes).
func TestValidTransitions_RunningToCompleted(t *testing.T) {
	if !CanTransition(NodeStateRunning, NodeStateCompleted) {
		t.Fatal("RUNNING ??COMPLETED should be allowed (P7 fix for skipVerify)")
	}
}
