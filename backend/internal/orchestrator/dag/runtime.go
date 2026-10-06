package dag

import (
	"context"

	"backend/internal/orchestrator"
)

// DrainStopper is implemented by schedulers that can drain in-flight
// nodes before shutdown.
type DrainStopper interface {
	StopWithDrain(ctx context.Context) bool
}

// Shutdown drains the scheduler (waiting for running nodes, or
// cancelling them at the deadline), flushes the async event writer so
// every queued event is persisted, then takes a final snapshot so a
// subsequent restart restores a consistent PAUSED/resumable state.
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
	pausedDags := 0
	totalNodes := 0
	for _, dag := range dags {
		dag.mu.Lock()
		hasActive := false
		hasPaused := false
		for _, node := range dag.nodes {
			state := node.fsm.State()
			if !orchestrator.IsTerminalState(state) {
				if state == orchestrator.NodeStatePaused {
					hasPaused = true
				} else {
					hasActive = true
				}
			}
			totalNodes++
		}
		if hasActive {
			activeDags++
		} else if hasPaused {
			// Only count as paused when nothing is truly running — a DAG
			// mixing paused and running nodes is active overall.
			pausedDags++
		}
		dag.mu.Unlock()
	}
	return orchestrator.DagOrchestratorStats{
		TotalDags:  len(dags),
		ActiveDags: activeDags,
		PausedDags: pausedDags,
		TotalNodes: totalNodes,
	}
}

// IsInitialized reports whether Initialize has been called.
func (o *DagOrchestrator) IsInitialized() bool {
	o.dagsMu.RLock()
	defer o.dagsMu.RUnlock()
	return o.initialized
}
