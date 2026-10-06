package dag

import (
	"context"
	"time"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// SweepZombieNodes re-drives nodes whose executor is gone but whose FSM
// is still ALLOCATED/RUNNING — the zombie state that wedges a DAG: the
// node never reaches a terminal state, so successors stay PENDING, the
// entity row keeps its in-progress label, and nothing ever re-queues the
// work.
//
// A node is a zombie when both of these hold:
//   - the scheduler has no live executor for it (IsExecuting false —
//     the supervisor settled, or the dispatch never reached the worker);
//   - the slot pool holds no slot for it (the stale-slot sweep already
//     released it, or it was never acquired).
//
// The sweep transitions the node ALLOCATED/RUNNING -> PAUSED (legal for
// both states in the transition table) and then re-enters it through the
// same PAUSED -> READY -> QUEUED path ResumeDag uses, so recovery needs
// no new transition-table edges. Nodes whose executor is alive or that
// still hold their slot are left untouched — including a healthy long
// download whose slot the stale sweeper has not yet reached.
//
// Returns the number of re-queued nodes.
func (o *DagOrchestrator) SweepZombieNodes(ctx context.Context) int {
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

	requeued := 0
	for _, dagID := range dagIDs {
		o.dagsMu.RLock()
		dag, ok := o.dags[dagID]
		o.dagsMu.RUnlock()
		if !ok {
			continue
		}

		dag.mu.Lock()
		var zombies []*dagNodeInstance
		for nodeID, node := range dag.nodes {
			state := node.fsm.State()
			if state != orchestrator.NodeStateAllocated && state != orchestrator.NodeStateRunning {
				continue
			}
			if o.scheduler != nil && o.scheduler.IsExecuting(dagID, nodeID) {
				continue
			}
			holderID := dagID + ":" + nodeID
			if sp, ok := o.slotPool.(*slot.SlotPool); ok && sp.HoldsAny(holderID) {
				continue
			}
			// ALLOCATED/RUNNING -> PAUSED is legal for both states; the
			// guard keeps a future table change from breaking the sweep.
			if !node.fsm.CanTransitionTo(orchestrator.NodeStatePaused) {
				continue
			}
			if node.fsm.Transition(orchestrator.NodeStatePaused, orchestrator.TransitionContext{
				Reason:      "zombie sweep: executor gone and slot released",
				TriggeredBy: "system",
			}) != nil {
				continue
			}
			zombies = append(zombies, node)
		}
		dag.mu.Unlock()

		// Mirror ResumeDag: PAUSED -> READY -> QUEUED -> submit. The
		// FSM transitions are internally synchronized; ResumeDag uses
		// the same outside-the-lock pattern.
		for _, node := range zombies {
			_ = node.fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{
				Reason:      "zombie sweep requeue",
				TriggeredBy: "system",
			})
			_ = node.fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{
				Reason:      "re-submitted after zombie sweep",
				TriggeredBy: "system",
			})
			o.submitToScheduler(ctx, node.definition.ID, dagID, node)
			requeued++
			o.logger.Warn("Zombie node requeued", "dagId", dagID, "nodeId", node.definition.ID)
		}
	}
	return requeued
}

// StartZombieSweep runs the zombie sweep on a ticker until ctx is
// cancelled. Idempotent: calling it twice starts only one goroutine.
func (o *DagOrchestrator) StartZombieSweep(ctx context.Context, interval time.Duration) {
	o.dagsMu.Lock()
	if o.zombieSweepStarted {
		o.dagsMu.Unlock()
		return
	}
	o.zombieSweepStarted = true
	o.dagsMu.Unlock()

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if n := o.SweepZombieNodes(ctx); n > 0 {
					o.logger.Info("Zombie sweep requeued nodes", "count", n)
				}
			case <-ctx.Done():
				o.logger.Info("Zombie sweep stopped")
				return
			}
		}
	}()
}
