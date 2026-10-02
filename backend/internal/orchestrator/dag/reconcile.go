package dag

import (
	"context"

	"backend/internal/orchestrator"
)

// ReconcileEntityStatuses heals entity rows whose DAG has already reached
// a terminal aggregate state. Executors normally write the rich terminal
// outcome themselves, and the per-node status sync covers in-progress
// labels — but a crash between a node's completion and the executor's
// final UPDATE (or a DAG that completed while the process was down)
// leaves the row holding an active status forever, because the
// DAG-level guard rail only fires at the moment of completion.
//
// The reconciliation reuses the same conditional write as the guard rail
// (dagStatusSyncFn): its WHERE clause only touches entities still in an
// active status, so executor-owned terminal labels are never clobbered.
// Called once after snapshot restore and crash recovery, before the auto
// reactors start.
func (o *DagOrchestrator) ReconcileEntityStatuses(ctx context.Context) {
	if o.dagStatusSyncFn == nil {
		return
	}
	o.dagsMu.RLock()
	dags := make([]*dagInstance, 0, len(o.dags))
	for _, d := range o.dags {
		dags = append(dags, d)
	}
	o.dagsMu.RUnlock()

	healed := 0
	for _, dag := range dags {
		dag.mu.Lock()
		allTerminal := true
		nodeInfos := make([]orchestrator.NodeSnapshotInfo, 0, len(dag.nodes))
		for _, node := range dag.nodes {
			state := node.fsm.State()
			if !orchestrator.IsDeletableState(state) {
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
		definition := dag.definition
		dag.mu.Unlock()

		if !allTerminal {
			continue
		}
		// Compute the aggregate fresh from the restored node states (the
		// cached allTerminal flag is not populated by restore).
		aggregate := orchestrator.AggregateTaskStatus(taskType, nodeInfos)
		switch aggregate {
		case "completed", "failed", "cancelled":
			o.dagStatusSyncFn(ctx, dag.id, definition, aggregate)
			healed++
		}
	}
	if healed > 0 {
		o.logger.Info("Entity status reconciliation finished", "dags", healed)
	}
}
