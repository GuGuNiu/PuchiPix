package orchestrator

import (
	"fmt"
	"sync"
)

// InvariantSeverity indicates how a violated invariant should be treated.
type InvariantSeverity string

const (
	InvariantError InvariantSeverity = "error" // Hard violation: log + metric
	InvariantWarn  InvariantSeverity = "warn"  // Soft violation: log only
)

// InvariantCheck represents the result of evaluating one invariant rule.
type InvariantCheck struct {
	RuleName  string
	Satisfied bool
	Severity  InvariantSeverity
	Message   string
}

// InvariantEvaluator is a pure predicate that validates one aspect of
// state-machine consistency. It receives the node's FSM context, the
// current state, and the DAG-level snapshot (if available). Evaluators
// must be side-effect free so they can be unit-tested in isolation.
type InvariantEvaluator func(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck

// DagInvariantView is the subset of DAG-level data an invariant rule
// can inspect. Using a view struct prevents invariants from mutating
// DAG state and keeps the dependency surface explicit.
type DagInvariantView struct {
	DagID       string
	TaskType    TaskType
	AllTerminal bool
	Nodes       []NodeSnapshotInfo
}

// StateInvariantChecker validates post-transition invariants. It runs
// after every Transition call to detect silent divergence between the
// FSM state and the broader system (DB, slot pool, executor state).
type StateInvariantChecker struct {
	mu             sync.RWMutex
	evaluators     []InvariantEvaluator
	logger         interface{} // *infra.Logger (avoid import cycle)
	violationCount map[string]int64
}

// NewStateInvariantChecker creates a checker with the default rule set.
func NewStateInvariantChecker() *StateInvariantChecker {
	c := &StateInvariantChecker{
		violationCount: make(map[string]int64),
	}
	c.registerDefaults()
	return c
}

// AddInvariant appends a custom evaluator to the rule chain. Invariants
// run in registration order; all run regardless of individual failures
// (no short-circuit) so a single transition can surface multiple issues.
func (c *StateInvariantChecker) AddInvariant(eval InvariantEvaluator) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evaluators = append(c.evaluators, eval)
}

// Check runs every registered invariant and returns the list of
// violations (an empty slice means all invariants hold). A nil receiver
// is a no-op, so call sites with an optional dependency need no guard.
func (c *StateInvariantChecker) Check(ctx StateMachineContext, state NodeState, dag *DagInvariantView) []InvariantCheck {
	if c == nil {
		return nil
	}
	c.mu.RLock()
	evaluators := make([]InvariantEvaluator, len(c.evaluators))
	copy(evaluators, c.evaluators)
	c.mu.RUnlock()

	var violations []InvariantCheck
	for _, eval := range evaluators {
		result := eval(ctx, state, dag)
		if result == nil {
			continue
		}
		if !result.Satisfied {
			c.mu.Lock()
			c.violationCount[result.RuleName]++
			c.mu.Unlock()
			violations = append(violations, *result)
		}
	}
	return violations
}

// ViolationCount returns how many times each rule has been violated
// since startup, useful for alert dashboards.
func (c *StateInvariantChecker) ViolationCount() map[string]int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]int64, len(c.violationCount))
	for k, v := range c.violationCount {
		out[k] = v
	}
	return out
}

// registerDefaults installs the built-in invariant rules. Each rule is
// a standalone function named invariantXxx for grep-ability.
func (c *StateInvariantChecker) registerDefaults() {
	c.evaluators = []InvariantEvaluator{
		invariantTerminalHasNoErrorOrHistory,
		invariantVerifyingRequiresReconcilerPath,
		invariantCompletedThroughVerification,
		invariantRetryableFlagConsistent,
	}
}

// invariantTerminalHasNoErrorOrHistory flags FAILED/TIMEOUT nodes with
// no error, and COMPLETED nodes that show no sign of ever having run.
func invariantTerminalHasNoErrorOrHistory(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	switch state {
	case NodeStateFailed, NodeStateTimeout:
		if ctx.LastError == nil {
			return &InvariantCheck{
				RuleName:  "terminal_has_error",
				Satisfied: false,
				Severity:  InvariantError,
				Message:   fmt.Sprintf("node in %s state but LastError is nil", state),
			}
		}
	case NodeStateCompleted:
		// A COMPLETED node that jumped directly from PENDING (no history)
		// signals a bypass of the normal lifecycle.
		if len(ctx.Definition.Dependencies) > 0 && ctx.AccumulatedDuration == 0 {
			return &InvariantCheck{
				RuleName:  "completed_has_duration",
				Satisfied: false,
				Severity:  InvariantWarn,
				Message:   "node completed with zero accumulated duration (possible bypass)",
			}
		}
	}
	return &InvariantCheck{RuleName: "terminal_has_error", Satisfied: true}
}

func invariantVerifyingRequiresReconcilerPath(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	if state != NodeStateVerifying {
		return &InvariantCheck{RuleName: "verifying_has_path", Satisfied: true}
	}
	// The reconciler rejects unsupported phases before verification starts,
	// so this rule only flags a misconfigured policy that enables
	// verification for a phase with no verifier.
	if ctx.Definition.Phase != PhaseScrape && ctx.Definition.Phase != PhaseDownload {
		return &InvariantCheck{
			RuleName:  "verifying_has_path",
			Satisfied: false,
			Severity:  InvariantWarn,
			Message:   fmt.Sprintf("node in VERIFYING state for phase %q (no verifier registered)", ctx.Definition.Phase),
		}
	}
	return &InvariantCheck{RuleName: "verifying_has_path", Satisfied: true}
}

// invariantCompletedThroughVerification requires a COMPLETED node to carry
// a verification marker or an explicit skipVerify, catching executors that
// are registered but never invoked and leave the node in RUNNING.
func invariantCompletedThroughVerification(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	if state != NodeStateCompleted {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	if v, ok := ctx.Definition.Config["skipVerify"].(bool); ok && v {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	// Executors that skip verification still mark the context, so a node
	// created directly in COMPLETED carries Extras["verified"].
	if verified, ok := ctx.Extras["verified"].(bool); ok && verified {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	// A soft warning because no-op nodes legitimately leave the flag unset.
	return &InvariantCheck{
		RuleName:  "completed_via_verify",
		Satisfied: false,
		Severity:  InvariantWarn,
		Message:   "node completed without explicit verification marker (Extras[\"verified\"]) or skipVerify config",
	}
}

// invariantRetryableFlagConsistent flags a FAILED node whose error is
// marked Retryable: that node should have landed in NEEDS_RETRY (or
// eventually READY) instead.
func invariantRetryableFlagConsistent(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	if state != NodeStateFailed {
		return &InvariantCheck{RuleName: "retryable_consistent", Satisfied: true}
	}
	if ctx.LastError != nil && ctx.LastError.Retryable {
		return &InvariantCheck{
			RuleName:  "retryable_consistent",
			Satisfied: false,
			Severity:  InvariantError,
			Message:   fmt.Sprintf("node FAILED but error is retryable: %s", ctx.LastError.Code),
		}
	}
	return &InvariantCheck{RuleName: "retryable_consistent", Satisfied: true}
}
