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

// NewTaskStateMachine creates a state machine starting in PENDING state.
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
func (fsm *TaskStateMachine) Transition(toState NodeState, ctx TransitionContext) error {
	fsm.mu.Lock()

	fromState := fsm.state
	resolvedTo := toState

	if fsm.policy != nil {
		resolvedTo = fsm.resolveTargetStateLocked(fromState, toState, ctx)
		if resolvedTo != toState {
			fsm.logger.Info(fmt.Sprintf("Node %s transition redirected by policy guard: %s -> %s (original target %s)", fsm.nodeID, fromState, resolvedTo, toState))
		}
	}

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
			return to
		}
		if rule.Fallback != "" {
			return rule.Fallback
		}
		return to
	}
	return to
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
		// No matching rule in the policy; fall back to the global table.
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

// AggregateTaskStatus computes the aggregate status of a DAG from its
// node states. Priority order: cancelled, failed, timeout, needs_retry,
// paused, all completed, pending.
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
			if !n.NonCritical {
				hasFailed = true
				allCompleted = false
			}
		case NodeStateTimeout:
			if !n.NonCritical {
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
