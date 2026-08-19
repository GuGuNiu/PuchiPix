package dag

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// OnNodeCompleted is called by the executor when a node finishes,
// recording the result and triggering downstream activation.
//
// Strategy layer (M5): on success, the orchestrator drives the
// VERIFYING/COMPLETED transition based on the node's policy:
//   - shouldVerify (default): RUNNING → VERIFYING → StateReconciler →
//     COMPLETED (passed) / FAILED (verify failed) / NEEDS_RETRY (data
//     missing, auto-retryable)
//   - skipVerify: RUNNING → COMPLETED directly
// On failure, the node transitions to FAILED (or TIMEOUT when the
// scheduler already detected a deadline). Previously the success path
// skipped VERIFYING entirely and left the node in RUNNING, which is the
// P7 audit defect — verify executors were registered but never invoked.
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
				// Legal path: RESUME_VERIFY -> VERIFYING -> NEEDS_RETRY
				// (direct resume_verify -> needs_retry is not allowed).
				if err := fsm.Transition(orchestrator.NodeStateVerifying, orchestrator.TransitionContext{
					Reason: "resume verification needs retry, re-entering verify", TriggeredBy: "reconciler",
				}); err == nil {
					_ = fsm.Transition(orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{
						Reason: "resume verification needs retry", TriggeredBy: "reconciler",
					})
				}
			default:
				_ = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
					Reason: "resume verification failed", TriggeredBy: "reconciler",
				})
			}
		}
	} else {
		// Failure safety net: ensure the node reaches a terminal state.
		if currentState == orchestrator.NodeStateRunning {
			// needs_retry (verify phase) is retryable: route to
			// NEEDS_RETRY and re-submit instead of hard-failing. The
			// scheduler flags it via result.Data["needsRetry"].
			if needsRetry, _ := result.Data["needsRetry"].(bool); needsRetry {
				reason := "verification needs retry"
				if r, _ := result.Data["needsRetryReason"].(string); r != "" {
					reason = r
				}
				if err := fsm.Transition(orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{
					Reason: reason, TriggeredBy: "reconciler",
				}); err == nil {
					// NEEDS_RETRY → READY is legal; submitRetry drives
					// the QUEUED + scheduler submission.
					if err2 := fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
						Reason: "retry after verification needs_retry", TriggeredBy: "system",
					}); err2 == nil {
						o.submitRetry(ctx, dagID, nodeID, node, 0)
					}
				}
			} else {
				_ = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{
					Reason: "execution failed", TriggeredBy: "scheduler",
					Error: result.Error,
				})
			}
		}
	}

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nodeCompleted",
		DagID:     dagID,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"result": result},
	})

	// Emit dag:nodeProgress so SSE/WS clients can track gallery DAG
	// progress in real-time without polling. Count terminal vs total
	// nodes to compute a progress percentage on the frontend.
	if o.eventBus != nil {
		dag.mu.Lock()
		terminalCount := 0
		totalCount := len(dag.nodes)
		failedCount := 0
		for _, n := range dag.nodes {
			state := n.fsm.State()
			if orchestrator.IsTerminalState(state) {
				terminalCount++
				if state == orchestrator.NodeStateFailed {
					failedCount++
				}
			}
		}
		// Capture the task type before unlocking for the event payload.
		taskType := dag.definition.TaskType
		dag.mu.Unlock()

		payload := map[string]any{
			"dagId":    dagID,
			"nodeId":   nodeID,
			"phase":    "node_completed",
			"current":  terminalCount,
			"total":    totalCount,
			"failed":   failedCount,
			"taskType": taskType,
		}
		// Carry the business entity ID (galleryId/taskId/sniffId) so the
		// frontend can map this DAG event back to the task WITHOUT parsing
		// the DAG ID format. Previously the frontend parsed "gallery-<id>"
		// prefixes from dagId — that implicit contract broke when DAG IDs
		// were unified to 6-char random codes (260804), silently killing
		// real-time gallery progress. The entity ID comes from the node
		// configs injected by DagFactory (galleryId/taskId/sniffId).
		if key, id, ok := extractEntityID(dag.definition); ok {
			payload[key] = id
		}

		o.eventBus.Emit("dag:nodeProgress", payload)
	}

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
// dag → policies → orchestrator, a cycle). It reads the same Config key.
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
		// Push the FSM state back to the entity tables so the DB and the
		// in-memory state machine never diverge on terminal transitions.
		// Previously this was a deferred TODO ("Phase 4 integration");
		// the gap caused galleries to stay at transient statuses while
		// the DAG reached failed — the DB status sync is now handled
		// through the injected callback (see SetStatusSyncFn), which
		// routes to the correct entity table via the node's config
		// (galleryId/taskId/sniffId). The callback is best-effort and
		// never blocks the transition.
		if o.statusSyncFn != nil {
			o.statusSyncFn(ctx, dagID, nodeID, node.definition, fsm.State())
		}
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

	// Resuming nodes makes this DAG non-terminal again.
	dag.mu.Lock()
	dag.allTerminal = false
	dag.mu.Unlock()

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

	// Retrying nodes makes this DAG non-terminal again.
	dag.mu.Lock()
	dag.allTerminal = false
	dag.mu.Unlock()

	for _, node := range nodesToRetry {
		// Strategy layer (M6): honor the policy's retryPolicy. When
		// retryCount >= maxAttempts, skip the retry and leave the node
		// in FAILED so the user is notified that the retry budget is
		// exhausted. When a backoff is configured, the re-submission is
		// scheduled asynchronously (SubmitWithDelay) so the caller is
		// never blocked by backoff sleeps. Without a policy, fall back
		// to the existing behavior (ResetRetryCount + immediate
		// re-schedule).
		fsmCtx := node.fsm.Context()
		policy := node.fsm.Policy()
		delayMs := int64(0)
		if policy != nil && policy.RetryPolicy != nil && policy.RetryPolicy.MaxAttempts > 0 {
			if fsmCtx.RetryCount >= policy.RetryPolicy.MaxAttempts {
				o.logger.Warn("Retry budget exhausted, skipping retry", "dagId", dagID, "nodeId", node.definition.ID, "retryCount", fsmCtx.RetryCount, "maxAttempts", policy.RetryPolicy.MaxAttempts)
				continue
			}
			delayMs = computeRetryBackoffMs(policy.RetryPolicy, fsmCtx.RetryCount)
		}
		node.fsm.ResetRetryCount()
		// A retried node must re-earn its successors: decrement their
		// completedDeps so they cannot activate until this node
		// completes again. This keeps the incremental counters truthful
		// across retry cycles. NonCritical nodes already counted as
		// satisfied are also decremented — they re-earn on re-completion.
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
				"backoffMs":  delayMs,
			},
		})

		// Move to READY immediately (accepting the retry and taking the
		// node out of the FAILED selection set), then submit now or
		// after the backoff delay without blocking this goroutine.
		_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
			Reason:      "user retry",
			TriggeredBy: "user",
		})
		o.submitRetry(ctx, dagID, node.definition.ID, node, time.Duration(delayMs)*time.Millisecond)
	}

	o.logger.Info("DAG retry nodes", "dagId", dagID, "nodeCount", len(nodesToRetry))
	return nil
}

// submitRetry transitions a retried node to QUEUED and submits it to
// the scheduler, either immediately or after the given backoff delay
// (non-blocking via time.AfterFunc). The delayed path re-validates the
// node is still READY at fire time so a concurrent pause/cancel cannot
// resurrect a dead node.
func (o *DagOrchestrator) submitRetry(ctx context.Context, dagID, nodeID string, node *dagNodeInstance, delay time.Duration) {
	if delay <= 0 {
		_ = node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "re-submitted to scheduler",
			TriggeredBy: "system",
		})
		o.submitToScheduler(ctx, nodeID, dagID, node)
		return
	}
	time.AfterFunc(delay, func() {
		o.dagsMu.RLock()
		dag, ok := o.dags[dagID]
		o.dagsMu.RUnlock()
		if !ok {
			return
		}
		dag.mu.Lock()
		n, exists := dag.nodes[nodeID]
		if !exists || n.fsm.State() != orchestrator.NodeStateReady {
			dag.mu.Unlock()
			return
		}
		dag.mu.Unlock()
		_ = n.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
			Reason:      "re-submitted to scheduler after backoff",
			TriggeredBy: "system",
		})
		o.submitToScheduler(context.Background(), nodeID, dagID, n)
	})
}

// computeRetryBackoffMs derives the retry delay from the policy and the
// current retry count. Strategies:
//
//   - "fixed": BackoffMs every attempt
//   - "exponential" (default): BackoffMs * 2^retryCount, capped at 1024x
//   - "exponential_jitter": random in [0, BackoffMs*2^retryCount] to
//     avoid synchronized retry storms across nodes
//
// Returns 0 when no backoff is configured.
func computeRetryBackoffMs(p *orchestrator.RetryPolicy, retryCount int) int64 {
	if p == nil || p.BackoffMs <= 0 {
		return 0
	}
	base := p.BackoffMs
	if p.BackoffStrategy != "fixed" {
		shift := uint(retryCount)
		if shift >= 10 { // cap to avoid overflow (max 1024x base)
			shift = 10
		}
		base = p.BackoffMs << shift
	}
	if p.BackoffStrategy == "exponential_jitter" {
		return rand.Int63n(base + 1)
	}
	return base
}

// UpdateNodePriority dynamically adjusts a node's scheduling priority
// at runtime. The new priority is persisted to the node definition
// (snapshot truth) and, when the node is currently queued, applied to
// the ready queue immediately so the scheduler reorders it ahead of
// lower-priority peers. Returns an error when the DAG or node does not
// exist or the priority is invalid.
func (o *DagOrchestrator) UpdateNodePriority(ctx context.Context, dagID, nodeID string, newPriority orchestrator.TaskPriority) error {
	if newPriority <= 0 {
		return fmt.Errorf("invalid priority %d", newPriority)
	}
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
	node.definition.Priority = newPriority
	if o.scheduler != nil {
		o.scheduler.UpdateNodePriority(dagID, nodeID, int(newPriority))
	}
	dag.mu.Unlock()

	_ = o.eventStore.AppendAsync(ctx, orchestrator.DagEvent{
		Type:      "dag:nodePriorityChanged",
		DagID:     dagID,
		NodeID:    nodeID,
		Timestamp: time.Now(),
		Payload:   map[string]any{"priority": int(newPriority)},
	})
	o.logger.Info("Node priority updated", "dagId", dagID, "nodeId", nodeID, "priority", newPriority)
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
	dag.allTerminal = allTerminal
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
		// Sync the DB-side status so the frontend shows the failure even
		// though the executors wrote a local completed/partial earlier
		// (previously the FSM reached failed while galleries.status stayed
		// 'completed' — a silent divergence). Only gallery DAGs map to a
		// galleries row by dagID.
		if o.eventBus != nil {
			ev := map[string]any{
				"dagId":  dagID,
				"status": aggregateStatus, // "failed" | "cancelled"
			}
			// Carry the galleryId so the frontend can update the gallery
			// without parsing the DAG ID format (see extractEntityID).
			if key, id, ok := extractEntityID(dag.definition); ok && key == "galleryId" {
				ev["galleryId"] = id
			}
			o.eventBus.Emit("gallery:stateChanged", ev)
		}
	default:
		// "paused" / "needs_retry" / "pending" — DAG is terminal but in a
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

	// The DAG is terminal: lift task-level slot quotas so its slot
	// footprint no longer reserves capacity. In-flight holders release
	// individually via the executor defer path.
	if sp, ok := o.slotPool.(*slot.SlotPool); ok {
		sp.ClearDagQuota(dagID)
	}
	return nil
}

// extractEntityID reads the business entity ID (galleryId / taskId /
// sniffId) that DagFactory injects into node configs, so SSE/WS event
// payloads can reference the owning task WITHOUT parsing the DAG ID
// format. Returns the config key ("galleryId"/"taskId"/"sniffId"), the
// numeric ID, and true when found.
//
// Motivation: after DAG IDs were unified to 6-char random codes
// (260804), the frontend's previous "gallery-<id>" prefix parsing of
// dagId could no longer resolve the entity — silently breaking
// real-time gallery progress/status updates. Carrying the entity ID in
// the event payload decouples the frontend from the DAG ID encoding.
func extractEntityID(def orchestrator.DagDefinition) (string, int, bool) {
	for _, node := range def.Nodes {
		for _, key := range []string{"galleryId", "taskId", "sniffId"} {
			if v, ok := node.Config[key]; ok {
				switch t := v.(type) {
				case int:
					return key, t, true
				case float64:
					return key, int(t), true
				}
			}
		}
	}
	return "", 0, false
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
