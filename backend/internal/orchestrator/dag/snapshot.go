package dag

import (
	"context"

	"backend/internal/orchestrator"
)

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
		// M7 onRestart strategy: per the design requirement, ALL non-terminal
		// nodes found after a restart must transition to PAUSED so the user
		// can decide when to resume them — no auto-execution should happen.
		//
		// Previously, only RUNNING and VERIFYING were handled (RUNNING → READY
		// for re-scheduling, VERIFYING → FAILED). QUEUED and READY nodes were
		// left as-is, which caused the periodic ReactivateReadyNodes ticker
		// to auto-execute them immediately after restart.
		//
		// Now: all non-terminal, non-PENDING states → PAUSED. PENDING nodes
		// are left untouched (they haven't started yet and are already in
		// the correct "waiting" state).
		restoredState := fsm.State()
		if !orchestrator.IsTerminalState(restoredState) && restoredState != orchestrator.NodeStatePending {
			targetState := defaultOnRestart(restoredState)
			if p := fsm.Policy(); p != nil && p.OnRestart != nil {
				if s := p.OnRestart(fsm.Context()); s != "" {
					targetState = s
				}
			}
			if targetState != restoredState && fsm.CanTransitionTo(targetState) {
				_ = fsm.Transition(targetState, orchestrator.TransitionContext{
					Reason:      "restart recovery: transitioning to PAUSED (service restart)",
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
			// Unlock before continuing: leaving the mutex held here
			// leaks it, and any later access to this DAG (scheduler,
			// ReactivateReadyNodes, status queries) blocks forever.
			dag.mu.Unlock()
			continue
		}
		switch event.Type {
		case "dag:nodeStateChanged":
			// Note: a bare continue inside this switch would target the
			// outer for loop and skip the unlock below, so the payload
			// guard is inverted to keep a single exit point.
			if payload, ok := event.Payload["context"].(map[string]any); ok {
				fromStr, _ := event.Payload["from"].(string)
				toStr, _ := event.Payload["to"].(string)
				if string(node.fsm.State()) == fromStr {
					_ = node.fsm.Transition(orchestrator.NodeState(toStr), orchestrator.TransitionContext{
						Reason:      getString(payload, "reason"),
						TriggeredBy: getString(payload, "triggeredBy"),
					})
				}
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

func getString(m map[string]any, key string) string {
	v, ok := m[key].(string)
	if !ok {
		return ""
	}
	return v
}
