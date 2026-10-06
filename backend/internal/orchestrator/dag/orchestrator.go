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
		orchestrator.NodeStatePreparing,
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
	// CancelRunningNode cancels the context of an in-flight executor for
	// the node. Unlike CancelNode (which only removes the node from the
	// ready queue), this actually stops running work. The orchestrator
	// must transition the node to PAUSED/CANCELLED BEFORE calling it so
	// the executor's cancellation report is ignored by OnNodeCompleted.
	CancelRunningNode(dagID, nodeID string)
	// IsExecuting reports whether a live executor supervisor is running
	// this node right now. The zombie sweep uses it to tell a node whose
	// executor is genuinely gone from one that is still in flight.
	IsExecuting(dagID, nodeID string) bool
	WaitForDag(ctx context.Context, dagID string) error
	OnSlotFreed(slotType string)
}

// FlowControllerInterface is the contract the orchestrator needs from
// the flow control layer. It is intentionally minimal (Ask + TryAsk
// methods) so the orchestrator can call it without depending on the full
// governor implementation.
type FlowControllerInterface interface {
	// Ask blocks until admission is granted or the context is
	// cancelled. Returns nil when the node may proceed to the
	// scheduler, or ctx.Err() if admission was denied due to
	// context timeout/cancellation.
	Ask(ctx context.Context) error

	// TryAsk attempts to acquire admission without blocking.
	// Returns true if admission is granted, false if denied (tokens
	// exhausted or pressure too high). Use this in sequential
	// processing paths (like ResumeDag) to avoid stalling the entire
	// recovery pipeline when tokens run out.
	TryAsk() bool
}

// DomainAdmissionInterface is the contract the orchestrator needs from the
// per-domain admission gate. It mirrors FlowControllerInterface's shape so the
// two gates compose at the same point without the orchestrator depending on
// the stealth package.
type DomainAdmissionInterface interface {
	// TryAdmit reserves capacity on one of the site's domains without
	// blocking. It returns the reserved domain and true when the node may
	// proceed, or an empty domain and false when every domain is at
	// capacity. A site with no known domains is always admitted.
	TryAdmit(siteID string) (string, bool)

	// Release returns a reservation taken by TryAdmit. The domain must be
	// the value TryAdmit returned.
	Release(siteID, domain string)
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
// Concurrency model:
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

	// flowController (optional) applies admission control before a node
	// is submitted to the scheduler. When set, submitToScheduler calls
	// Ask() first; if admission is denied, the node stays in QUEUED and
	// the auto-reactivation ticker retries it later. nil means "no flow
	// control" (original behavior, useful for tests).
	flowController FlowControllerInterface

	// domainAdmission (optional) spreads admitted nodes across a site's
	// mirror domains. It runs after flowController and before the scheduler,
	// so a node can be held back by domain saturation while the global rate
	// still looks healthy. Reservations are released when the node settles,
	// is paused or is cancelled. nil means no domain balancing.
	domainAdmission DomainAdmissionInterface

	// domainReservations holds the domain reserved for each in-flight node,
	// keyed by "dagID:nodeID" to match the slot pool's holder ID convention.
	// It has its own mutex rather than using dagsMu: the documented lock
	// order takes dagsMu for read before dag.mu, so taking it for write from
	// inside a DAG-locked path would invert the order.
	domainReservationsMu sync.Mutex
	domainReservations   map[string]string

	// statusSyncFn, when installed, is invoked after a node transitions
	// to a terminal state (or RUNNING) so the orchestrator can push the
	// FSM state back to the entity tables (galleries / download_tasks /
	// sniff_tasks), closing the gap where the DB status update was
	// deferred and the FSM could reach failed while the DB stayed at a
	// transient status. It is a one-way fire-and-forget callback: failures
	// are logged, never fatal.
	statusSyncFn func(ctx context.Context, dagID, nodeID string, def orchestrator.DagNodeDefinition, state orchestrator.NodeState)

	// dagStatusSyncFn, when installed, is invoked once when a DAG reaches a
	// terminal aggregate state (all nodes terminal) — see checkDagCompletion.
	// While statusSyncFn covers per-node non-completed states, entity
	// completion is normally written by executors together with richer data
	// (sizes / file paths / partial-vs-completed). dagStatusSyncFn is the
	// DAG-level guard rail: when the aggregate is "completed" it performs a
	// CONDITIONAL terminal write that only fills entities still stuck in an
	// active status (scraping/downloading/pending), so an executor crash
	// between node completion and its final UPDATE can no longer leave the
	// DB permanently "downloading". It never clobbers executor-owned
	// terminal statuses (partial/failed/cancelled/completed) because the
	// WHERE clause excludes them.
	dagStatusSyncFn func(ctx context.Context, dagID string, def orchestrator.DagDefinition, aggregateStatus string)

	// reactivationStarted guards the auto-reactivation ticker so
	// StartAutoReactivation is idempotent.
	reactivationStarted bool

	// zombieSweepStarted guards the zombie-sweep ticker so
	// StartZombieSweep is idempotent.
	zombieSweepStarted bool
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

// SetFlowController connects the admission controller. Once set, every
// node submission flows through Ask() first. If admission is denied, the
// node stays in QUEUED and will be retried by the auto-reactivation ticker.
// Setting it to nil disables flow control (original behavior).
func (o *DagOrchestrator) SetFlowController(fc FlowControllerInterface) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.flowController = fc
	if fc != nil {
		o.logger.Info("Flow control enabled")
	} else {
		o.logger.Info("Flow control disabled")
	}
}

// SetDomainAdmission connects the per-domain admission gate. Once set, every
// node submission reserves a domain before entering the scheduler. Setting it
// to nil disables domain balancing.
func (o *DagOrchestrator) SetDomainAdmission(da DomainAdmissionInterface) {
	o.domainReservationsMu.Lock()
	o.domainAdmission = da
	if da != nil && o.domainReservations == nil {
		o.domainReservations = make(map[string]string)
	}
	o.domainReservationsMu.Unlock()

	if da != nil {
		o.logger.Info("Per-domain admission enabled")
	} else {
		o.logger.Info("Per-domain admission disabled")
	}
}

// recordDomainReservation stores the domain reserved for a node.
func (o *DagOrchestrator) recordDomainReservation(dagID, nodeID, domain string) {
	o.domainReservationsMu.Lock()
	defer o.domainReservationsMu.Unlock()
	if o.domainReservations == nil {
		o.domainReservations = make(map[string]string)
	}
	o.domainReservations[dagID+":"+nodeID] = domain
}

// releaseDomainReservation returns a node's domain reservation. It is
// idempotent: a node that was never admitted, or whose reservation was already
// returned, is a no-op. That matters because completion, pause and cancel can
// all settle the same node.
func (o *DagOrchestrator) releaseDomainReservation(dagID, nodeID string) {
	o.domainReservationsMu.Lock()
	domain, ok := o.domainReservations[dagID+":"+nodeID]
	if ok {
		delete(o.domainReservations, dagID+":"+nodeID)
	}
	admission := o.domainAdmission
	o.domainReservationsMu.Unlock()

	if !ok || admission == nil {
		return
	}
	admission.Release(siteIDFromConfig(o, dagID, nodeID), domain)
}

// releaseDomainReservationsForDag returns every reservation held by a DAG.
// Used by pause, cancel and delete, where a whole DAG stops occupying capacity
// at once.
func (o *DagOrchestrator) releaseDomainReservationsForDag(dagID string) {
	o.domainReservationsMu.Lock()
	admission := o.domainAdmission
	released := make(map[string]string)
	prefix := dagID + ":"
	for key, domain := range o.domainReservations {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			released[key[len(prefix):]] = domain
			delete(o.domainReservations, key)
		}
	}
	o.domainReservationsMu.Unlock()

	if admission == nil {
		return
	}
	for nodeID, domain := range released {
		admission.Release(siteIDFromConfig(o, dagID, nodeID), domain)
	}
}

// siteIDFromConfig reads the site identifier the DAG factory injected into a
// node's config, which is what the domain pool is keyed by. Returns an empty
// string when the node is gone, in which case Release is a no-op.
func siteIDFromConfig(o *DagOrchestrator, dagID, nodeID string) string {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return ""
	}

	dag.mu.Lock()
	defer dag.mu.Unlock()

	node, ok := dag.nodes[nodeID]
	if !ok {
		return ""
	}
	if raw, exists := node.definition.Config["siteId"]; exists {
		if s, isString := raw.(string); isString {
			return s
		}
	}
	return ""
}

// SetStatusSyncFn installs the callback that pushes node FSM state back
// to the entity tables after terminal transitions. See statusSyncFn.
func (o *DagOrchestrator) SetStatusSyncFn(fn func(ctx context.Context, dagID, nodeID string, def orchestrator.DagNodeDefinition, state orchestrator.NodeState)) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.statusSyncFn = fn
}

// SetDagStatusSyncFn installs the DAG-level terminal-status guard-rail
// callback invoked from checkDagCompletion. See dagStatusSyncFn.
func (o *DagOrchestrator) SetDagStatusSyncFn(fn func(ctx context.Context, dagID string, def orchestrator.DagDefinition, aggregateStatus string)) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.dagStatusSyncFn = fn
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
// DagOrchestratorInterface.GetNodeForVerification callback.
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
		// Look up a TransitionPolicy in the TaskTypeRegistry when the
		// definition carries none, so definitions persisted without one
		// still get policy-driven guards, actions and retryPolicy.
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
