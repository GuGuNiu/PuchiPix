package dag

import (
	"context"
	"fmt"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// defaultOnRestart returns PAUSED for all non-terminal states so the user
// can decide when to resume after a service restart.
func defaultOnRestart(restoredState orchestrator.NodeState) orchestrator.NodeState {
	switch restoredState {
	case orchestrator.NodeStateRunning,
		orchestrator.NodeStateVerifying,
		orchestrator.NodeStateAllocated,
		orchestrator.NodeStateQueued,
		orchestrator.NodeStateReady,
		orchestrator.NodeStateResumeVerify,
		orchestrator.NodeStateNeedsRetry:
		return orchestrator.NodeStatePaused
	default:
		return restoredState
	}
}

// dagNodeInstance holds the live state of a node within a DAG instance.
type dagNodeInstance struct {
	definition orchestrator.DagNodeDefinition
	fsm        *orchestrator.TaskStateMachine
	result     *orchestrator.NodeExecutionResult
	// completedDeps counts how many of the node's dependencies have
	// reached COMPLETED (or been skipped as non-critical). It enables
	// incremental O(d) activation: when a node completes, only its
	// direct successors have this counter touched, rather than every
	// PENDING node rescanning its full dependency list.
	completedDeps int
}

// dagInstance represents a running DAG with all its nodes.
type dagInstance struct {
	id         string
	definition orchestrator.DagDefinition
	nodes      map[string]*dagNodeInstance
	createdAt  time.Time
	// graphIdx is an in-memory topology index rebuilt from definition.
	// It carries no authoritative state; snapshots remain the truth.
	graphIdx *graphIndex
	// mu guards this DAG's nodes, FSMs, counters, and graphIdx.
	// Lock ordering: dagsMu(R) -> dag.mu -> scheduler -> SlotPool.
	mu sync.Mutex
	// allTerminal caches whether every node in this DAG has reached
	// a terminal state. Maintained by checkDagCompletion and consulted
	// by ReactivateReadyNodes to skip DAGs that have no work left,
	// avoiding an O(n) scan of every node in every DAG on each tick.
	// The flag is conservative: it is only set true when
	// checkDagCompletion confirms all nodes are terminal, and it is
	// reset to false whenever a retry/resume/addNode introduces new
	// non-terminal nodes. A false value means "might have work" so the
	// periodic scan still checks, but the common idle case (dozens of
	// completed DAGs) is reduced from O(dags*nodes) to O(activeDags).
	allTerminal bool
}

// SchedulerInterface is the contract the orchestrator needs from the
// scheduler, avoiding a circular import.
type SchedulerInterface interface {
	Submit(node orchestrator.SchedulableNode) bool
	// SubmitWithDelay enqueues a node after the given delay without
	// blocking the caller, backing non-blocking retry backoff.
	SubmitWithDelay(node orchestrator.SchedulableNode, delay time.Duration)
	// UpdateNodePriority dynamically re-prioritizes a queued node.
	UpdateNodePriority(dagID, nodeID string, newPriority int) bool
	HasNode(dagID, nodeID string) bool
	CancelNode(dagID, nodeID string)
	OnSlotFreed(slotType string)
}

// SlotPoolInterface is the contract the orchestrator needs from the
// slot pool.
type SlotPoolInterface interface {
	SetSchedulerCallback(cb func(slotType string))
	SetMaxUpdateCallback(cb func(slotType string, newMax int))
	ReleaseAll(holderID string)
}

// DagOrchestrator manages the full lifecycle of DAG instances:
// submission, node activation, dependency resolution, pause/resume/
// cancel/retry, and snapshot persistence/recovery.
//
// Concurrency model (Stage 3 lock split):
//   - dagsMu (RWMutex) guards ONLY the dags map (lookup/insert).
//   - Each dagInstance.mu guards that DAG's nodes/FSM/counters/graphIdx.
//   - Global lock ordering (never reversed): dagsMu(R) -> dag.mu ->
//     scheduler/ReadyQueue -> SlotPool. Event persistence goes through
//     AppendAsync so no DB I/O happens under any DAG lock.
type DagOrchestrator struct {
	dagsMu      sync.RWMutex
	dags        map[string]*dagInstance
	logger      *infra.Logger
	eventStore  *orchestrator.EventStore
	eventBus    *infra.EventBus
	slotPool    SlotPoolInterface
	scheduler   SchedulerInterface
	reconciler  *orchestrator.StateReconciler
	registry    *orchestrator.TaskTypeRegistry
	initialized bool

	// statusSyncFn, when installed, is invoked after a node transitions
	// to a terminal state (or RUNNING) so the orchestrator can push the
	// FSM state back to the entity tables (galleries / download_tasks /
	// sniff_tasks). This closes the long-standing gap where the DB status
	// update was deferred ("Phase 4 integration" TODO) and the FSM could
	// reach failed while the DB stayed at a transient status. It is a
	// one-way fire-and-forget callback: failures are logged, never fatal.
	statusSyncFn func(ctx context.Context, dagID, nodeID string, def orchestrator.DagNodeDefinition, state orchestrator.NodeState)

	// reactivationStarted guards the auto-reactivation ticker so
	// StartAutoReactivation is idempotent.
	reactivationStarted bool
}

// NewDagOrchestrator creates an orchestrator with the given event store
// and slot pool. The scheduler is connected via SetScheduler.
func NewDagOrchestrator(es *orchestrator.EventStore, sp SlotPoolInterface) *DagOrchestrator {
	return &DagOrchestrator{
		dags:       make(map[string]*dagInstance),
		logger:     infra.NewLogger("DagOrchestrator"),
		eventStore: es,
		slotPool:   sp,
	}
}

// SetScheduler connects the scheduler and wires the slot pool's
// scheduler callback to the scheduler's OnSlotFreed method. It also
// wires the max-update callback so that slot capacity changes are
// immediately reflected in the scheduler's queue size limits.
func (o *DagOrchestrator) SetScheduler(s SchedulerInterface) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.scheduler = s
	if o.slotPool != nil {
		o.slotPool.SetSchedulerCallback(s.OnSlotFreed)
		// Sync queue capacity immediately and subscribe to future changes
		// so that PUT /api/slots/{type} raises are immediately effective.
		if syncer, ok := s.(interface{ SyncQueueCapacityFromSlotPool() }); ok {
			syncer.SyncQueueCapacityFromSlotPool()
		}
		o.slotPool.SetMaxUpdateCallback(func(slotType string, newMax int) {
			if syncer, ok := s.(interface{ SyncQueueCapacityFromSlotPool() }); ok {
				syncer.SyncQueueCapacityFromSlotPool()
			}
		})
	}
}

// SetReconciler connects the StateReconciler, enabling node side-effect
// verification (needs_retry auto-retry, RESUME_VERIFY checkpoint recovery).
// Without a reconciler the scheduler's GetNodeForVerification callback has
// no effect and VERIFYING/RESUME_VERIFY nodes cannot be advanced.
func (o *DagOrchestrator) SetReconciler(r *orchestrator.StateReconciler) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.reconciler = r
}

// SetTaskTypeRegistry connects the TaskTypeRegistry, enabling per-TaskType
// TransitionPolicy lookup. When a node's DagNodeDefinition.TransitionPolicy
// is nil (e.g. definitions persisted before the strategy layer), the
// orchestrator falls back to the registry to find a policy for the node's
// TaskType. Without a registry, all nodes use the global validTransitions
// table (backward compatible).
func (o *DagOrchestrator) SetTaskTypeRegistry(r *orchestrator.TaskTypeRegistry) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.registry = r
}

// SetEventBus connects the EventBus, enabling real-time SSE/WS event
// emission for DAG lifecycle events (node progress, state changes, etc.).
// Without an EventBus, SSE clients won't receive dag:nodeProgress events.
func (o *DagOrchestrator) SetEventBus(eb *infra.EventBus) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.eventBus = eb
}

// SetStatusSyncFn installs the callback that pushes node FSM state back
// to the entity tables after terminal transitions. See statusSyncFn.
func (o *DagOrchestrator) SetStatusSyncFn(fn func(ctx context.Context, dagID, nodeID string, def orchestrator.DagNodeDefinition, state orchestrator.NodeState)) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.statusSyncFn = fn
}

// resolvePolicy returns the TransitionPolicy for a node definition,
// preferring the definition's explicit policy and falling back to the
// registry. Returns nil when neither source has a policy.
func (o *DagOrchestrator) resolvePolicy(def orchestrator.DagNodeDefinition) *orchestrator.TransitionPolicy {
	o.dagsMu.RLock()
	reg := o.registry
	o.dagsMu.RUnlock()
	return orchestrator.ResolveTransitionPolicy(reg, def)
}

// Reconciler returns the installed StateReconciler, or nil if none was
// injected. Used by the scheduler adapter to route verification requests.
func (o *DagOrchestrator) Reconciler() *orchestrator.StateReconciler {
	o.dagsMu.RLock()
	defer o.dagsMu.RUnlock()
	return o.reconciler
}

// GetNodeForVerification returns a DagNodeForVerification view of the
// node, or nil if the DAG/node does not exist. This is the production
// implementation backing the scheduler's
// DagOrchestratorInterface.GetNodeForVerification callback — previously
// the adapter returned nil, breaking the entire verification chain.
func (o *DagOrchestrator) GetNodeForVerification(dagID, nodeID string) *orchestrator.DagNodeForVerification {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return nil
	}
	dag.mu.Lock()
	defer dag.mu.Unlock()
	node, exists := dag.nodes[nodeID]
	if !exists {
		return nil
	}
	return &orchestrator.DagNodeForVerification{
		NodeID: nodeID,
		DagID:  dagID,
		State:  node.fsm.State(),
		Phase:  string(node.definition.Phase),
		Config: node.definition.Config,
	}
}

// Initialize sets up the event store and restores DAGs from snapshots.
func (o *DagOrchestrator) Initialize(ctx context.Context) error {
	o.dagsMu.Lock()
	if o.initialized {
		o.dagsMu.Unlock()
		return nil
	}
	o.dagsMu.Unlock()

	if err := o.eventStore.Initialize(ctx); err != nil {
		return fmt.Errorf("event store init: %w", err)
	}

	o.eventStore.SetSnapshotProvider(o.GetAllDagSnapshots)

	if err := o.eventStore.RestoreFromSnapshot(ctx, o.restoreDag, o.applyEvent); err != nil {
		o.logger.Error("Snapshot restore failed", err)
	}

	// Recompute incremental activation counters from restored states.
	o.recomputeActivationCounters()

	o.dagsMu.Lock()
	o.initialized = true
	o.dagsMu.Unlock()

	o.logger.Info("DagOrchestrator initialization completed")
	return nil
}

// SubmitDag registers a new DAG and activates all initially-ready nodes.
func (o *DagOrchestrator) SubmitDag(ctx context.Context, def orchestrator.DagDefinition) (string, error) {
	graphIdx, err := buildGraphIndex(def)
	if err != nil {
		return "", fmt.Errorf("build graph index: %w", err)
	}

	dagID := def.ID
	dag := &dagInstance{
		id:         dagID,
		definition: def,
		nodes:      make(map[string]*dagNodeInstance),
		createdAt:  time.Now(),
		graphIdx:   graphIdx,
	}
	for _, nodeDef := range def.Nodes {
		fsm := orchestrator.NewTaskStateMachine(dagID, nodeDef.ID, nodeDef.Phase, nodeDef)
		// Strategy layer: when the definition has no explicit
		// TransitionPolicy, look one up from the TaskTypeRegistry so
		// definitions persisted before the strategy layer still get
		// policy-driven behavior (guards, actions, retryPolicy).
		if fsm.Policy() == nil {
			if p := o.resolvePolicy(nodeDef); p != nil {
				fsm.SetPolicy(p)
			}
		}
		dag.nodes[nodeDef.ID] = &dagNodeInstance{
			definition: nodeDef,
			fsm:        fsm,
			result:     nil,
		}
	}
	o.dagsMu.Lock()
	o.dags[dagID] = dag
	o.dagsMu.Unlock()

	// Apply task-level slot quotas declared in the DAG metadata so the
	// slot pool strictly bounds this task's concurrency per slot type
	// (e.g. {"download": 2} caps this task at two simultaneous download
	// slots even when the global pool allows more). Quotas are cleared
	// when the DAG reaches a terminal state (see checkDagCompletion).
	if len(def.Metadata.SlotLimits) > 0 {
		if sp, ok := o.slotPool.(*slot.SlotPool); ok {
			sp.SetDagQuota(dagID, def.Metadata.SlotLimits)
			o.logger.Info("DAG slot quotas applied", "dagId", dagID, "limits", def.Metadata.SlotLimits)
		}
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:created",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload: map[string]any{
			"taskType":  string(def.TaskType),
			"nodeCount": len(def.Nodes),
			"sourceUrl": def.Metadata.SourceURL,
		},
	})

	o.logger.Info("DAG submitted", "dagId", dagID, "nodeCount", len(def.Nodes))

	if _, err := o.activateReadyNodes(ctx, dagID); err != nil {
		o.logger.Error("Failed to activate ready nodes", err, "dagId", dagID)
	}
	return dagID, nil
}
