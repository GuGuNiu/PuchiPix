package orchestrator

import (
	"fmt"
	"sync"
	"time"

	"backend/internal/infra"
)

// maxHistoryLength caps the transition history stored per node to
// prevent unbounded memory growth in long-running DAGs.
const maxHistoryLength = 100

// StateMachineContext carries the runtime context for a node's state
// machine, including retry tracking and timing data.
type StateMachineContext struct {
	Definition          DagNodeDefinition
	RetryCount          int
	LastError           *NodeError
	EnteredAt           time.Time
	AccumulatedDuration int64
	Extras              map[string]any
}

// TaskStateMachine manages the state transitions of a single DAG node,
// enforcing the validTransitions table and recording history for
// audit and snapshot recovery.
//
// Strategy layer (260720 port): when a non-nil TransitionPolicy is
// supplied, Transition() first consults the policy's guards via
// resolveTargetState (which may redirect the target), validates against
// the policy's transition rules, then runs matching actions. When the
// policy is nil or has no matching rule, the FSM falls back to the
// global validTransitions table ??preserving backward compatibility.
type TaskStateMachine struct {
	mu        sync.Mutex
	state     NodeState
	nodeID    string
	dagID     string
	phase     TaskPhase
	context   StateMachineContext
	policy    *TransitionPolicy
	history   []StateTransitionRecord
	error     *NodeError
	enteredAt map[NodeState]time.Time
	logger    *infra.Logger
}

// NewTaskStateMachine creates a state machine starting in PENDING state,
// mirroring the TypeScript TaskStateMachine constructor. The optional
// policy parameter enables per-node transition differentiation; pass nil
// to use the global validTransitions table (backward compatible).
func NewTaskStateMachine(dagID, nodeID string, phase TaskPhase, def DagNodeDefinition) *TaskStateMachine {
	now := time.Now()
	fsm := &TaskStateMachine{
		state:  NodeStatePending,
		nodeID: nodeID,
		dagID:  dagID,
		phase:  phase,
		policy: def.TransitionPolicy,
		context: StateMachineContext{
			Definition:          def,
			RetryCount:          0,
			LastError:           nil,
			EnteredAt:           now,
			AccumulatedDuration: 0,
			Extras:              make(map[string]any),
		},
		enteredAt: make(map[NodeState]time.Time),
		logger:    infra.NewLogger("TaskStateMachine"),
	}
	fsm.enteredAt[NodeStatePending] = now
	return fsm
}

// SetPolicy attaches a TransitionPolicy to an existing FSM. Used during
// snapshot restore when the policy is looked up from the TaskTypeRegistry
// rather than carried in the DagNodeDefinition (which may have been
// persisted before the strategy layer existed).
func (fsm *TaskStateMachine) SetPolicy(p *TransitionPolicy) {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	fsm.policy = p
}

// Policy returns the installed TransitionPolicy, or nil.
func (fsm *TaskStateMachine) Policy() *TransitionPolicy {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	return fsm.policy
}

// State returns the current node state.
func (fsm *TaskStateMachine) State() NodeState {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	return fsm.state
}

// Error returns the last error recorded for this node, if any.
func (fsm *TaskStateMachine) Error() *NodeError {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	return fsm.error
}

// NodeID returns the node identifier.
func (fsm *TaskStateMachine) NodeID() string { return fsm.nodeID }

// DagID returns the DAG identifier.
func (fsm *TaskStateMachine) DagID() string { return fsm.dagID }

// Phase returns the task phase.
func (fsm *TaskStateMachine) Phase() TaskPhase { return fsm.phase }

// Context returns a snapshot of the state machine context.
func (fsm *TaskStateMachine) Context() StateMachineContext {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	return fsm.context
}

// ResetRetryCount clears the retry counter, allowing user-initiated
// retries to bypass maxAttempts limits.
func (fsm *TaskStateMachine) ResetRetryCount() {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	fsm.context.RetryCount = 0
}

// Transition attempts to move the node to the target state, enforcing
// the validTransitions table and recording the transition in history.
//
// Strategy layer (260720 port): when a non-nil policy is installed, the
// target state is first resolved through the policy's guards
// (resolveTargetState may redirect it), then validated against the
// policy's transition rules (falling back to validTransitions when the
// policy has no matching rule). After the transition, matching actions
// run via runActions.
func (fsm *TaskStateMachine) Transition(toState NodeState, ctx TransitionContext) error {
	fsm.mu.Lock()

	fromState := fsm.state
	resolvedTo := toState

	// Strategy layer: policy guards may redirect the target state.
	if fsm.policy != nil {
		resolvedTo = fsm.resolveTargetStateLocked(fromState, toState, ctx)
		if resolvedTo != toState {
			fsm.logger.Info(fmt.Sprintf("Node %s transition redirected by policy guard: %s -> %s (original target %s)", fsm.nodeID, fromState, resolvedTo, toState))
		}
	}

	// Validate the (possibly redirected) transition. Policy transitions
	// take precedence when present; otherwise fall back to the global
	// validTransitions table.
	if !fsm.transitionAllowedLocked(fromState, resolvedTo) {
		fsm.mu.Unlock()
		return fmt.Errorf("%w: node %s from %s to %s", ErrIllegalTransition, fsm.nodeID, fromState, resolvedTo)
	}

	now := time.Now()
	record := StateTransitionRecord{
		NodeID:    fsm.nodeID,
		DagID:     fsm.dagID,
		From:      fromState,
		To:        resolvedTo,
		Timestamp: now,
		Context:   ctx,
	}
	fsm.history = append(fsm.history, record)
	if len(fsm.history) > maxHistoryLength {
		fsm.history = fsm.history[len(fsm.history)-maxHistoryLength:]
	}

	prevState := fromState
	if prevEntered, ok := fsm.enteredAt[prevState]; ok {
		fsm.context.AccumulatedDuration += now.UnixMilli() - prevEntered.UnixMilli()
	}

	fsm.state = resolvedTo
	fsm.enteredAt[resolvedTo] = now
	fsm.context.EnteredAt = now

	if resolvedTo == NodeStateFailed || resolvedTo == NodeStateTimeout {
		fsm.error = ctx.Error
		fsm.context.LastError = ctx.Error
	}

	if (prevState == NodeStateFailed || prevState == NodeStateTimeout) && resolvedTo == NodeStateReady {
		fsm.context.RetryCount++
	}

	// Strategy layer: run matching actions under the lock so they can
	// safely mutate context.Extras / timing fields.
	if fsm.policy != nil {
		fsm.runActionsLocked(prevState, resolvedTo, ctx)
	}

	fsm.logger.Info(fmt.Sprintf("Node %s state transition: %s -> %s (%s)", fsm.nodeID, prevState, resolvedTo, ctx.Reason))

	fsm.mu.Unlock()
	return nil
}

// resolveTargetStateLocked consults the policy's transition rules for
// the target state and applies the first matching guard. If a guard
// rejects the transition, the rule's Fallback state is returned (when
// set); otherwise the original target is kept. Caller must hold fsm.mu.
func (fsm *TaskStateMachine) resolveTargetStateLocked(from, to NodeState, event TransitionContext) NodeState {
	if fsm.policy == nil || fsm.policy.Transitions == nil {
		return to
	}
	rules, ok := fsm.policy.Transitions[from]
	if !ok {
		return to
	}
	for _, rule := range rules {
		if rule.To != to {
			continue
		}
		if rule.Guard == nil || rule.Guard(fsm.context, event) {
			return to // guard passed (or no guard)
		}
		// Guard rejected ??redirect to fallback if set.
		if rule.Fallback != "" {
			return rule.Fallback
		}
		return to // no fallback: keep target, let validation reject it
	}
	return to // no matching rule: keep target, fall back to global validation
}

// transitionAllowedLocked checks whether a transition is permitted,
// consulting the policy's transition rules first (if present) and
// falling back to the global validTransitions table. Caller must hold
// fsm.mu.
func (fsm *TaskStateMachine) transitionAllowedLocked(from, to NodeState) bool {
	if fsm.policy != nil && fsm.policy.Transitions != nil {
		if rules, ok := fsm.policy.Transitions[from]; ok {
			for _, rule := range rules {
				if rule.To == to {
					return true
				}
			}
			// Policy defined transitions for this source state but none
			// match the target. We still allow the global table to permit
			// it ??this keeps backward compatibility for transitions that
			// the policy didn't explicitly enumerate (e.g. CANCELLED from
			// any state). Only when the policy explicitly wants to deny
			// should it omit the rule AND rely on guard rejection.
		}
	}
	return CanTransition(from, to)
}

// runActionsLocked invokes the action (if any) attached to the matching
// transition rule, plus any onEnter/onExit semantics captured by the rule.
// Caller must hold fsm.mu.
func (fsm *TaskStateMachine) runActionsLocked(from, to NodeState, event TransitionContext) {
	if fsm.policy == nil || fsm.policy.Transitions == nil {
		return
	}
	rules, ok := fsm.policy.Transitions[from]
	if !ok {
		return
	}
	for _, rule := range rules {
		if rule.To == to && rule.Action != nil {
			rule.Action(&fsm.context, event)
		}
	}
}

// CanTransitionTo checks whether a transition to the target state is
// valid from the current state.
func (fsm *TaskStateMachine) CanTransitionTo(toState NodeState) bool {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	return CanTransition(fsm.state, toState)
}

// GetHistory returns a copy of the transition history.
func (fsm *TaskStateMachine) GetHistory() []StateTransitionRecord {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()
	out := make([]StateTransitionRecord, len(fsm.history))
	copy(out, fsm.history)
	return out
}

// RestoreFromSnapshot replaces the state machine's history and error
// from a persisted snapshot, used during service restart recovery.
func (fsm *TaskStateMachine) RestoreFromSnapshot(history []StateTransitionRecord, nodeErr *NodeError) {
	fsm.mu.Lock()
	defer fsm.mu.Unlock()

	if len(history) > maxHistoryLength {
		fsm.history = make([]StateTransitionRecord, len(history))
		copy(fsm.history, history[len(history)-maxHistoryLength:])
	} else {
		fsm.history = make([]StateTransitionRecord, len(history))
		copy(fsm.history, history)
	}
	fsm.error = nodeErr

	fsm.enteredAt = make(map[NodeState]time.Time)
	for _, record := range fsm.history {
		fsm.enteredAt[record.To] = record.Timestamp
	}

	if len(fsm.history) == 0 {
		fsm.enteredAt[fsm.state] = time.Now()
	} else {
		// Restore the current state from the most recent transition's
		// target. Without this the FSM would remain in its initial
		// PENDING state regardless of the snapshotted progress, making
		// restored nodes impossible to drive forward.
		fsm.state = fsm.history[len(fsm.history)-1].To
	}

	fsm.context.LastError = nodeErr
	fsm.context.RetryCount = 0
	for _, record := range fsm.history {
		if (record.From == NodeStateFailed || record.From == NodeStateTimeout) && record.To == NodeStateReady {
			fsm.context.RetryCount++
		}
	}
	if entered, ok := fsm.enteredAt[fsm.state]; ok {
		fsm.context.EnteredAt = entered
	} else {
		fsm.context.EnteredAt = time.Now()
	}
}

// MapNodeStateToDBStatus converts a node state and phase to the
// database status string used by the Gallery/DownloadTask models.
func MapNodeStateToDBStatus(state NodeState, phase TaskPhase) string {
	switch state {
	case NodeStatePending:
		return "pending"
	case NodeStateReady, NodeStateQueued:
		if phase == PhaseDownload {
			return "download_pending"
		}
		return "scrape_pending"
	case NodeStateAllocated, NodeStateRunning:
		if phase == PhaseScrape {
			return "scraping"
		}
		return "downloading"
	case NodeStatePaused:
		return "paused"
	case NodeStateVerifying, NodeStateResumeVerify:
		if phase == PhaseDownload {
			return "downloading"
		}
		return "scraping"
	case NodeStateCompleted:
		return "completed"
	case NodeStateFailed:
		return "failed"
	case NodeStateCancelled:
		return "cancelled"
	case NodeStateTimeout:
		return "failed"
	case NodeStateNeedsRetry:
		return "needs_retry"
	default:
		return "pending"
	}
}

// AggregateTaskStatus computes the aggregate status of a DAG from its
// node states, implementing the 260720 fix priority ordering.
//
// Priority order (highest first):
//  1. Cancelled (terminal, overrides everything)
//  2. Failed (non-retryable terminal)
//  3. Timeout (treated as failed)
//  4. NeedsRetry (retryable failure, not terminal)
//  5. Paused
//  6. All completed
//  7. Pending (default)
func AggregateTaskStatus(taskType TaskType, nodes []NodeSnapshotInfo) string {
	if len(nodes) == 0 {
		return "pending"
	}

	hasCancelled := false
	hasFailed := false
	hasTimeout := false
	hasNeedsRetry := false
	hasPaused := false
	allCompleted := true

	for _, n := range nodes {
		switch n.State {
		case NodeStateCancelled:
			hasCancelled = true
			allCompleted = false
		case NodeStateFailed:
			// NonCritical failures count as "completed" for aggregate status,
			// allowing the DAG to succeed despite best-effort node failures.
			if n.NonCritical {
				// Treat as completed
			} else {
				hasFailed = true
				allCompleted = false
			}
		case NodeStateTimeout:
			if n.NonCritical {
				// Treat as completed
			} else {
				hasTimeout = true
				allCompleted = false
			}
		case NodeStateNeedsRetry:
			if !n.NonCritical {
				hasNeedsRetry = true
			}
			allCompleted = false
		case NodeStatePaused:
			hasPaused = true
			allCompleted = false
		case NodeStateCompleted:
		default:
			allCompleted = false
		}
	}

	if hasCancelled {
		return "cancelled"
	}
	if hasFailed {
		if taskType == TaskTypeGallery {
			for _, n := range nodes {
				if n.Phase == PhaseScrape && n.State == NodeStateFailed && n.Error != nil && n.Error.Code == "NOT_FOUND" {
					return "not_found"
				}
			}
		}
		return "failed"
	}
	if hasTimeout {
		return "failed"
	}
	if hasNeedsRetry {
		return "needs_retry"
	}
	if hasPaused {
		return "paused"
	}
	if allCompleted {
		return "completed"
	}
	return "pending"
}

// NodeSnapshotInfo is a lightweight view of a node used by the
// aggregate status computation, avoiding full state machine copies.
type NodeSnapshotInfo struct {
	State       NodeState
	Phase       TaskPhase
	Error       *NodeError
	NonCritical bool
}
