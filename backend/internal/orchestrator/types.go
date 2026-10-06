package orchestrator

import (
	"errors"
	"time"
)

// NodeState represents the lifecycle stage of a single DAG node.
type NodeState string

const (
	NodeStatePending      NodeState = "pending"
	NodeStatePreparing    NodeState = "preparing"
	NodeStateReady        NodeState = "ready"
	NodeStateQueued       NodeState = "queued"
	NodeStateAllocated    NodeState = "allocated"
	NodeStateRunning      NodeState = "running"
	NodeStatePaused       NodeState = "paused"
	NodeStateVerifying    NodeState = "verifying"
	NodeStateResumeVerify NodeState = "resume_verify"
	NodeStateCompleted    NodeState = "completed"
	NodeStateFailed       NodeState = "failed"
	NodeStateCancelled    NodeState = "cancelled"
	NodeStateTimeout      NodeState = "timeout"
	NodeStateNeedsRetry   NodeState = "needs_retry"
)

// validTransitions defines the legal state transitions for each NodeState.
// PENDING/READY/QUEUED allow FAILED for dependency-failure cascades so the
// DAG converges to a terminal state instead of stranding successors forever.
//
// PREPARING is a transient intermediate state inserted between terminal/error
// states and READY/RUNNING. It signals that the system is actively preparing
// resources (e.g., re-establishing connections, validating slots, restoring
// state after restart) before the node can actually run. This gives the UI
// an immediate optimistic "preparing" signal instead of an opaque gap.
var validTransitions = map[NodeState][]NodeState{
	NodeStatePending:      {NodeStatePreparing, NodeStateReady, NodeStateCancelled, NodeStateFailed},
	NodeStatePreparing:    {NodeStateReady, NodeStateRunning, NodeStatePaused, NodeStateFailed, NodeStateCancelled},
	NodeStateReady:        {NodeStateQueued, NodeStateCancelled, NodeStatePaused, NodeStateNeedsRetry, NodeStateFailed},
	NodeStateQueued:       {NodeStateAllocated, NodeStateCancelled, NodeStatePaused, NodeStateReady, NodeStateFailed},
	NodeStateAllocated:    {NodeStateRunning, NodeStateCancelled, NodeStatePaused, NodeStateFailed},
	// RUNNING allows NEEDS_RETRY so a scheduler-flagged verify-phase retry
	// (executor returns NeedsRetryError) can re-queue instead of silently
	// no-opping and waiting for the zombie sweep.
	NodeStateRunning:      {NodeStateVerifying, NodeStateFailed, NodeStateTimeout, NodeStateCancelled, NodeStatePaused, NodeStateCompleted, NodeStateNeedsRetry},
	NodeStatePaused:       {NodeStatePreparing, NodeStateReady, NodeStateCancelled},
	NodeStateVerifying:    {NodeStateCompleted, NodeStateFailed, NodeStatePaused, NodeStateResumeVerify, NodeStateNeedsRetry},
	NodeStateResumeVerify: {NodeStateVerifying, NodeStateCompleted, NodeStateFailed, NodeStatePaused},
	NodeStateCompleted:    {},
	NodeStateFailed:       {NodeStatePreparing, NodeStateReady, NodeStateNeedsRetry},
	NodeStateNeedsRetry:   {NodeStatePreparing, NodeStateReady, NodeStatePaused},
	NodeStateCancelled:    {},
	NodeStateTimeout:      {NodeStatePreparing, NodeStateReady},
}

// CanTransition checks whether a transition from one state to another
// is permitted by the static transition table.
func CanTransition(from, to NodeState) bool {
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// IsTerminalState reports whether a state has no outgoing transitions,
// meaning the node has reached a final disposition.
func IsTerminalState(state NodeState) bool {
	transitions, ok := validTransitions[state]
	if !ok {
		return true
	}
	return len(transitions) == 0
}

// IsDeletableState reports whether a node state allows DAG deletion.
// Unlike IsTerminalState, this also includes states that are effectively
// final for cleanup purposes (failed, timeout) even though they technically
// allow retry transitions. This lets users clean up failed DAGs without
// requiring an explicit cancel first.
func IsDeletableState(state NodeState) bool {
	if IsTerminalState(state) {
		return true
	}
	switch state {
	case NodeStateFailed, NodeStateTimeout:
		return true
	}
	return false
}

// TaskType identifies the category of work a DAG performs, determining
// which aggregator and executors are used.
type TaskType string

const (
	TaskTypeGallery TaskType = "gallery"
	TaskTypeVideo   TaskType = "video"
	TaskTypeSniff   TaskType = "sniff"
)

// TaskPhase identifies the stage within a task's lifecycle, used to
// map node states to database status strings.
type TaskPhase string

const (
	PhaseCreate   TaskPhase = "create"
	PhaseScrape   TaskPhase = "scrape"
	PhaseDownload TaskPhase = "download"
	PhaseFinalize TaskPhase = "finalize"
)

// TaskPriority controls scheduling order when multiple nodes compete
// for the same resource pool.
type TaskPriority int

const (
	PriorityBatch    TaskPriority = 1
	PriorityLow      TaskPriority = 3
	PriorityNormal   TaskPriority = 5
	PriorityHigh     TaskPriority = 8
	PriorityCritical TaskPriority = 10
)

// DagState represents the aggregate lifecycle of a DAG instance.
type DagState string

const (
	DagStatePending   DagState = "pending"
	DagStateRunning   DagState = "running"
	DagStatePaused    DagState = "paused"
	DagStateCompleted DagState = "completed"
	DagStateFailed    DagState = "failed"
)

// ResourceRequirement declares how many slots of a given type a node
// needs and when those slots should be released.
type ResourceRequirement struct {
	SlotType  string `json:"slotType"`
	Count     int    `json:"count"`
	HoldUntil string `json:"holdUntil"`
}

// SlotUsage reports the current occupancy of a slot type.
type SlotUsage struct {
	SlotType  string `json:"slotType"`
	Current   int    `json:"current"`
	Max       int    `json:"max"`
	Available int    `json:"available"`
}

// NodeError carries structured failure information so callers can
// distinguish retryable errors from terminal ones.
type NodeError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// TransitionContext captures why a state transition happened and who
// initiated it, providing an audit trail for every node state change.
type TransitionContext struct {
	Reason      string     `json:"reason"`
	TriggeredBy string     `json:"triggeredBy"`
	Error       *NodeError `json:"error,omitempty"`
}

// DagNodeDefinition declares a single node within a DAG, including its
// dependencies, resource needs, and executor routing key.
type DagNodeDefinition struct {
	ID                   string                `json:"id"`
	TaskType             TaskType              `json:"taskType"`
	Phase                TaskPhase             `json:"phase"`
	Dependencies         []string              `json:"dependencies"`
	ResourceRequirements []ResourceRequirement `json:"resourceRequirements"`
	Executor             string                `json:"executor"`
	Config               map[string]any        `json:"config"`
	Priority             TaskPriority          `json:"priority"`
	Timeout              int                   `json:"timeout,omitempty"`
	MaxRetries           int                   `json:"maxRetries,omitempty"`
	RetryDelay           int                   `json:"retryDelay,omitempty"`
	// NonCritical marks a node whose failure should not cascade to its
	// dependents. When a NonCritical node fails, its direct successors
	// are still activated (the failed dep counts as "completed"). The
	// DAG is not marked as FAILED due solely to NonCritical failures.
	NonCritical bool `json:"nonCritical,omitempty"`
	// TransitionPolicy overrides the global validTransitions table. When nil,
	// the FSM falls back to validTransitions.
	TransitionPolicy *TransitionPolicy `json:"transitionPolicy,omitempty"`
}

// RetryPolicy declares the retry behavior for a node when it fails.
type RetryPolicy struct {
	// MaxAttempts is the maximum number of automatic retries before the
	// node is left in FAILED state. 0 means no automatic retry.
	MaxAttempts int `json:"maxAttempts"`
	// BackoffMs is the base backoff in milliseconds between retries.
	// When BackoffStrategy is "exponential", the actual delay is
	// BackoffMs * 2^(retryCount-1).
	BackoffMs int64 `json:"backoffMs"`
	// BackoffStrategy is either "fixed" or "exponential" (default
	// "exponential" when empty).
	BackoffStrategy string `json:"backoffStrategy,omitempty"`
}

// GuardFn is a pure predicate that decides whether a transition is
// permitted given the current state-machine context and the transition
// context (reason/triggeredBy/error). Guards must be side-effect free so
// they can be unit-tested in isolation and evaluated multiple times
// without observable effects. A guard returning false causes
// resolveTargetState to redirect to the rule's Fallback state (or to keep
// the original target if no Fallback is set).
type GuardFn func(ctx StateMachineContext, event TransitionContext) bool

// ActionFn is a side-effect callback invoked after a transition completes.
// It receives a pointer to the StateMachineContext so it can mutate
// context fields (e.g. record timing, clear errors). Actions must not
// block on I/O; they run under the FSM's mutex.
type ActionFn func(ctx *StateMachineContext, event TransitionContext)

// TransitionRule declares one permitted transition in a policy. When the
// FSM is in From and asked to move to To, the Guard (if non-nil) is
// evaluated; if it returns false the FSM redirects to Fallback (when
// non-empty) or rejects the transition. After the transition the Action
// (if non-nil) runs.
type TransitionRule struct {
	From     NodeState
	To       NodeState
	Guard    GuardFn
	Action   ActionFn
	Fallback NodeState // redirect target when Guard rejects; zero value means "reject"
}

// TransitionPolicy layers on top of the global validTransitions table,
// enabling config-driven state-machine differentiation. When nil, the FSM
// falls back to validTransitions.
type TransitionPolicy struct {
	// Transitions maps a source state to the list of rules originating
	// from it. A rule with To == target and Guard passing (or nil Guard)
	// permits the transition.
	Transitions map[NodeState][]TransitionRule
	// RetryPolicy governs automatic retry on failure. When nil, the node
	// definition's MaxRetries acts as the automatic needs_retry budget
	// (see dag.DagOrchestrator.verifyRetryLimit); user-initiated retries
	// reset the counter and stay unlimited by design.
	RetryPolicy *RetryPolicy
	// OnPause returns the state a node should enter when the user pauses
	// the DAG. Returning "" means "use default PAUSED". This lets scrape
	// nodes (no side effects) return READY for immediate re-scheduling
	// while download nodes (partial files) return PAUSED.
	OnPause func(ctx StateMachineContext) NodeState
	// OnResume returns the state a paused node should enter when resumed.
	// Returning "" means "use default READY".
	OnResume func(ctx StateMachineContext) NodeState
	// OnRestart decides the fate of a node found in RUNNING or VERIFYING
	// state after a service restart. Returning "" means "use default
	// (READY for RUNNING, FAILED for VERIFYING)". Returning RESUME_VERIFY
	// enables checkpoint-based recovery.
	OnRestart func(ctx StateMachineContext) NodeState
}

// DagDefinition is the blueprint for a DAG, containing its nodes and
// metadata describing the source of the work.
type DagDefinition struct {
	ID       string              `json:"id"`
	TaskType TaskType            `json:"taskType"`
	Nodes    []DagNodeDefinition `json:"nodes"`
	Metadata DagMetadata         `json:"metadata"`
}

// DagMetadata carries origin information about a DAG for logging and
// debugging without polluting the node-level definitions.
type DagMetadata struct {
	SourceURL  string    `json:"sourceUrl"`
	ProviderID string    `json:"providerId,omitempty"`
	UserID     string    `json:"userId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	// SlotLimits declares task-level slot quotas: the maximum number of
	// slots of each type (e.g. {"download": 2, "scraping": 1}) this task
	// may occupy simultaneously, strictly bounding its concurrency
	// regardless of the global per-type max. Empty means "no task-level
	// cap" (global limits apply). Read at SubmitDag time and enforced by
	// the slot pool for every node of the DAG.
	SlotLimits map[string]int `json:"slotLimits,omitempty"`
}

// SchedulableNode is the envelope passed to the scheduler when a node
// becomes ready for execution, carrying everything the scheduler and
// executor need to run the node.
type SchedulableNode struct {
	NodeID               string                `json:"nodeId"`
	DagID                string                `json:"dagId"`
	TaskType             TaskType              `json:"taskType"`
	Phase                TaskPhase             `json:"phase"`
	ExecutorKey          string                `json:"executorKey"`
	Priority             TaskPriority          `json:"priority"`
	ResourceRequirements []ResourceRequirement `json:"resourceRequirements"`
	Config               map[string]any        `json:"config"`
	SubmittedAt          time.Time             `json:"submittedAt"`
	// TimeoutMs carries DagNodeDefinition.Timeout (milliseconds) to the
	// scheduler so it can enforce per-node execution deadlines; 0
	// disables enforcement.
	TimeoutMs int `json:"timeoutMs,omitempty"`
	// NonCritical marks a node whose failure should not cascade to its
	// dependents or cause the DAG to fail.
	NonCritical bool `json:"nonCritical,omitempty"`
}

// NodeExecutionResult is returned by an executor after a node runs,
// indicating success or structured failure.
type NodeExecutionResult struct {
	Success bool           `json:"success"`
	Data    map[string]any `json:"data,omitempty"`
	Error   *NodeError     `json:"error,omitempty"`
}

// NodeProgress reports incremental execution progress for real-time UI.
type NodeProgress struct {
	NodeID  string    `json:"nodeId"`
	Phase   TaskPhase `json:"phase"`
	Current int       `json:"current"`
	Total   int       `json:"total"`
	Speed   string    `json:"speed,omitempty"`
	Failed  int       `json:"failed,omitempty"`
}

// StateTransitionRecord logs a single state change for audit and replay.
type StateTransitionRecord struct {
	NodeID    string            `json:"nodeId"`
	DagID     string            `json:"dagId"`
	From      NodeState         `json:"from"`
	To        NodeState         `json:"to"`
	Timestamp time.Time         `json:"timestamp"`
	Context   TransitionContext `json:"context"`
}

// NodeSnapshot captures a node's state at snapshot time for persistence
// and fast recovery.
type NodeSnapshot struct {
	NodeID  string                  `json:"nodeId"`
	State   NodeState               `json:"state"`
	Error   *NodeError              `json:"error"`
	History []StateTransitionRecord `json:"history"`
	Result  *NodeExecutionResult    `json:"result"`
}

// DagSnapshot captures an entire DAG's state for persistence.
type DagSnapshot struct {
	DagID      string         `json:"dagId"`
	Definition DagDefinition  `json:"definition"`
	NodeStates []NodeSnapshot `json:"nodeStates"`
	CreatedAt  time.Time      `json:"createdAt"`
}

// DagEvent is an append-only event in the event sourcing log, enabling
// state reconstruction by replaying events from a snapshot.
type DagEvent struct {
	Seq       int64          `json:"seq"`
	Type      string         `json:"type"`
	DagID     string         `json:"dagId"`
	NodeID    string         `json:"nodeId,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
	Payload   map[string]any `json:"payload"`
}

// VerificationResult is returned by the StateReconciler after checking
// whether a node's side effects are consistent with its state.
type VerificationResult struct {
	Status    string `json:"status"`
	Corrected int    `json:"corrected"`
	Reason    string `json:"reason"`
}

// SchedulerStats summarizes the scheduler's queue composition.
type SchedulerStats struct {
	QueueSize  int            `json:"queueSize"`
	ByPriority map[string]int `json:"byPriority"`
	ByTaskType map[string]int `json:"byTaskType"`
	Strategy   string         `json:"strategy"`
}

// DagOrchestratorStats reports aggregate DAG counts for monitoring.
type DagOrchestratorStats struct {
	TotalDags int `json:"totalDags"`
	// ActiveDags counts DAGs with at least one non-terminal, non-paused
	// node (truly running). DAGs whose only non-terminal nodes are paused
	// are reported in PausedDags instead.
	ActiveDags int `json:"activeDags"`
	PausedDags int `json:"pausedDags"`
	TotalNodes int `json:"totalNodes"`
}

// ErrIllegalTransition is returned when a state transition violates
// the validTransitions table, preventing corrupt state machines.
var ErrIllegalTransition = errors.New("illegal state transition")

// Error codes carried by NodeError for classification-sensitive outcomes.
// EXECUTION_TIMEOUT marks a run the scheduler supervisor ended at its
// deadline, so OnNodeCompleted can land the node in TIMEOUT (instead of
// FAILED) and the transition table's timeout edges stay reachable.
const (
	ErrorCodeExecutionFailed  = "EXECUTION_FAILED"
	ErrorCodeExecutionTimeout = "EXECUTION_TIMEOUT"
)

// ErrDagNotFound is returned when a DAG ID does not match any known DAG.
var ErrDagNotFound = errors.New("DAG not found")

// ErrNodeNotFound is returned when a node ID does not match any node
// within the specified DAG.
var ErrNodeNotFound = errors.New("node not found")

// ErrNodeAlreadyTerminal is returned by OnNodeCompleted when a
// completion event arrives after the node has already reached a terminal
// state via another path (pause, cancel, restart). The caller should
// treat this as a benign duplicate and discard the event.
var ErrNodeAlreadyTerminal = errors.New("node already in terminal state")
