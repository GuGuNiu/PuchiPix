package orchestrator

import (
	"sync"
)

// AggregatorFn computes the aggregate DAG status string (e.g.
// "completed", "failed", "needs_retry", "paused", "pending") from a
// slice of node snapshots. It mirrors the signature of the existing
// AggregateTaskStatus function, which remains the default gallery
// aggregator.
type AggregatorFn func(taskType TaskType, nodes []NodeSnapshotInfo) string

// TaskTypeRegistry maps a TaskType to its aggregator function and
// optional TransitionPolicy. New TaskTypes register via
// RegisterAggregator / RegisterTransitionPolicy instead of modifying
// hardcoded switch statements ??satisfying the open-closed principle
// identified as missing in audit item P4.
//
// Lookup order in AggregateTaskStatus / DagOrchestrator:
//  1. registry.GetAggregator(taskType) ??if registered, use it
//  2. default gallery aggregator (the existing AggregateTaskStatus
//     logic) ??fallback for unregistered TaskTypes
//
// Similarly for policies: registry.GetTransitionPolicy(taskType) returns
// the policy to install on nodes whose DagNodeDefinition.TransitionPolicy
// is nil (e.g. definitions persisted before the strategy layer existed).
type TaskTypeRegistry struct {
	mu          sync.RWMutex
	aggregators map[TaskType]AggregatorFn
	policies    map[TaskType]*TransitionPolicy
}

// NewTaskTypeRegistry creates an empty registry.
func NewTaskTypeRegistry() *TaskTypeRegistry {
	return &TaskTypeRegistry{
		aggregators: make(map[TaskType]AggregatorFn),
		policies:    make(map[TaskType]*TransitionPolicy),
	}
}

// RegisterAggregator installs an aggregate-status function for a
// TaskType. Subsequent calls to AggregateTaskStatusWithRegistry for that
// TaskType delegate to fn. Registering nil fn removes the entry,
// restoring the default gallery aggregator fallback.
func (r *TaskTypeRegistry) RegisterAggregator(taskType TaskType, fn AggregatorFn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if fn == nil {
		delete(r.aggregators, taskType)
		return
	}
	r.aggregators[taskType] = fn
}

// RegisterTransitionPolicy installs a TransitionPolicy for a TaskType.
// The orchestrator looks up this policy when a node's
// DagNodeDefinition.TransitionPolicy is nil, so that definitions
// persisted before the strategy layer still get policy-driven behavior.
// Registering nil policy removes the entry.
func (r *TaskTypeRegistry) RegisterTransitionPolicy(taskType TaskType, p *TransitionPolicy) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p == nil {
		delete(r.policies, taskType)
		return
	}
	r.policies[taskType] = p
}

// GetAggregator returns the registered aggregator for taskType, or nil
// if none is registered (caller falls back to the default gallery
// aggregator).
func (r *TaskTypeRegistry) GetAggregator(taskType TaskType) AggregatorFn {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.aggregators[taskType]
}

// GetTransitionPolicy returns the registered TransitionPolicy for
// taskType, or nil if none is registered.
func (r *TaskTypeRegistry) GetTransitionPolicy(taskType TaskType) *TransitionPolicy {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.policies[taskType]
}

// AggregateTaskStatusWithRegistry resolves the aggregator for taskType
// via the registry and delegates to it. When the registry has no
// aggregator for taskType, it falls back to the package-level
// AggregateTaskStatus (the default gallery implementation), preserving
// backward compatibility.
func AggregateTaskStatusWithRegistry(r *TaskTypeRegistry, taskType TaskType, nodes []NodeSnapshotInfo) string {
	if r != nil {
		if fn := r.GetAggregator(taskType); fn != nil {
			return fn(taskType, nodes)
		}
	}
	return AggregateTaskStatus(taskType, nodes)
}

// ResolveTransitionPolicy returns the TransitionPolicy to install on a
// node with the given taskType. It prefers an explicit policy carried in
// the DagNodeDefinition; when that is nil it falls back to the registry.
// Returns nil when neither source has a policy (caller falls back to the
// global validTransitions table).
func ResolveTransitionPolicy(r *TaskTypeRegistry, def DagNodeDefinition) *TransitionPolicy {
	if def.TransitionPolicy != nil {
		return def.TransitionPolicy
	}
	if r != nil {
		return r.GetTransitionPolicy(def.TaskType)
	}
	return nil
}
