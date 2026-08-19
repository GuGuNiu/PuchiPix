package dag

import (
	"context"
	"fmt"
	"time"

	"backend/internal/orchestrator"
)

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

	// Adding a PENDING node makes this DAG non-terminal again.
	dag.allTerminal = false

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

// RemoveDag removes a DAG from the orchestrator's memory. DAGs with all
// nodes in terminal or deletable states (failed/timeout) can be removed.
// Active DAGs with running/pending nodes must be cancelled first.
func (o *DagOrchestrator) RemoveDag(ctx context.Context, dagID string) error {
	o.dagsMu.Lock()
	defer o.dagsMu.Unlock()

	dag, ok := o.dags[dagID]
	if !ok {
		return orchestrator.ErrDagNotFound
	}

	dag.mu.Lock()
	defer dag.mu.Unlock()

	// Verify all nodes are in deletable states (terminal or failed/timeout)
	for nodeID, node := range dag.nodes {
		state := node.fsm.State()
		if !orchestrator.IsDeletableState(state) {
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
