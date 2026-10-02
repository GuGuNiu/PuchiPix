package orchestrator

import (
	"sync"
)

// AggregatorFn computes the aggregate DAG status string (e.g.
// "completed", "failed", "needs_retry", "paused", "pending") from a
// slice of node snapshots.
type AggregatorFn func(taskType TaskType, nodes []NodeSnapshotInfo) string

// TaskTypeRegistry maps a TaskType to its aggregator function and
// optional TransitionPolicy, so new TaskTypes register through
// RegisterAggregator / RegisterTransitionPolicy rather than through
// hardcoded switch statements.
//
// A registered aggregator wins over the default gallery aggregator in
// AggregateTaskStatus / DagOrchestrator; unregistered TaskTypes fall back
// to the default. Policies are resolved the same way, and
// GetTransitionPolicy supplies the policy for nodes whose
// DagNodeDefinition.TransitionPolicy is nil.
type TaskTypeRegistry struct {
	mu          sync.RWMutex
	aggregators map[TaskType]AggregatorFn
	policies    map[TaskType]*TransitionPolicy
}

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
// DagNodeDefinition.TransitionPolicy is nil. Registering nil policy
// removes the entry.
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

func (r *TaskTypeRegistry) GetTransitionPolicy(taskType TaskType) *TransitionPolicy {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.policies[taskType]
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
