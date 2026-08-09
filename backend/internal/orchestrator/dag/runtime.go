package dag

import (
	"context"

	"backend/internal/orchestrator"
)

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
