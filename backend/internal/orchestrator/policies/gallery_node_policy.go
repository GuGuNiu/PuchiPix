// Package policies holds per-TaskType TransitionPolicy definitions that
// layer on top of the orchestrator's global validTransitions table.
// Each policy enables config-driven state-machine differentiation so
// nodes with different Config values can follow different transition
// paths, run different actions, and use different retry behavior without
// modifying hardcoded orchestrator logic.
package policies

import (
	"time"

	"backend/internal/orchestrator"
)

// GalleryNodePolicy is the TransitionPolicy for gallery-type DAG nodes:
// guards (skipVerify / shouldVerify), actions (onEnterRunning /
// onExitRunning), retryPolicy, and the onPause / onResume / onRestart
// strategy methods.
//
// Resolution: the orchestrator looks this policy up via the
// TaskTypeRegistry when a node's DagNodeDefinition.TransitionPolicy is
// nil. Nodes that carry their own TransitionPolicy in the definition take
// precedence.
var GalleryNodePolicy = &orchestrator.TransitionPolicy{
	Transitions: buildGalleryTransitions(),
	RetryPolicy: &orchestrator.RetryPolicy{
		MaxAttempts:     3,
		BackoffMs:       1000,
		BackoffStrategy: "exponential",
	},
	OnPause:   galleryOnPause,
	OnResume:  galleryOnResume,
	OnRestart: galleryOnRestart,
}

// skipVerify returns true when the node's Config explicitly opts out of
// the VERIFYING phase (e.g. finalize/extract nodes that have no
// side-effects to verify). When true, RUNNING transitions directly to
// COMPLETED, bypassing VERIFYING and the StateReconciler.
func skipVerify(ctx orchestrator.StateMachineContext, _ orchestrator.TransitionContext) bool {
	v, ok := ctx.Definition.Config["skipVerify"]
	if !ok {
		return false
	}
	b, _ := v.(bool)
	return b
}

// shouldVerify is the complement of skipVerify: true when the node
// should enter VERIFYING after RUNNING. It is the default guard on the
// RUNNING to VERIFYING rule.
func shouldVerify(ctx orchestrator.StateMachineContext, _ orchestrator.TransitionContext) bool {
	v, ok := ctx.Definition.Config["skipVerify"]
	if !ok {
		return true // default: verify
	}
	b, _ := v.(bool)
	return !b
}

// onEnterRunning records the execution start time so onExitRunning can
// accumulate the running duration. The value is stored in context.Extras
// (not persisted) for observability.
func onEnterRunning(ctx *orchestrator.StateMachineContext, _ orchestrator.TransitionContext) {
	if ctx.Extras == nil {
		ctx.Extras = make(map[string]any)
	}
	ctx.Extras["runningStartedAt"] = time.Now().UnixMilli()
}

// onExitRunning computes the running duration from the start time
// recorded by onEnterRunning and accumulates it. This complements the
// FSM's own AccumulatedDuration (which tracks time-in-state for all
// states) with a running-phase-specific metric.
func onExitRunning(ctx *orchestrator.StateMachineContext, _ orchestrator.TransitionContext) {
	if ctx.Extras == nil {
		return
	}
	started, ok := ctx.Extras["runningStartedAt"]
	if !ok {
		return
	}
	startMs, _ := started.(int64)
	if startMs == 0 {
		return
	}
	dur := time.Now().UnixMilli() - startMs
	prev, _ := ctx.Extras["runningDurationMs"].(int64)
	ctx.Extras["runningDurationMs"] = prev + dur
	delete(ctx.Extras, "runningStartedAt")
}

// galleryOnPause returns the state a gallery node should enter when the
// user pauses the DAG. Scrape nodes have no durable side-effects and
// can be re-scheduled immediately, so they go to READY (the scheduler
// picks them up on resume). Download nodes may have partial files on
// disk and should preserve their progress, so they go to PAUSED.
func galleryOnPause(ctx orchestrator.StateMachineContext) orchestrator.NodeState {
	if ctx.Definition.Phase == orchestrator.PhaseScrape {
		return orchestrator.NodeStateReady
	}
	return orchestrator.NodeStatePaused
}

// galleryOnResume returns the state a paused gallery node should enter
// when resumed. All phases go through READY so the scheduler re-queues
// them; download nodes benefit from the executor's checkpoint-aware
// resume logic.
func galleryOnResume(_ orchestrator.StateMachineContext) orchestrator.NodeState {
	return orchestrator.NodeStateReady
}

// galleryOnRestart decides the fate of a gallery node found in a
// non-terminal state after a service restart. All unfinished tasks go to
// PAUSED so the user decides when to resume them, with no auto-execution.
func galleryOnRestart(_ orchestrator.StateMachineContext) orchestrator.NodeState {
	return orchestrator.NodeStatePaused
}

// buildGalleryTransitions constructs the transition rule map for the
// gallery policy, adding guarded rules on top of the global
// validTransitions table:
//   - RUNNING to VERIFYING (guard: shouldVerify), the default verify path
//   - RUNNING to COMPLETED (guard: skipVerify), direct completion when
//     the node opts out of verification
//
// The remaining transitions (FAILED, TIMEOUT, CANCELLED, PAUSED from
// RUNNING etc.) are left to the global table via the policy's fallback
// behavior in transitionAllowedLocked.
func buildGalleryTransitions() map[orchestrator.NodeState][]orchestrator.TransitionRule {
	return map[orchestrator.NodeState][]orchestrator.TransitionRule{
		orchestrator.NodeStateRunning: {
			{
				From:   orchestrator.NodeStateRunning,
				To:     orchestrator.NodeStateVerifying,
				Guard:  shouldVerify,
				Action: onExitRunning,
			},
			{
				From:   orchestrator.NodeStateRunning,
				To:     orchestrator.NodeStateCompleted,
				Guard:  skipVerify,
				Action: onExitRunning,
			},
			{
				From:   orchestrator.NodeStateRunning,
				To:     orchestrator.NodeStateRunning,
				Action: onEnterRunning,
			},
		},
		orchestrator.NodeStateAllocated: {
			{
				From:   orchestrator.NodeStateAllocated,
				To:     orchestrator.NodeStateRunning,
				Action: onEnterRunning,
			},
		},
	}
}
