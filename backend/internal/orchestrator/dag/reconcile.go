package dag

import (
	"context"

	"backend/internal/orchestrator"
)

// ReconcileEntityStatuses heals entity rows whose DAG state diverged from
// the row label. Two gap classes are covered, both through the conditional
// dagStatusSyncFn write whose WHERE clause only touches rows still holding
// an active status, so executor-owned terminal labels are never clobbered:
//
//   - a DAG that reached a terminal aggregate while the process was down
//     (crash between the node's completion and the executor's final UPDATE)
//     leaves the row holding an active status forever;
//   - restart recovery moves every non-terminal, non-PENDING node to
//     PAUSED inside restoreDag, which deliberately performs no per-node
//     status sync — so the row keeps its pre-restart label (usually
//     "pending") while the FSM actually waits for a manual resume. A
//     "pending" label reads as "queued for capacity", masking the pause.
//
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
	paused := 0
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
			// Compute the aggregate fresh from the restored node states (the
			// cached allTerminal flag is not populated by restore). A paused
			// aggregate means restart recovery parked this DAG; the row must
			// say so instead of pretending to wait for capacity.
			if orchestrator.AggregateTaskStatus(taskType, nodeInfos) == "paused" {
				o.dagStatusSyncFn(ctx, dag.id, definition, "paused")
				paused++
			}
			continue
		}
		aggregate := orchestrator.AggregateTaskStatus(taskType, nodeInfos)
		switch aggregate {
		case "completed", "failed", "cancelled":
			o.dagStatusSyncFn(ctx, dag.id, definition, aggregate)
			healed++
		}
	}
	if healed > 0 || paused > 0 {
		o.logger.Info("Entity status reconciliation finished",
			"terminalDags", healed, "pausedDags", paused)
	}
}
