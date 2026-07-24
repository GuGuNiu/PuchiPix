package dag

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// maxJitter is the upper bound (ms) for randomized scheduling jitter,
// spreading out batch node submissions to prevent thundering-herd
// effects when many nodes become ready simultaneously.
const maxJitter = 200

// defaultOnRestart returns the fallback target state for a node found in
// RUNNING or VERIFYING after a service restart, when no policy onRestart
// hook is installed. RUNNING nodes are re-schedulable so they go to READY;
// VERIFYING nodes have no executor driving them so they go to FAILED
// (the user can retry). This prevents the deadlocks identified in audit
// S1/B1/B2 where restarted nodes stayed stranded in a non-progressing
// state.
func defaultOnRestart(restoredState orchestrator.NodeState) orchestrator.NodeState {
	switch restoredState {
	case orchestrator.NodeStateRunning:
		return orchestrator.NodeStateReady
	case orchestrator.NodeStateVerifying:
		return orchestrator.NodeStateFailed
	case orchestrator.NodeStateAllocated:
		// ALLOCATED means slots were acquired but the executor never
		// started; safe to re-schedule.
		return orchestrator.NodeStateReady
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
}

// SchedulerInterface is the contract the orchestrator needs from the
// scheduler, avoiding a circular import.
type SchedulerInterface interface {
	Submit(node orchestrator.SchedulableNode) bool
	HasNode(dagID, nodeID string) bool
	CancelNode(dagID, nodeID string)
	OnSlotFreed(slotType string)
}

// SlotPoolInterface is the contract the orchestrator needs from the
// slot pool.
type SlotPoolInterface interface {
	SetSchedulerCallback(cb func(slotType string))
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
	slotPool    SlotPoolInterface
	scheduler   SchedulerInterface
	reconciler  *orchestrator.StateReconciler
	registry    *orchestrator.TaskTypeRegistry
	initialized bool
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
// scheduler callback to the scheduler's OnSlotFreed method.
func (o *DagOrchestrator) SetScheduler(s SchedulerInterface) {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()
	o.scheduler = s
	if o.slotPool != nil {
		o.slotPool.SetSchedulerCallback(s.OnSlotFreed)
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
// DagOrchestratorInterface.GetNodeForVerification callback ??previously
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

	if err := o.activateReadyNodes(ctx, dagID); err != nil {
		o.logger.Error("Failed to activate ready nodes", err, "dagId", dagID)
	}
	return dagID, nil
}

// activateReadyNodes implements the three-phase node activation logic
// from the TypeScript orchestrator, including the 260720 READY deadlock
// fix (Phase 2 re-submission) and orphaned QUEUED recovery (Phase 3).
func (o *DagOrchestrator) activateReadyNodes(ctx context.Context, dagID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()

	type pendingSubmit struct {
		nodeID string
		node   *dagNodeInstance
	}
	var toSubmit []pendingSubmit
	var orphaned []pendingSubmit

	for nodeID, node := range dag.nodes {
		state := node.fsm.State()

		// Phase 3 first: a node ALREADY in QUEUED at entry is a leftover
		// from a previous activation pass ??if the scheduler lost it,
		// recover by rolling back and re-submitting. This check must run
		// BEFORE Phase 2 marks new QUEUED nodes, otherwise freshly-queued
		// nodes (not yet submitted ??submission happens after unlock)
		// would be misclassified as orphans and rolled back.
		if state == orchestrator.NodeStateQueued && o.scheduler != nil && !o.scheduler.HasNode(dagID, nodeID) {
			o.logger.Info("Recovering orphaned QUEUED node", "dagId", dagID, "nodeId", nodeID)
			orphaned = append(orphaned, pendingSubmit{nodeID: nodeID, node: node})
			continue
		}

		if state == orchestrator.NodeStatePending {
			allDepsCompleted := true
			for _, depID := range node.definition.Dependencies {
				depNode, exists := dag.nodes[depID]
				if !exists {
					allDepsCompleted = false
					break
				}
				depState := depNode.fsm.State()
				if depState == orchestrator.NodeStateCompleted {
					continue
				}
				// NonCritical deps in a terminal failure state count as
				// completed: their dependents proceed without them.
				if depNode.definition.NonCritical && (depState == orchestrator.NodeStateFailed || depState == orchestrator.NodeStateTimeout) {
					continue
				}
				allDepsCompleted = false
				break
			}
			if allDepsCompleted {
				if err := node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
					Reason:      "dependencies satisfied",
					TriggeredBy: "system",
				}); err != nil {
					o.logger.Warn("Transition to READY failed", "nodeId", nodeID, "error", err.Error())
					continue
				}
			} else {
				continue
			}
		}

		state = node.fsm.State()
		if state == orchestrator.NodeStateReady {
			if err := node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
				Reason:      "submitted to scheduler",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			toSubmit = append(toSubmit, pendingSubmit{nodeID: nodeID, node: node})
		}
	}
	dag.mu.Unlock()

	for _, item := range toSubmit {
		o.submitToScheduler(ctx, item.nodeID, dagID, item.node)
	}

	for _, item := range orphaned {
		_ = item.node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "orphaned QUEUED recovery, rolling back for re-submit",
			TriggeredBy: "system",
		})
		o.submitToScheduler(ctx, item.nodeID, dagID, item.node)
	}

	return nil
}

// recomputeActivationCounters rebuilds every node's completedDeps
// counter from current FSM states. Called once after snapshot restore,
// since counters are runtime-only and not persisted.
func (o *DagOrchestrator) recomputeActivationCounters() {
	o.dagsMu.RLock()
	dags := make([]*dagInstance, 0, len(o.dags))
	for _, d := range o.dags {
		dags = append(dags, d)
	}
	o.dagsMu.RUnlock()
	for _, dag := range dags {
		dag.mu.Lock()
		for _, node := range dag.nodes {
			count := 0
			for _, depID := range node.definition.Dependencies {
				if dep, ok := dag.nodes[depID]; ok {
					depState := dep.fsm.State()
					if depState == orchestrator.NodeStateCompleted {
						count++
					} else if dep.definition.NonCritical && (depState == orchestrator.NodeStateFailed || depState == orchestrator.NodeStateTimeout) {
						// NonCritical failed deps count as satisfied
						count++
					}
				}
			}
			node.completedDeps = count
		}
		dag.mu.Unlock()
	}
}

// propagateCompletion performs incremental O(d) activation: for each
// direct successor of the completed node, bump its completedDeps
// counter; a PENDING successor whose dependencies are now all satisfied
// is transitioned PENDING -> READY -> QUEUED and submitted. Nodes
// already past PENDING (e.g. PAUSED/CANCELLED) are left untouched.
func (o *DagOrchestrator) propagateCompletion(ctx context.Context, dagID, completedNodeID string) {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return
	}
	dag.mu.Lock()

	var toSubmit []*dagNodeInstance
	if dag.graphIdx != nil {
		for _, succID := range dag.graphIdx.directSuccessors(completedNodeID) {
			succ, exists := dag.nodes[succID]
			if !exists {
				continue
			}
			succ.completedDeps++
			if succ.fsm.State() != orchestrator.NodeStatePending {
				continue
			}
			if succ.completedDeps < len(succ.definition.Dependencies) {
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
				Reason:      "dependencies satisfied",
				TriggeredBy: "system",
			}); err != nil {
				o.logger.Warn("Transition to READY failed", "nodeId", succID, "error", err.Error())
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
				Reason:      "submitted to scheduler",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			toSubmit = append(toSubmit, succ)
		}
	}
	dag.mu.Unlock()

	for _, node := range toSubmit {
		o.submitToScheduler(ctx, node.definition.ID, dagID, node)
	}
}

// activateSuccessorsLocked transitions PENDING direct successors of the
// given nodes whose dependencies are already satisfied (e.g. after a
// restore where predecessors completed long ago). Unlike the full-scan
// activateReadyNodes, this only walks the relevant subgraph. The caller
// must hold dag.mu; returns the nodes that reached QUEUED.
func (o *DagOrchestrator) activateSuccessorsLocked(dag *dagInstance, nodeIDs []string) []*dagNodeInstance {
	var queued []*dagNodeInstance
	visited := make(map[string]bool)
	for _, nodeID := range nodeIDs {
		for _, succID := range dag.graphIdx.directSuccessors(nodeID) {
			if visited[succID] {
				continue
			}
			visited[succID] = true
			succ, exists := dag.nodes[succID]
			if !exists || succ.fsm.State() != orchestrator.NodeStatePending {
				continue
			}
			allCompleted := true
			for _, depID := range succ.definition.Dependencies {
				depNode, depExists := dag.nodes[depID]
				if !depExists {
					allCompleted = false
					break
				}
				depState := depNode.fsm.State()
				if depState == orchestrator.NodeStateCompleted {
					continue
				}
				if depNode.definition.NonCritical && (depState == orchestrator.NodeStateFailed || depState == orchestrator.NodeStateTimeout) {
					continue
				}
				allCompleted = false
				break
			}
			if !allCompleted {
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
				Reason:      "dependencies satisfied",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
				Reason:      "submitted to scheduler",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			queued = append(queued, succ)
		}
	}
	return queued
}

// activateSatisfiedSuccessors is the lock-taking wrapper around
// activateSuccessorsLocked for a single completed node.
func (o *DagOrchestrator) activateSatisfiedSuccessors(ctx context.Context, dagID, nodeID string) {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return
	}
	dag.mu.Lock()
	var queued []*dagNodeInstance
	if dag.graphIdx != nil {
		queued = o.activateSuccessorsLocked(dag, []string{nodeID})
	}
	dag.mu.Unlock()

	for _, node := range queued {
		o.submitToScheduler(ctx, node.definition.ID, dagID, node)
	}
} // submitToScheduler builds a SchedulableNode from the definition and
// submits it to the scheduler, rolling back to READY if rejected.
// A randomized jitter (0–maxJitter ms) is applied before submission
// when multiple nodes are activated in the same batch, spreading the
// burst to avoid thundering-herd contention.
func (o *DagOrchestrator) submitToScheduler(ctx context.Context, nodeID, dagID string, node *dagNodeInstance) {
	schedulable := orchestrator.SchedulableNode{
		NodeID:               nodeID,
		DagID:                dagID,
		TaskType:             node.definition.TaskType,
		Phase:                node.definition.Phase,
		ExecutorKey:          node.definition.Executor,
		Priority:             node.definition.Priority,
		ResourceRequirements: convertResourceReqs(node.definition.ResourceRequirements),
		Config:               node.definition.Config,
		SubmittedAt:          time.Now(),
		TimeoutMs:            node.definition.Timeout,
		NonCritical:          node.definition.NonCritical,
	}

	if o.scheduler == nil {
		return
	}

	// Jitter: random 0–maxJitter ms sleep to spread burst submissions
	// when many nodes are activated in the same pass.
	jitterMs := rand.Intn(maxJitter + 1)
	if jitterMs > 0 {
		time.Sleep(time.Duration(jitterMs) * time.Millisecond)
	}

	submitted := o.scheduler.Submit(schedulable)
	if !submitted {
		_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "submit failed, rolling back",
			TriggeredBy: "system",
		})
		o.logger.Warn("Node submit failed (queue full)", "nodeId", nodeID)
	}
}

func convertResourceReqs(reqs []orchestrator.ResourceRequirement) []orchestrator.ResourceRequirement {
	out := make([]orchestrator.ResourceRequirement, len(reqs))
	copy(out, reqs)
	return out
}

// ReactivateReadyNodes scans all DAGs for READY nodes and re-submits
// them to the scheduler. This is the 260720 fix that prevents READY
// nodes from deadlocking when the queue was previously full.
func (o *DagOrchestrator) ReactivateReadyNodes(ctx context.Context) {
	o.dagsMu.RLock()
	dagIDs := make([]string, 0, len(o.dags))
	for id := range o.dags {
		dagIDs = append(dagIDs, id)
	}
	o.dagsMu.RUnlock()

	for _, dagID := range dagIDs {
		if err := o.activateReadyNodes(ctx, dagID); err != nil {
			o.logger.Error("Failed to reactivate READY nodes", err, "dagId", dagID)
		}
	}
}

// OnNodeCompleted is called by the executor when a node finishes,
// recording the result and triggering downstream activation.
//
// Strategy layer (M5): on success, the orchestrator drives the
// VERIFYING/COMPLETED transition based on the node's policy:
//   - shouldVerify (default): RUNNING ??VERIFYING ??StateReconciler ??
//     COMPLETED (passed) / FAILED (verify failed) / NEEDS_RETRY (data
//     missing, auto-retryable)
//   - skipVerify: RUNNING ??COMPLETED directly
// On failure, the node transitions to FAILED (or TIMEOUT when the
// scheduler already detected a deadline). Previously the success path
// skipped VERIFYING entirely and left the node in RUNNING, which is the
// P7 audit defect ??verify executors were registered but never invoked.
func (o *DagOrchestrator) OnNodeCompleted(ctx context.Context, dagID, nodeID string, result orchestrator.NodeExecutionResult) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()
	node, exists := dag.nodes[nodeID]
	if !exists {
		dag.mu.Unlock()
		return orchestrator.ErrNodeNotFound
	}
	node.result = &result
	fsm := node.fsm
	policy := fsm.Policy()
	currentState := fsm.State()
	dag.mu.Unlock()

	// Drive the post-execution transition on success. On failure the
	// scheduler has already transitioned to FAILED/TIMEOUT (or we do it
	// here as a safety net).
	if result.Success {
		switch currentState {
		case orchestrator.NodeStateRunning:
			// Decide VERIFYING vs COMPLETED via policy guards.
			shouldVerify := true
			if policy != nil {
				// Evaluate the galleryNodePolicy guards directly. A nil
				// policy means "always verify" (the pre-strategy default).
				shouldVerify = !policyGuardSkipVerify(fsm.Context())
			}
			if shouldVerify {
				if err := fsm.Transition(orchestrator.NodeStateVerifying, orchestrator.TransitionContext{
					Reason: "execution completed, verifying side effects", TriggeredBy: "scheduler",
				}); err == nil {
					// Run the StateReconciler to check side effects.
					verdict := o.runVerification(ctx, dagID, nodeID, fsm)
					switch verdict {
					case "passed":
						_ = fsm.Transition(orchestrator.NodeStateCompleted, orchestrator.TransitionContext{
							Reason: "verification passed", TriggeredBy: "reconciler",
						})
					case "needs_retry":
						_ = fsm.Transition(orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{
							Reason: "verification needs retry", TriggeredBy: "reconciler",
						})
					default:
						_ = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
							Reason: "verification failed", TriggeredBy: "reconciler",
						})
					}
				}
			} else {
				_ = fsm.Transition(orchestrator.NodeStateCompleted, orchestrator.TransitionContext{
					Reason: "execution completed (skipVerify)", TriggeredBy: "scheduler",
				})
			}
		case orchestrator.NodeStateResumeVerify:
			// RESUME_VERIFY nodes re-enter verification on activation.
			verdict := o.runVerification(ctx, dagID, nodeID, fsm)
			switch verdict {
			case "passed":
				_ = fsm.Transition(orchestrator.NodeStateCompleted, orchestrator.TransitionContext{
					Reason: "resume verification passed", TriggeredBy: "reconciler",
				})
			case "needs_retry":
				_ = fsm.Transition(orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{
					Reason: "resume verification needs retry", TriggeredBy: "reconciler",
				})
			default:
				_ = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
					Reason: "resume verification failed", TriggeredBy: "reconciler",
				})
			}
		}
	} else {
		// Failure safety net: ensure the node reaches a terminal state.
		if currentState == orchestrator.NodeStateRunning {
			_ = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
				Reason: "execution failed", TriggeredBy: "scheduler",
				Error: result.Error,
			})
		}
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nodeCompleted",
		DagID:     dagID,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"result": result},
	})

	// Activate direct successors incrementally (O(d)) rather than
	// rescanning the whole graph (O(n*d)).
	o.propagateCompletion(ctx, dagID, nodeID)

	// COMPLETED may have arrived before this callback (e.g. VERIFYING ->
	// COMPLETED happened inline in the executor); also sweep any PENDING
	// successors whose deps were already satisfied (restore edge cases).
	o.activateSatisfiedSuccessors(ctx, dagID, nodeID)

	return o.checkDagCompletion(ctx, dagID)
}

// policyGuardSkipVerify mirrors the policies.skipVerify guard without
// importing the policies package (which would create a dependency from
// dag ??policies ??orchestrator, a cycle). It reads the same Config key.
// This keeps the guard logic co-located with the orchestrator's
// verification driver while the policy package owns the declarative
// rule table.
func policyGuardSkipVerify(ctx orchestrator.StateMachineContext) bool {
	v, ok := ctx.Definition.Config["skipVerify"]
	if !ok {
		return false
	}
	b, _ := v.(bool)
	return b
}

// runVerification invokes the StateReconciler on the node and returns
// its verdict ("passed", "needs_retry", "failed", "skipped"). When no
// reconciler is installed the verdict defaults to "passed" so nodes are
// not blocked by a missing reconciler (backward compatible).
func (o *DagOrchestrator) runVerification(ctx context.Context, dagID, nodeID string, fsm *orchestrator.TaskStateMachine) string {
	o.dagsMu.RLock()
	reconciler := o.reconciler
	o.dagsMu.RUnlock()
	if reconciler == nil {
		return "passed"
	}
	nodeView := o.GetNodeForVerification(dagID, nodeID)
	if nodeView == nil {
		return "passed"
	}
	result := reconciler.VerifyNode(ctx, *nodeView)
	return result.Status
}

// TransitionNode delegates a state transition to the node's FSM.
func (o *DagOrchestrator) TransitionNode(ctx context.Context, dagID, nodeID string, toState orchestrator.NodeState, tctx orchestrator.TransitionContext) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		o.logger.Warn("DAG not found, cannot transition node", "nodeId", nodeID)
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()
	node, exists := dag.nodes[nodeID]
	if !exists {
		dag.mu.Unlock()
		o.logger.Warn("Node not found, cannot transition", "nodeId", nodeID)
		return orchestrator.ErrNodeNotFound
	}
	fsm := node.fsm
	dag.mu.Unlock()

	if err := fsm.Transition(toState, tctx); err != nil {
		return err
	}

	if orchestrator.IsTerminalState(fsm.State()) || fsm.State() == orchestrator.NodeStateRunning {
		// DB status update would go here; deferred to Phase 4 integration
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nodeStateChanged",
		DagID:     dagID,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Payload: map[string]any{
			"from":    string(fsm.State()),
			"to":      string(toState),
			"context": tctx,
		},
	})

	return nil
}

// PauseDag pauses all non-terminal nodes in a DAG.
//
// Strategy layer (M6): when a node's policy defines onPause, the
// returned state is used instead of the default PAUSED. This lets
// scrape nodes (no side effects) go to READY for immediate
// re-scheduling while download nodes (partial files) go to PAUSED to
// preserve progress.
func (o *DagOrchestrator) PauseDag(ctx context.Context, dagID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		o.logger.Warn("DAG not found, cannot pause", "dagId", dagID)
		return orchestrator.ErrDagNotFound
	}

	pausedCount := 0
	dag.mu.Lock()
	for nodeID, node := range dag.nodes {
		state := node.fsm.State()
		if orchestrator.IsTerminalState(state) || state == orchestrator.NodeStatePaused {
			continue
		}
		if o.scheduler != nil {
			o.scheduler.CancelNode(dagID, nodeID)
		}
		holderID := fmt.Sprintf("%s:%s", dagID, nodeID)
		if sp, ok := o.slotPool.(*slot.SlotPool); ok {
			sp.ReleaseAll(holderID)
		}
		// Strategy layer: ask the policy where this node should land.
		targetState := orchestrator.NodeStatePaused
		if p := node.fsm.Policy(); p != nil && p.OnPause != nil {
			if s := p.OnPause(node.fsm.Context()); s != "" {
				targetState = s
			}
		}
		if node.fsm.CanTransitionTo(targetState) {
			_ = node.fsm.Transition(targetState, orchestrator.TransitionContext{
				Reason:      "user paused",
				TriggeredBy: "user",
			})
			pausedCount++
		}
	}
	dag.mu.Unlock()

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:paused",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"reason": "user paused", "pausedCount": pausedCount},
	})

	o.logger.Info("DAG paused", "dagId", dagID, "pausedCount", pausedCount)
	return nil
}

// CancelDag cancels all non-terminal nodes in a DAG.
func (o *DagOrchestrator) CancelDag(ctx context.Context, dagID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	for nodeID, node := range dag.nodes {
		if !orchestrator.IsTerminalState(node.fsm.State()) {
			if o.scheduler != nil {
				o.scheduler.CancelNode(dagID, nodeID)
			}
			holderID := fmt.Sprintf("%s:%s", dagID, nodeID)
			if sp, ok := o.slotPool.(*slot.SlotPool); ok {
				sp.ReleaseAll(holderID)
			}
			if node.fsm.CanTransitionTo(orchestrator.NodeStateCancelled) {
				_ = node.fsm.Transition(orchestrator.NodeStateCancelled, orchestrator.TransitionContext{
					Reason:      "user cancelled",
					TriggeredBy: "user",
				})
			}
		}
	}
	dag.mu.Unlock()

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:cancelled",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload:   map[string]any{},
	})

	o.logger.Info("DAG cancelled", "dagId", dagID)
	return nil
}

// ResumeDag resumes all paused nodes in a DAG, re-submitting them
// to the scheduler.
func (o *DagOrchestrator) ResumeDag(ctx context.Context, dagID string, nodeID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		o.logger.Warn("DAG not found, cannot resume", "dagId", dagID)
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()

	var nodesToResume []*dagNodeInstance
	if nodeID != "" {
		if n, exists := dag.nodes[nodeID]; exists {
			nodesToResume = []*dagNodeInstance{n}
		}
	} else {
		for _, n := range dag.nodes {
			if n.fsm.State() == orchestrator.NodeStatePaused {
				nodesToResume = append(nodesToResume, n)
			}
		}
	}
	dag.mu.Unlock()

	resumedCount := 0
	for _, node := range nodesToResume {
		if node.fsm.State() != orchestrator.NodeStatePaused {
			continue
		}
		_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "user resumed, preparing for re-scheduling",
			TriggeredBy: "user",
		})
		_ = node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "re-submitted to scheduler after resume",
			TriggeredBy: "system",
		})
		o.submitToScheduler(ctx, node.definition.ID, dagID, node)
		resumedCount++
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:resumed",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"resumedCount": resumedCount, "totalCount": len(nodesToResume)},
	})

	o.logger.Info("DAG resume complete", "dagId", dagID, "resumedCount", resumedCount, "totalCount", len(nodesToResume))
	return nil
}

// RetryDag retries all failed or timed-out nodes in a DAG.
func (o *DagOrchestrator) RetryDag(ctx context.Context, dagID string, nodeID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()

	var nodesToRetry []*dagNodeInstance
	if nodeID != "" {
		if n, exists := dag.nodes[nodeID]; exists {
			if n.fsm.State() == orchestrator.NodeStateFailed || n.fsm.State() == orchestrator.NodeStateTimeout || n.fsm.State() == orchestrator.NodeStateNeedsRetry {
				nodesToRetry = append(nodesToRetry, n)
			}
		}
	} else {
		for _, n := range dag.nodes {
			state := n.fsm.State()
			if state == orchestrator.NodeStateFailed || state == orchestrator.NodeStateTimeout || state == orchestrator.NodeStateNeedsRetry {
				nodesToRetry = append(nodesToRetry, n)
			}
		}
	}
	dag.mu.Unlock()

	if len(nodesToRetry) == 0 {
		o.logger.Warn("No retryable nodes found", "dagId", dagID, "nodeId", nodeID)
		return nil
	}

	for _, node := range nodesToRetry {
		// Strategy layer (M6): honor the policy's retryPolicy. When
		// retryCount >= maxAttempts, skip the retry and leave the node
		// in FAILED so the user is notified that the retry budget is
		// exhausted. When a backoff is configured, sleep before
		// re-submitting so we don't immediately re-trigger the same
		// error. Without a policy, fall back to the existing behavior
		// (ResetRetryCount + immediate re-schedule).
		fsmCtx := node.fsm.Context()
		policy := node.fsm.Policy()
		if policy != nil && policy.RetryPolicy != nil && policy.RetryPolicy.MaxAttempts > 0 {
			if fsmCtx.RetryCount >= policy.RetryPolicy.MaxAttempts {
				o.logger.Warn("Retry budget exhausted, skipping retry", "dagId", dagID, "nodeId", node.definition.ID, "retryCount", fsmCtx.RetryCount, "maxAttempts", policy.RetryPolicy.MaxAttempts)
				continue
			}
			// Apply backoff before re-submitting.
			if policy.RetryPolicy.BackoffMs > 0 {
				delay := policy.RetryPolicy.BackoffMs
				if policy.RetryPolicy.BackoffStrategy != "fixed" {
					// exponential: base * 2^(retryCount)
					shift := uint(fsmCtx.RetryCount)
					if shift < 10 { // cap to avoid overflow
						delay = policy.RetryPolicy.BackoffMs << shift
					}
				}
				time.Sleep(time.Duration(delay) * time.Millisecond)
			}
		}
		node.fsm.ResetRetryCount()
		// A retried node must re-earn its successors: decrement their
		// completedDeps so they cannot activate until this node
		// completes again. This keeps the incremental counters truthful
		// across retry cycles. NonCritical nodes already counted as
		// satisfied are also decremented ??they re-earn on re-completion.
		dag.mu.Lock()
		if dag.graphIdx != nil {
			for _, succID := range dag.graphIdx.directSuccessors(node.definition.ID) {
				if succ, exists := dag.nodes[succID]; exists && succ.completedDeps > 0 {
					succ.completedDeps--
				}
			}
		}
		dag.mu.Unlock()

		_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
			Type:      "dag:nodeRetrying",
			DagID:     dagID,
			NodeID:    node.definition.ID,
			Timestamp: time.Now(),
			Payload: map[string]any{
				"retryCount": node.fsm.Context().RetryCount + 1,
			},
		})

		_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "user retry",
			TriggeredBy: "user",
		})
		_ = node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "re-submitted to scheduler",
			TriggeredBy: "system",
		})
		o.submitToScheduler(ctx, node.definition.ID, dagID, node)
	}

	o.logger.Info("DAG retry nodes", "dagId", dagID, "nodeCount", len(nodesToRetry))
	return nil
}

// checkDagCompletion checks whether all nodes in a DAG are terminal and
// emits completion or failure events accordingly. The aggregate status is
// computed via orchestrator.AggregateTaskStatus (the single source of truth
// for DAG-level state), and its return value drives event emission so the
// event log stays consistent with the aggregate computation (fixes A2:
// previously the return value was discarded and a separate local
// allCompleted/anyCriticalFailure check was used, which could diverge from
// AggregateTaskStatus on NonCritical + Cancelled mixtures).
func (o *DagOrchestrator) checkDagCompletion(ctx context.Context, dagID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()
	allTerminal := true
	var nodeInfos []orchestrator.NodeSnapshotInfo

	for _, node := range dag.nodes {
		state := node.fsm.State()
		if !orchestrator.IsTerminalState(state) {
			allTerminal = false
		}
		nodeInfos = append(nodeInfos, orchestrator.NodeSnapshotInfo{
			State:       state,
			Phase:       node.definition.Phase,
			Error:       node.fsm.Error(),
			NonCritical: node.definition.NonCritical,
		})
	}
	taskType := dag.definition.TaskType
	dag.mu.Unlock()

	if !allTerminal {
		return nil
	}

	// Use the single aggregate function to decide the terminal DAG state.
	aggregateStatus := orchestrator.AggregateTaskStatus(taskType, nodeInfos)
	switch aggregateStatus {
	case "completed":
		_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
			Type:      "dag:completed",
			DagID:     dagID,
			Timestamp: time.Now(),
			Payload:   map[string]any{},
		})
		o.logger.Info("DAG completed", "dagId", dagID)
	case "failed", "cancelled":
		_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
			Type:      "dag:failed",
			DagID:     dagID,
			Timestamp: time.Now(),
			Payload:   map[string]any{"aggregateStatus": aggregateStatus},
		})
		o.logger.Info("DAG ended with failure", "dagId", dagID, "aggregateStatus", aggregateStatus)
	default:
		// "paused" / "needs_retry" / "pending" ??DAG is terminal but in a
		// non-completed/non-failed aggregate state (e.g. all nodes PAUSED
		// then cancelled). Emit a generic terminal event for observability.
		_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
			Type:      "dag:terminal",
			DagID:     dagID,
			Timestamp: time.Now(),
			Payload:   map[string]any{"aggregateStatus": aggregateStatus},
		})
		o.logger.Info("DAG reached terminal aggregate state", "dagId", dagID, "aggregateStatus", aggregateStatus)
	}
	return nil
}

// GetDagStatus returns the status of all nodes in a DAG.
func (o *DagOrchestrator) GetDagStatus(dagID string) *DagStatusResult {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return nil
	}
	dag.mu.Lock()
	defer dag.mu.Unlock()
	result := &DagStatusResult{
		DagID: dagID,
		Nodes: make([]NodeStatus, 0, len(dag.nodes)),
	}
	for id, node := range dag.nodes {
		result.Nodes = append(result.Nodes, NodeStatus{
			NodeID: id,
			State:  node.fsm.State(),
			Phase:  node.definition.Phase,
		})
	}
	return result
}

// DagStatusResult is the query result for GetDagStatus.
type DagStatusResult struct {
	DagID string
	Nodes []NodeStatus
}

// NodeStatus is a single node's status within a DAG status query.
type NodeStatus struct {
	NodeID string
	State  orchestrator.NodeState
	Phase  orchestrator.TaskPhase
}

// GetDagSnapshot returns a snapshot of the DAG for persistence.
func (o *DagOrchestrator) GetDagSnapshot(dagID string) *orchestrator.DagSnapshot {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return nil
	}
	dag.mu.Lock()
	defer dag.mu.Unlock()
	return o.buildDagSnapshot(dag)
}

// buildDagSnapshot assembles a snapshot from a dag whose mu is held.
func (o *DagOrchestrator) buildDagSnapshot(dag *dagInstance) *orchestrator.DagSnapshot {
	nodeStates := make([]orchestrator.NodeSnapshot, 0, len(dag.nodes))
	for id, node := range dag.nodes {
		nodeStates = append(nodeStates, orchestrator.NodeSnapshot{
			NodeID:  id,
			State:   node.fsm.State(),
			Error:   node.fsm.Error(),
			History: node.fsm.GetHistory(),
			Result:  node.result,
		})
	}
	return &orchestrator.DagSnapshot{
		DagID:      dag.id,
		Definition: dag.definition,
		NodeStates: nodeStates,
		CreatedAt:  dag.createdAt,
	}
}

// GetAllDagSnapshots returns snapshots of all DAGs for batch persistence.
func (o *DagOrchestrator) GetAllDagSnapshots() []orchestrator.DagSnapshot {
	o.dagsMu.RLock()
	dags := make([]*dagInstance, 0, len(o.dags))
	for _, d := range o.dags {
		dags = append(dags, d)
	}
	o.dagsMu.RUnlock()

	out := make([]orchestrator.DagSnapshot, 0, len(dags))
	for _, d := range dags {
		d.mu.Lock()
		snap := o.buildDagSnapshot(d)
		d.mu.Unlock()
		if snap != nil {
			out = append(out, *snap)
		}
	}
	return out
}

// RestoreDagForTest exposes snapshot restore + counter recomputation
// for integration tests, simulating what Initialize does after loading
// a persisted snapshot.
func (o *DagOrchestrator) RestoreDagForTest(snap orchestrator.DagSnapshot) error {
	if err := o.restoreDag(snap); err != nil {
		return err
	}
	o.recomputeActivationCounters()
	return nil
}

// restoreDag rebuilds a DAG instance from a snapshot.
func (o *DagOrchestrator) restoreDag(snap orchestrator.DagSnapshot) error {
	dag := &dagInstance{
		id:         snap.DagID,
		definition: snap.Definition,
		nodes:      make(map[string]*dagNodeInstance),
		createdAt:  snap.CreatedAt,
	}
	// Rebuild the in-memory topology index from the persisted definition
	// (pure function; the index carries no authoritative state).
	if graphIdx, err := buildGraphIndex(snap.Definition); err == nil {
		dag.graphIdx = graphIdx
	} else {
		o.logger.Warn("Failed to rebuild graph index from snapshot", "dagId", snap.DagID, "error", err.Error())
	}
	for _, ns := range snap.NodeStates {
		var nodeDef *orchestrator.DagNodeDefinition
		for i := range snap.Definition.Nodes {
			if snap.Definition.Nodes[i].ID == ns.NodeID {
				nodeDef = &snap.Definition.Nodes[i]
				break
			}
		}
		if nodeDef == nil {
			continue
		}
		fsm := orchestrator.NewTaskStateMachine(snap.DagID, ns.NodeID, nodeDef.Phase, *nodeDef)
		// Strategy layer: resolve policy from definition or registry so
		// restored nodes get the same guard/action/retry behavior as
		// freshly-submitted ones.
		if fsm.Policy() == nil {
			if p := o.resolvePolicy(*nodeDef); p != nil {
				fsm.SetPolicy(p)
			}
		}
		fsm.RestoreFromSnapshot(ns.History, ns.Error)
		// M7 onRestart strategy: a node found in RUNNING or VERIFYING
		// state after a restart cannot continue (no executor is
		// driving it). The policy's onRestart decides its fate:
		//   - resumableVerify && retryCount < 2 ??RESUME_VERIFY
		//     (StateReconciler resumes from checkpoint on the next
		//     activation pass)
		//   - otherwise ??FAILED (user can retry manually)
		// Without a policy, RUNNING falls back to READY (re-schedule)
		// and VERIFYING falls back to FAILED (cannot resume).
		// Previously these nodes were left stranded, causing deadlocks
		// (audit S1 / B1 / B2).
		restoredState := fsm.State()
		if restoredState == orchestrator.NodeStateRunning || restoredState == orchestrator.NodeStateVerifying {
			targetState := defaultOnRestart(restoredState)
			if p := fsm.Policy(); p != nil && p.OnRestart != nil {
				if s := p.OnRestart(fsm.Context()); s != "" {
					targetState = s
				}
			}
			if targetState != restoredState && fsm.CanTransitionTo(targetState) {
				_ = fsm.Transition(targetState, orchestrator.TransitionContext{
					Reason:      "restart recovery via onRestart policy",
					TriggeredBy: "system",
				})
				o.logger.Info("Restart recovery transition", "dagId", snap.DagID, "nodeId", ns.NodeID, "from", restoredState, "to", targetState)
			}
		}
		dag.nodes[ns.NodeID] = &dagNodeInstance{
			definition: *nodeDef,
			fsm:        fsm,
			result:     ns.Result,
		}
	}
	o.dagsMu.Lock()
	o.dags[snap.DagID] = dag
	o.dagsMu.Unlock()
	o.logger.Info("DAG restored", "dagId", snap.DagID, "nodeCount", len(snap.NodeStates))
	return nil
}

// applyEvent replays a single event onto the in-memory DAG state.
func (o *DagOrchestrator) applyEvent(event orchestrator.DagEvent) error {
	if event.NodeID == "" {
		return nil
	}
	o.dagsMu.RLock()
	defer o.dagsMu.RUnlock()
	for _, dag := range o.dags {
		dag.mu.Lock()
		node, exists := dag.nodes[event.NodeID]
		if !exists {
			continue
		}
		switch event.Type {
		case "dag:nodeStateChanged":
			payload, ok := event.Payload["context"].(map[string]any)
			if !ok {
				continue
			}
			fromStr, _ := event.Payload["from"].(string)
			toStr, _ := event.Payload["to"].(string)
			if string(node.fsm.State()) == fromStr {
				_ = node.fsm.Transition(orchestrator.NodeState(toStr), orchestrator.TransitionContext{
					Reason:      getString(payload, "reason"),
					TriggeredBy: getString(payload, "triggeredBy"),
				})
			}
		case "dag:nodeCompleted":
			if resultData, ok := event.Payload["result"].(map[string]any); ok {
				success, _ := resultData["success"].(bool)
				node.result = &orchestrator.NodeExecutionResult{
					Success: success,
					Data:    resultData,
				}
			}
		}
		dag.mu.Unlock()
		break
	}
	return nil
}

// CreateSnapshot persists all DAG snapshots to the event store.
func (o *DagOrchestrator) CreateSnapshot(ctx context.Context) error {
	snapshots := o.GetAllDagSnapshots()
	return o.eventStore.Snapshot(ctx, snapshots)
}

// Shutdown performs the full graceful-stop sequence: drain the
// scheduler (wait for running nodes or cancel them at the deadline),
// flush the async event writer so every queued event is persisted, then
// take a final snapshot so a subsequent restart restores a consistent
// PAUSED/resumable state. The scheduler must implement DrainStopper.
type DrainStopper interface {
	StopWithDrain(ctx context.Context) bool
}

func (o *DagOrchestrator) Shutdown(ctx context.Context) error {
	if ds, ok := o.scheduler.(DrainStopper); ok {
		drained := ds.StopWithDrain(ctx)
		if !drained {
			o.logger.Warn("Scheduler drain timed out; running nodes were cancelled")
		}
	} else if o.scheduler != nil {
		o.logger.Warn("Scheduler does not support drain; stopping without waiting")
	}
	o.eventStore.Flush()
	if err := o.CreateSnapshot(ctx); err != nil {
		return err
	}
	o.logger.Info("DagOrchestrator shutdown completed")
	return nil
}

// GetStats returns aggregate orchestrator metrics.
func (o *DagOrchestrator) GetStats() orchestrator.DagOrchestratorStats {
	o.dagsMu.RLock()
	dags := make([]*dagInstance, 0, len(o.dags))
	for _, d := range o.dags {
		dags = append(dags, d)
	}
	o.dagsMu.RUnlock()

	activeDags := 0
	totalNodes := 0
	for _, dag := range dags {
		dag.mu.Lock()
		hasActive := false
		for _, node := range dag.nodes {
			if !orchestrator.IsTerminalState(node.fsm.State()) {
				hasActive = true
			}
			totalNodes++
		}
		if hasActive {
			activeDags++
		}
		dag.mu.Unlock()
	}
	return orchestrator.DagOrchestratorStats{
		TotalDags:  len(dags),
		ActiveDags: activeDags,
		TotalNodes: totalNodes,
	}
}

// IsInitialized reports whether Initialize has been called.
func (o *DagOrchestrator) IsInitialized() bool {
	o.dagsMu.RLock()
	defer o.dagsMu.RUnlock()
	return o.initialized
}

// ═══ Dynamic Runtime Mutation APIs (Stage 5) ═══

// AddNode injects a new node into a running DAG. If the node has no
// unsatisfied dependencies at insertion time it is immediately
// activated; otherwise it enters PENDING state and waits for its deps
// via the normal completion-propagation path.
func (o *DagOrchestrator) AddNode(ctx context.Context, dagID string, nodeDef orchestrator.DagNodeDefinition) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	if _, exists := dag.nodes[nodeDef.ID]; exists {
		dag.mu.Unlock()
		return fmt.Errorf("node %s already exists in DAG %s", nodeDef.ID, dagID)
	}

	// Register in the graph index so dependents can reference it. The
	// vertex is added without edges; dependencies are connected via
	// AddDependency or via the definition's Dependencies field by the
	// batch AddDependencies flow.
	if dag.graphIdx != nil {
		if err := dag.graphIdx.addVertex(nodeDef.ID); err != nil {
			dag.mu.Unlock()
			return fmt.Errorf("add vertex to graph index: %w", err)
		}
		// Wire dependencies declared in the definition.
		for _, depID := range nodeDef.Dependencies {
			if depNode, depExists := dag.nodes[depID]; depExists {
				_ = depNode // referenced for existence check
			}
			if err := dag.graphIdx.addEdge(depID, nodeDef.ID); err != nil {
				dag.mu.Unlock()
				return fmt.Errorf("add edge %s->%s: %w", depID, nodeDef.ID, err)
			}
		}
	}

	fsm := orchestrator.NewTaskStateMachine(dagID, nodeDef.ID, nodeDef.Phase, nodeDef)
	ni := &dagNodeInstance{
		definition: nodeDef,
		fsm:        fsm,
		result:     nil,
	}

	// Compute completedDeps from current DAG state so the incremental
	// counter is truthful from insertion time.
	for _, depID := range nodeDef.Dependencies {
		if dep, depExists := dag.nodes[depID]; depExists {
			depState := dep.fsm.State()
			if depState == orchestrator.NodeStateCompleted {
				ni.completedDeps++
			} else if dep.definition.NonCritical && (depState == orchestrator.NodeStateFailed || depState == orchestrator.NodeStateTimeout) {
				ni.completedDeps++
			}
		}
	}

	dag.nodes[nodeDef.ID] = ni

	allDepsMet := ni.completedDeps >= len(nodeDef.Dependencies)
	dag.mu.Unlock()

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nodeAdded",
		DagID:     dagID,
		NodeID:    nodeDef.ID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"taskType": string(nodeDef.TaskType), "phase": string(nodeDef.Phase)},
	})

	o.logger.Info("Node dynamically added", "dagId", dagID, "nodeId", nodeDef.ID)

	if allDepsMet {
		if err := ni.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "dependencies satisfied at insertion",
			TriggeredBy: "system",
		}); err != nil {
			return err
		}
		if err := ni.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "submitted to scheduler",
			TriggeredBy: "system",
		}); err != nil {
			return err
		}
		o.submitToScheduler(ctx, nodeDef.ID, dagID, ni)
	}

	return nil
}

// AddDependency registers a runtime dependency between two nodes in a
// running DAG. The edge is added to the graph index; if the parent is
// already completed (or non-critically failed) the child's
// completedDeps counter is adjusted immediately, and the child may be
// activated if all its deps are now satisfied.
func (o *DagOrchestrator) AddDependency(ctx context.Context, dagID, parentID, childID string) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	parent, parentExists := dag.nodes[parentID]
	child, childExists := dag.nodes[childID]
	if !parentExists || !childExists {
		dag.mu.Unlock()
		return fmt.Errorf("parent %s or child %s not found in DAG %s", parentID, childID, dagID)
	}

	// Check for cycle via graph index before applying.
	if dag.graphIdx != nil {
		if err := dag.graphIdx.addEdge(parentID, childID); err != nil {
			dag.mu.Unlock()
			return fmt.Errorf("add dependency %s->%s: %w", parentID, childID, err)
		}
	}

	// Also update the child's definition for snapshot fidelity.
	child.definition.Dependencies = append(child.definition.Dependencies, parentID)

	// If parent is already satisfied, bump child's completedDeps
	// immediately. This avoids the child waiting forever for an event
	// that already fired.
	parentState := parent.fsm.State()
	if parentState == orchestrator.NodeStateCompleted ||
		(parent.definition.NonCritical && (parentState == orchestrator.NodeStateFailed || parentState == orchestrator.NodeStateTimeout)) {
		child.completedDeps++
	}

	allDepsMet := child.completedDeps >= len(child.definition.Dependencies)
	dag.mu.Unlock()

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:dependencyAdded",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"parentId": parentID, "childId": childID},
	})

	o.logger.Info("Dependency added", "dagId", dagID, "parentId", parentID, "childId", childID)

	// If the child is still PENDING and all deps are now met, activate it.
	if allDepsMet && child.fsm.State() == orchestrator.NodeStatePending {
		if err := child.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "dependencies satisfied after dynamic edge addition",
			TriggeredBy: "system",
		}); err != nil {
			return err
		}
		if err := child.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "submitted to scheduler",
			TriggeredBy: "system",
		}); err != nil {
			return err
		}
		o.submitToScheduler(ctx, childID, dagID, child)
	}

	return nil
}

// SetNonCritical toggles a node's NonCritical flag at runtime. If the
// node has already failed and the flag is being set to true, any
// PENDING dependents whose deps are now fully satisfied (because this
// failure no longer blocks them) are activated.
func (o *DagOrchestrator) SetNonCritical(ctx context.Context, dagID, nodeID string, nonCritical bool) error {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	node, exists := dag.nodes[nodeID]
	if !exists {
		dag.mu.Unlock()
		return orchestrator.ErrNodeNotFound
	}

	previous := node.definition.NonCritical
	node.definition.NonCritical = nonCritical

	// If switching from critical to non-critical AND the node is already
	// in a terminal failure state, propagate to unblock dependents.
	shouldPropagate := !previous && nonCritical &&
		(node.fsm.State() == orchestrator.NodeStateFailed || node.fsm.State() == orchestrator.NodeStateTimeout)

	var toActivate []*dagNodeInstance
	if shouldPropagate && dag.graphIdx != nil {
		for _, succID := range dag.graphIdx.directSuccessors(nodeID) {
			succ, succExists := dag.nodes[succID]
			if !succExists || succ.fsm.State() != orchestrator.NodeStatePending {
				continue
			}
			succ.completedDeps++
			if succ.completedDeps < len(succ.definition.Dependencies) {
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
				Reason:      "dependencies satisfied after NonCritical toggle",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
				Reason:      "submitted to scheduler",
				TriggeredBy: "system",
			}); err != nil {
				continue
			}
			toActivate = append(toActivate, succ)
		}
	}
	dag.mu.Unlock()

	for _, node := range toActivate {
		o.submitToScheduler(ctx, node.definition.ID, dagID, node)
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nonCriticalToggled",
		DagID:     dagID,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"nonCritical": nonCritical, "previous": previous},
	})

	o.logger.Info("Node NonCritical flag toggled", "dagId", dagID, "nodeId", nodeID, "nonCritical", nonCritical, "previous", previous)
	return nil
}

// ═══ Helpers ═══

// ReactivateDagNodes re-scans a specific DAG for READY nodes and submits
// them to the scheduler. This is used by the CLI `trigger` command and
// the API trigger endpoint to recover stuck nodes after dependency
// modifications or slot pool recovery.
func (o *DagOrchestrator) ReactivateDagNodes(ctx context.Context, dagID string) error {
	return o.activateReadyNodes(ctx, dagID)
}

// RemoveDag removes a DAG from the orchestrator's memory. Only DAGs in
// terminal states (all nodes completed, cancelled, or failed) can be
// removed. Active DAGs must be cancelled first.
func (o *DagOrchestrator) RemoveDag(ctx context.Context, dagID string) error {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()

	dag, ok := o.dags[dagID]
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	defer dag.mu.Unlock()

	// Verify all nodes are in terminal states
	for nodeID, node := range dag.nodes {
		state := node.fsm.State()
		if !orchestrator.IsTerminalState(state) {
			return fmt.Errorf("node %s is still in state %s (must be terminal)", nodeID, state)
		}
	}

	delete(o.dags, dagID)

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:deleted",
		DagID:     dagID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"reason": "user_requested"},
	})

	o.logger.Info("DAG removed", "dagId", dagID)
	return nil
}

func getString(m map[string]any, key string) string {
	v, ok := m[key].(string)
	if !ok {
		return ""
	}
	return v
}
