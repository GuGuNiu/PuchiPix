package dag

import (
	"github.com/dominikbraun/graph"

	"backend/internal/orchestrator"
)

// graphIndex is a thin in-memory index over a DAG's dependency topology,
// backed by github.com/dominikbraun/graph. It exists to make dependency
// activation incremental: instead of rescanning every node's full
// dependency list on each completion (O(n*d)), the orchestrator only
// walks the completed node's direct successors (O(d)).
//
// The graph holds no authoritative state: DagDefinition remains the
// single persisted truth (snapshots/event sourcing). The index is always
// rebuilt from the definition via buildGraphIndex, which keeps snapshot
// restore a pure function and avoids any dual-write consistency problem.
//
// Edge direction: dependency to dependent (A to B means "A must complete
// before B"), so AdjacencyMap yields a node's direct successors.
type graphIndex struct {
	g graph.Graph[string, string]
	// successors caches nodeID to direct dependent node IDs (out-edges).
	successors map[string][]string
}

// buildGraphIndex constructs a graphIndex from a DAG definition. It
// validates that all referenced dependencies exist and that the graph is
// acyclic (enforced by the Acyclic trait on AddEdge).
func buildGraphIndex(def orchestrator.DagDefinition) (*graphIndex, error) {
	// PreventCycles (rather than Acyclic alone) makes AddEdge reject
	// cycle-closing edges with graph.ErrEdgeCreatesCycle; Acyclic only
	// marks the graph trait without enforcing it on edge insertion.
	g := graph.New(graph.StringHash, graph.Directed(), graph.PreventCycles())

	for _, node := range def.Nodes {
		if err := g.AddVertex(node.ID); err != nil {
			return nil, err
		}
	}

	for _, node := range def.Nodes {
		for _, depID := range node.Dependencies {
			// Edge: dep to node. With the Acyclic trait, AddEdge returns
			// graph.ErrEdgeCreatesCycle if this edge closes a cycle.
			if err := g.AddEdge(depID, node.ID); err != nil {
				return nil, err
			}
		}
	}

	idx := &graphIndex{
		g:          g,
		successors: make(map[string][]string, len(def.Nodes)),
	}
	if err := idx.rebuildCaches(); err != nil {
		return nil, err
	}
	return idx, nil
}

// rebuildCaches recomputes the successor cache from the underlying graph.
// Called after construction and after any topology mutation from the
// dynamic AddNode / AddDependency API.
func (idx *graphIndex) rebuildCaches() error {
	adj, err := idx.g.AdjacencyMap()
	if err != nil {
		return err
	}

	idx.successors = make(map[string][]string, len(adj))
	for nodeID, targets := range adj {
		succ := make([]string, 0, len(targets))
		for targetID := range targets {
			succ = append(succ, targetID)
		}
		idx.successors[nodeID] = succ
	}
	return nil
}

// directSuccessors returns the node IDs that directly depend on the
// given node (its out-edges). Unknown nodes yield an empty slice.
func (idx *graphIndex) directSuccessors(nodeID string) []string {
	return idx.successors[nodeID]
}

// addVertex registers a new node in the index. Used by the dynamic
// AddNode API. The caches are NOT updated until rebuildCaches or
// addEdge is called for the vertex.
func (idx *graphIndex) addVertex(nodeID string) error {
	return idx.g.AddVertex(nodeID)
}

// addEdge registers depID to nodeID, rejecting cycles. Used by the
// dynamic AddDependency API. Caches are refreshed on success.
func (idx *graphIndex) addEdge(depID, nodeID string) error {
	if err := idx.g.AddEdge(depID, nodeID); err != nil {
		return err
	}
	return idx.rebuildCaches()
}
