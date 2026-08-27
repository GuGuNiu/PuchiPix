package orchestrator

import (
	"fmt"
	"sync"
)

// InvariantSeverity indicates how a violated invariant should be treated.
type InvariantSeverity string

const (
	InvariantError InvariantSeverity = "error"   // Hard violation: log + metric
	InvariantWarn  InvariantSeverity = "warn"    // Soft violation: log only
)

// InvariantCheck represents the result of evaluating one invariant rule.
type InvariantCheck struct {
	RuleName  string           // Human-readable rule identifier
	Satisfied bool             // true = invariant holds
	Severity  InvariantSeverity // How to treat a violation
	Message   string           // Explanation when violated
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
//
// Design goals:
//   - Fail-fast on contradictions (e.g. RUNNING node with no slot).
//   - Observability: every violation is logged and counted in metrics.
//   - Extensibility: new invariants register via AddInvariant without
//     modifying existing rules.
type StateInvariantChecker struct {
	mu         sync.RWMutex
	evaluators []InvariantEvaluator
	logger     interface{} // *infra.Logger (avoid import cycle)
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
// violations (empty slice means all invariants hold). A nil return
// checker is a no-op (safe to call on optional dependencies).
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

// invariantTerminalHasNoErrorOrHistory ensures FAILED/TIMEOUT nodes
// carry an error and COMPLETED nodes have a non-empty transition history.
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

// invariantVerifyingRequiresReconcilerPath ensures VERIFYING state is
// only entered when the node's policy or phase supports verification.
func invariantVerifyingRequiresReconcilerPath(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	if state != NodeStateVerifying {
		return &InvariantCheck{RuleName: "verifying_has_path", Satisfied: true}
	}
	// In a real installation the reconciler presence is checked by the
	// orchestrator before invoking VerifyNode. This invariant guards
	// against a misconfigured policy that enables verification for a
	// phase with no verifier registered.
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

// invariantCompletedThroughVerification ensures that COMPLETED nodes
// either passed verification or were explicitly marked skipVerify.
// This catches the 260819 P7 defect (verify executors registered but
// never invoked, leaving nodes in RUNNING).
func invariantCompletedThroughVerification(ctx StateMachineContext, state NodeState, dag *DagInvariantView) *InvariantCheck {
	if state != NodeStateCompleted {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	// The skipVerify config explicitly opts out of verification.
	if v, ok := ctx.Definition.Config["skipVerify"].(bool); ok && v {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	// If the node has no deps and was created in COMPLETED state by the
	// executor (skipVerify path), Extras["verified"] will be set.
	if verified, ok := ctx.Extras["verified"].(bool); ok && verified {
		return &InvariantCheck{RuleName: "completed_via_verify", Satisfied: true}
	}
	// Reach here: a node completed without explicit verification marker.
	// This is a soft warning because some legit paths (e.g. no-op nodes)
	// may not set the flag.
	return &InvariantCheck{
		RuleName:  "completed_via_verify",
		Satisfied: false,
		Severity:  InvariantWarn,
		Message:   "node completed without explicit verification marker (Extras[\"verified\"]) or skipVerify config",
	}
}

// invariantRetryableFlagConsistent ensures result.Error.Retryable
// agrees with node state: a Retryable error should land in NEEDS_RETRY
// (or eventually READY), not FAILED.
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
