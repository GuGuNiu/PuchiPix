package dag

import (
	"context"
	"strings"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// PauseDagNode pauses a single node of a DAG, leaving the rest of the
// pipeline untouched. It is the per-node variant of PauseDag used by the
// slot cap enforcement: when a slot type's max is lowered, the newest-held
// holders are paused so running work converges to the new limit without
// losing progress. The same ordering rules as PauseDag apply: the executor
// is cancelled AFTER the node reached its paused target state so the
// executor's failure report cannot flip a paused node to FAILED.
func (o *DagOrchestrator) PauseDagNode(ctx context.Context, dagID, nodeID string) error {
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
	state := node.fsm.State()
	if orchestrator.IsDeletableState(state) || state == orchestrator.NodeStatePaused {
		// Already settled: nothing to pause, report success so the cap
		// loop does not spin on this holder.
		dag.mu.Unlock()
		return nil
	}
	if o.scheduler != nil {
		o.scheduler.CancelNode(dagID, nodeID)
	}
	holderID := dagID + ":" + nodeID
	if sp, ok := o.slotPool.(*slot.SlotPool); ok {
		sp.ReleaseAll(holderID)
	}
	// Ask the policy where this node should land (scrape nodes may go to
	// READY); fall back to PAUSED when the target is not reachable, so an
	// in-flight node is never left running.
	targetState := orchestrator.NodeStatePaused
	if p := node.fsm.Policy(); p != nil && p.OnPause != nil {
		if s := p.OnPause(node.fsm.Context()); s != "" {
			targetState = s
		}
	}
	if !node.fsm.CanTransitionTo(targetState) {
		targetState = orchestrator.NodeStatePaused
	}
	synced := false
	if node.fsm.CanTransitionTo(targetState) {
		if node.fsm.Transition(targetState, orchestrator.TransitionContext{
			Reason:      "slot cap enforcement",
			TriggeredBy: "system",
		}) == nil {
			synced = targetState == orchestrator.NodeStatePaused
		}
		// Stop the in-flight executor AFTER the transition (see PauseDag
		// for the race rationale).
		if o.scheduler != nil {
			o.scheduler.CancelRunningNode(dagID, nodeID)
		}
	}
	dag.mu.Unlock()

	if synced && o.statusSyncFn != nil {
		o.statusSyncFn(ctx, dagID, nodeID, node.definition, orchestrator.NodeStatePaused)
	}
	o.releaseDomainReservation(dagID, nodeID)
	return nil
}

// EnforceSlotMax reconciles running work after a slot cap change. Lowering
// a slot type's max below the current holder count pauses the newest-held
// holders (progress-preserving) so the pipeline converges to the new limit
// immediately instead of waiting for every running task to finish. Raising
// the cap needs no action: freed capacity re-triggers scheduling through
// the pool's release callback. Returns the number of nodes paused.
func (o *DagOrchestrator) EnforceSlotMax(ctx context.Context, slotType string, newMax int) int {
	sp, ok := o.slotPool.(*slot.SlotPool)
	if !ok {
		return 0
	}
	usage := sp.GetUsage(slotType)
	if usage == nil || usage.Current <= newMax {
		return 0
	}
	excess := usage.Current - newMax
	holders := sp.GetHoldersByAge(slotType)
	paused := 0
	for _, holder := range holders {
		if paused >= excess {
			break
		}
		dagID, nodeID, ok2 := splitHolderID(holder.HolderID)
		if !ok2 {
			continue
		}
		if err := o.PauseDagNode(ctx, dagID, nodeID); err == nil {
			paused++
			// Re-check rather than trusting the count: a paused holder may
			// have released more than one slot (batch keys), and already
			// settled holders must not spin the loop.
			if u := sp.GetUsage(slotType); u == nil || u.Current <= newMax {
				break
			}
		}
	}
	if paused > 0 {
		o.logger.Info("Slot cap enforcement paused excess holders",
			"slotType", slotType, "newMax", newMax, "paused", paused)
	}
	return paused
}

// splitHolderID splits "dagID:nodeID" (the slot holder ID convention) at
// the first colon.
func splitHolderID(holderID string) (string, string, bool) {
	i := strings.IndexByte(holderID, ':')
	if i <= 0 || i == len(holderID)-1 {
		return "", "", false
	}
	return holderID[:i], holderID[i+1:], true
}
