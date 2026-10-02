package dag

import (
	"context"
	"fmt"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// activateReadyNodes drives the full node activation pass: nodes whose
// dependencies are met move to READY then QUEUED and are submitted,
// already-QUEUED nodes missing from the scheduler are recovered and
// re-submitted, and RESUME_VERIFY nodes are re-verified. Returns the
// number of nodes submitted (or re-submitted) in this pass.
func (o *DagOrchestrator) activateReadyNodes(ctx context.Context, dagID string) (int, error) {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok {
		return 0, orchestrator.ErrDagNotFound
	}
	dag.mu.Lock()

	type pendingSubmit struct {
		nodeID string
		node   *dagNodeInstance
	}
	var toSubmit []pendingSubmit
	var orphaned []pendingSubmit
	// RESUME_VERIFY nodes (produced by restoreDag's onRestart policy
	// when resumableVerify is true) are stranded after restart: nothing
	// re-drives their verification. Collect them here and run the
	// reconciler after the lock is released (runVerification
	// re-acquires dag.mu, so it must never be called while holding it).
	var toResumeVerify []pendingSubmit

	for nodeID, node := range dag.nodes {
		state := node.fsm.State()

		// RESUME_VERIFY recovery: re-run verification on the side effects.
		// passed -> COMPLETED, needs_retry -> re-submit for retry,
		// failed -> FAILED.
		if state == orchestrator.NodeStateResumeVerify {
			toResumeVerify = append(toResumeVerify, pendingSubmit{nodeID: nodeID, node: node})
			continue
		}

		// A node ALREADY in QUEUED at entry is a leftover from a previous
		// activation pass. If the scheduler lost it, recover by rolling
		// back and re-submitting. This check must run BEFORE new QUEUED
		// transitions below, otherwise freshly-queued nodes (not yet
		// submitted, since submission happens after unlock) would be
		// misclassified as orphans and rolled back.
		if state == orchestrator.NodeStateQueued && o.scheduler != nil && !o.scheduler.HasNode(dagID, nodeID) {
			o.logger.Info("Recovering orphaned QUEUED node", "dagId", dagID, "nodeId", nodeID)
			orphaned = append(orphaned, pendingSubmit{nodeID: nodeID, node: node})
			continue
		}

		// PENDING and PREPARING (optimistic_preparing from the API retry
		// path) are both activation-eligible: a PREPARING node whose
		// dependencies completed must proceed to READY, otherwise the
		// DAG wedges forever.
		if state == orchestrator.NodeStatePending || state == orchestrator.NodeStatePreparing {
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

	// Drive RESUME_VERIFY nodes through the reconciler. The verdict
	// decides the terminal/retry path; needs_retry re-enters the
	// scheduler via READY → QUEUED so the executor re-runs.
	for _, item := range toResumeVerify {
		verdict := o.runVerification(ctx, dagID, item.nodeID, item.node.fsm)
		switch verdict {
		case "passed":
			_ = item.node.fsm.Transition(orchestrator.NodeStateCompleted, orchestrator.TransitionContext{
				Reason: "resume verification passed", TriggeredBy: "reconciler",
			})
		case "needs_retry":
			// The legal path is RESUME_VERIFY to VERIFYING to NEEDS_RETRY;
			// resume_verify to needs_retry is not in validTransitions.
			// Then NEEDS_RETRY to READY to QUEUED re-enters the scheduler
			// so the executor re-runs instead of stalling until a manual
			// RetryDag.
			if err := item.node.fsm.Transition(orchestrator.NodeStateVerifying, orchestrator.TransitionContext{
				Reason: "resume verification needs retry, re-entering verify", TriggeredBy: "reconciler",
			}); err == nil {
				if err2 := item.node.fsm.Transition(orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{
					Reason: "resume verification needs retry", TriggeredBy: "reconciler",
				}); err2 == nil {
					if err3 := item.node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
						Reason: "retry after resume verification", TriggeredBy: "system",
					}); err3 == nil {
						_ = item.node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
							Reason: "re-submitted after resume verification", TriggeredBy: "system",
						})
						o.submitToScheduler(ctx, item.nodeID, dagID, item.node)
					}
				}
			}
		default:
			_ = item.node.fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
				Reason: "resume verification failed", TriggeredBy: "reconciler",
			})
		}
		o.propagateCompletion(ctx, dagID, item.nodeID)
	}

	return len(toSubmit) + len(orphaned) + len(toResumeVerify), nil
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

	completedNode, exists := dag.nodes[completedNodeID]
	if !exists {
		dag.mu.Unlock()
		return
	}
	completedState := completedNode.fsm.State()
	if completedState != orchestrator.NodeStateCompleted &&
		!(completedNode.definition.NonCritical && (completedState == orchestrator.NodeStateFailed || completedState == orchestrator.NodeStateTimeout)) {
		dag.mu.Unlock()
		return
	}

	var toSubmit []*dagNodeInstance
	if dag.graphIdx != nil {
		for _, succID := range dag.graphIdx.directSuccessors(completedNodeID) {
			succ, exists := dag.nodes[succID]
			if !exists {
				continue
			}
			succ.completedDeps++
			// Accept PENDING and PREPARING: the API's optimistic
			// "optimistic_preparing" transition moves not-yet-run nodes to
			// PREPARING immediately after submit, so restricting this to
			// PENDING leaves a dependent whose deps complete later stuck in
			// PREPARING with the DAG wedged.
			state := succ.fsm.State()
			if state != orchestrator.NodeStatePending && state != orchestrator.NodeStatePreparing {
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
}

// nodeSiteID reads the site identifier the DAG factory injected into a node's
// config. Nodes built before the key existed, or by pipelines that have no
// site binding, return an empty string and skip domain balancing.
func nodeSiteID(config map[string]any) string {
	if raw, ok := config["siteId"]; ok {
		if s, isString := raw.(string); isString {
			return s
		}
	}
	return ""
}

// submitToScheduler builds a SchedulableNode from the definition and
// submits it to the scheduler, rolling back to READY if rejected.
//
// When a flow controller is configured, Ask() is called BEFORE the
// scheduler's Submit(). If admission is denied (the factory is under
// high pressure), the node remains in QUEUED state and is retried by the
// auto-reactivation ticker. This is the "front gate" pattern: the flow
// controller is the checkpoint at the factory entrance, pacing tasks so
// the factory floor never gets overwhelmed.
//
// No submission jitter is applied. Blocking the caller would stall
// activation pipelines, and cross-DAG fairness in ReadyQueue
// (dagDispatchCount) already prevents thundering-herd contention by
// alternating among DAGs at the same priority level.
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

	// Flow control: ask the admission controller for permission before
	// entering the scheduler. If denied, leave the node in QUEUED so the
	// auto-reactivation ticker retries it later.
	//
	// TRY-mode (non-blocking) is mandatory: a blocking Acquire would stall
	// sequential callers such as ResumeDag at the first token-deficient
	// node, leaving every subsequent node stuck.
	if o.flowController != nil {
		if !o.flowController.TryAsk() {
			// Admission denied. The node stays in QUEUED and the
			// auto-reactivation ticker will retry. Do NOT roll back
			// to READY, that would push it to the back of the line
			// and cause unnecessary churn.
			o.logger.Debug("Admission denied (non-blocking), node queued for retry",
				"nodeId", nodeID, "dagId", dagID)
			return
		}
	}

	// Per-domain admission: reserve capacity on one of the site's mirror
	// domains. Same non-blocking contract as the flow controller above, and
	// the same consequence on denial — the node stays QUEUED. Because the
	// retry re-runs this function, the fresh attempt re-picks a domain and
	// lands wherever capacity has since freed up.
	//
	// An empty reserved domain means the site has no known domains, which
	// TryAdmit reports as admitted: there is nothing to balance against, so
	// the node proceeds ungated.
	if o.domainAdmission != nil {
		domain, admitted := o.domainAdmission.TryAdmit(nodeSiteID(node.definition.Config))
		if !admitted {
			o.logger.Debug("Domain admission denied, node queued for retry",
				infra.LogContext{
					NodeID: nodeID,
					DagID:  dagID,
					Extra:  map[string]any{"siteId": nodeSiteID(node.definition.Config)},
				})
			return
		}
		if domain != "" {
			o.recordDomainReservation(dagID, nodeID, domain)
		}
	}

	submitted := o.scheduler.Submit(schedulable)
	if !submitted {
		_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "submit failed, rolling back",
			TriggeredBy: "system",
		})
		o.logger.Warn("Node submit failed (queue full)", "nodeId", nodeID)
	}

	// Report the node's post-submit state to the entity tables. On a
	// successful submit the node is QUEUED; on a rejection it has rolled
	// back to READY. Without this sync, rejected nodes left the DB status
	// stuck at "scraping" even though they were never scheduled.
	if o.statusSyncFn != nil {
		o.statusSyncFn(ctx, dagID, nodeID, node.definition, node.fsm.State())
	}
}

func convertResourceReqs(reqs []orchestrator.ResourceRequirement) []orchestrator.ResourceRequirement {
	out := make([]orchestrator.ResourceRequirement, len(reqs))
	copy(out, reqs)
	return out
}

// cascadeFailureToDependents fails every not-yet-executed node reachable
// from a critically-failed node, so the DAG converges to a terminal
// state instead of stranding successors in PENDING forever. Nodes
// already past PENDING (READY/QUEUED/ALLOCATED/RUNNING) are cancelled
// out of the scheduler and released from the slot pool before being
// failed. Each cascaded node's entity status is synced to the DB
// (failed) so the frontend shows the real outcome.
func (o *DagOrchestrator) cascadeFailureToDependents(ctx context.Context, dagID, failedNodeID string) {
	o.dagsMu.RLock()
	dag, ok := o.dags[dagID]
	o.dagsMu.RUnlock()
	if !ok || dag.graphIdx == nil {
		return
	}

	dag.mu.Lock()
	var toSync []*dagNodeInstance
	var visit func(nodeID string)
	visit = func(nodeID string) {
		for _, succID := range dag.graphIdx.directSuccessors(nodeID) {
			succ, exists := dag.nodes[succID]
			if !exists || orchestrator.IsTerminalState(succ.fsm.State()) {
				continue
			}
			if o.scheduler != nil {
				o.scheduler.CancelNode(dagID, succID)
			}
			holderID := fmt.Sprintf("%s:%s", dagID, succID)
			if sp, ok := o.slotPool.(*slot.SlotPool); ok {
				sp.ReleaseAll(holderID)
			}
			if err := succ.fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
				Reason:      "cascaded failure from critical dependency " + nodeID,
				TriggeredBy: "system",
			}); err == nil {
				toSync = append(toSync, succ)
				// Stop an in-flight executor of the cascaded node AFTER it
				// reached FAILED, for the same ordering rationale as PauseDag:
				// cancelling first could let the executor's report flip a
				// RUNNING node via the OnNodeCompleted failure path.
				if o.scheduler != nil {
					o.scheduler.CancelRunningNode(dagID, succID)
				}
				visit(succID)
			}
		}
	}
	visit(failedNodeID)
	dag.mu.Unlock()

	for _, node := range toSync {
		if o.statusSyncFn != nil {
			o.statusSyncFn(ctx, dagID, node.definition.ID, node.definition, node.fsm.State())
		}
	}
	if len(toSync) > 0 {
		o.logger.Info("Cascaded failure to dependent nodes",
			"dagId", dagID, "from", failedNodeID, "cascaded", len(toSync))
	}
}

// ReactivateReadyNodes scans all DAGs for READY nodes and re-submits
// them to the scheduler, which is what keeps READY nodes from
// deadlocking when the queue was full.
//
// DAGs whose allTerminal flag is true are skipped entirely, reducing the
// periodic scan from O(dags*nodes) to O(activeDags*nodes) in the common
// idle case where dozens of completed DAGs persist in memory.
func (o *DagOrchestrator) ReactivateReadyNodes(ctx context.Context) {
	o.dagsMu.RLock()
	dagIDs := make([]string, 0, len(o.dags))
	for id, dag := range o.dags {
		dag.mu.Lock()
		skip := dag.allTerminal
		dag.mu.Unlock()
		if skip {
			continue
		}
		dagIDs = append(dagIDs, id)
	}
	o.dagsMu.RUnlock()

	totalSubmitted := 0
	for _, dagID := range dagIDs {
		n, err := o.activateReadyNodes(ctx, dagID)
		if err != nil {
			o.logger.Error("Failed to reactivate READY nodes", err, "dagId", dagID)
			continue
		}
		totalSubmitted += n
	}

	if totalSubmitted == 0 {
		// No-op pass (the common case for the periodic auto-reactivation
		// ticker): keep the log quiet so idle scans do not drown out
		// real signals.
		o.logger.Debug("ReactivateReadyNodes no-op", "dagCount", len(dagIDs))
		return
	}
	o.logger.Info("ReactivateReadyNodes completed", "dagCount", len(dagIDs), "submitted", totalSubmitted)
}

// StartAutoReactivation runs a periodic scan that re-submits nodes
// stuck in READY. A READY node is the terminal state of a rejected
// Submit (queue full / draining): submitToScheduler rolls QUEUED back
// to READY, and nothing else ever picks it up again — OnSlotFreed only
// dispatches nodes already in the scheduler's ready queue, so the node
// would sit in READY forever and its DAG would never finish.
//
// The periodic pass converges naturally: while the queue is full the
// re-submit is rejected again and the node returns to READY; once
// capacity frees up, the next tick submits it successfully.
//
// The ticker stops when ctx is cancelled (tie it to shutdown).
// Idempotent: calling it twice starts only one goroutine.
func (o *DagOrchestrator) StartAutoReactivation(ctx context.Context, interval time.Duration) {
	o.dagsMu.Lock()
	if o.reactivationStarted {
		o.dagsMu.Unlock()
		return
	}
	o.reactivationStarted = true
	o.dagsMu.Unlock()

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				o.ReactivateReadyNodes(ctx)
			case <-ctx.Done():
				o.logger.Info("Auto reactivation stopped")
				return
			}
		}
	}()
}

// ReactivateDagNodes re-scans a specific DAG for READY nodes and submits
// them to the scheduler. This is used by the CLI `trigger` command and
// the API trigger endpoint to recover stuck nodes after dependency
// modifications or slot pool recovery.
func (o *DagOrchestrator) ReactivateDagNodes(ctx context.Context, dagID string) error {
	_, err := o.activateReadyNodes(ctx, dagID)
	return err
}
