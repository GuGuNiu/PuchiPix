package dag

import (
	"context"
	"testing"

	"backend/internal/infra"
	"backend/internal/orchestrator"
)

func TestPropagateCompletionRejectsUnsettledNode(t *testing.T) {
	first := orchestrator.DagNodeDefinition{ID: "first", Phase: orchestrator.PhaseScrape}
	second := orchestrator.DagNodeDefinition{ID: "second", Phase: orchestrator.PhaseDownload, Dependencies: []string{"first"}}
	firstFSM := orchestrator.NewTaskStateMachine("dag", "first", first.Phase, first)
	secondFSM := orchestrator.NewTaskStateMachine("dag", "second", second.Phase, second)
	if err := firstFSM.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{}); err != nil {
		t.Fatal(err)
	}
	index, err := buildGraphIndex(orchestrator.DagDefinition{Nodes: []orchestrator.DagNodeDefinition{first, second}})
	if err != nil {
		t.Fatal(err)
	}
	dag := &dagInstance{
		id:         "dag",
		definition: orchestrator.DagDefinition{ID: "dag", Nodes: []orchestrator.DagNodeDefinition{first, second}},
		nodes: map[string]*dagNodeInstance{
			"first":  {definition: first, fsm: firstFSM},
			"second": {definition: second, fsm: secondFSM},
		},
		graphIdx: index,
	}
	orch := &DagOrchestrator{
		dags:   map[string]*dagInstance{"dag": dag},
		logger: infra.NewLogger("DAGTest"),
	}
	orch.propagateCompletion(context.Background(), "dag", "first")
	if dag.nodes["second"].completedDeps != 0 {
		t.Fatalf("unsettled predecessor activated successor: completedDeps=%d", dag.nodes["second"].completedDeps)
	}
}
