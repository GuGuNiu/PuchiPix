package orchestrator

import "testing"

// Post-processing nodes (extract/verify, PhaseFinalize) must not write
// back entity status while running: their QUEUED/RUNNING transitions
// would otherwise overwrite the download executor's fresh
// completed/partial write with downloading, regressing both the frontend
// and the DB.
func TestStatusReporterFinalizeNoWrite(t *testing.T) {
	r := NewStatusReporter()

	extractDef := DagNodeDefinition{ID: "ex-1", Executor: "extract", Phase: PhaseFinalize, NonCritical: true}
	verifyDef := DagNodeDefinition{ID: "vf-1", Executor: "verify", Phase: PhaseFinalize}

	inProgress := []NodeState{NodeStateQueued, NodeStateAllocated, NodeStateRunning, NodeStateReady, NodeStatePending}
	for _, def := range []DagNodeDefinition{extractDef, verifyDef} {
		for _, st := range inProgress {
			if _, ok := r.MapNodeToEntityStatus(def, st); ok {
				t.Errorf("finalize node %s in state %s must NOT write entity status (would regress the download executor's terminal write)",
					def.ID, st)
			}
		}
	}
}

// A non-critical node (gallery extract) failing must NOT roll the entity
// back to failed: the download executor already recorded the real
// outcome, and a non-critical post-processing failure does not change
// the task result (otherwise a fully-downloaded gallery would be
// mislabeled failed with no way to heal).
func TestStatusReporterNonCriticalFailureNoWrite(t *testing.T) {
	r := NewStatusReporter()

	extractDef := DagNodeDefinition{ID: "ex-1", Executor: "extract", Phase: PhaseFinalize, NonCritical: true}
	for _, st := range []NodeState{NodeStateFailed, NodeStateTimeout} {
		if _, ok := r.MapNodeToEntityStatus(extractDef, st); ok {
			t.Errorf("nonCritical node in terminal-failure state %s must NOT write entity status", st)
		}
	}

	// Critical node failure must still write failed.
	criticalDef := DagNodeDefinition{ID: "dl-1", Executor: "download", Phase: PhaseDownload}
	if status, ok := r.MapNodeToEntityStatus(criticalDef, NodeStateFailed); !ok || status != "failed" {
		t.Errorf("critical node FAILED = (%q, %v), want (failed, true)", status, ok)
	}
}

func TestStatusReporterCoreMapping(t *testing.T) {
	r := NewStatusReporter()

	tests := []struct {
		name   string
		def    DagNodeDefinition
		state  NodeState
		want   string
		wantOK bool
	}{
		{"scrape 节点 QUEUED → scraping", DagNodeDefinition{Executor: "scrape", Phase: PhaseScrape}, NodeStateQueued, "scraping", true},
		{"download 节点 RUNNING → downloading", DagNodeDefinition{Executor: "download", Phase: PhaseDownload}, NodeStateRunning, "downloading", true},
		{"download 节点 READY（队列回滚）→ pending", DagNodeDefinition{Executor: "download", Phase: PhaseDownload}, NodeStateReady, "pending", true},
		{"video:scrape 节点 RUNNING → scraping", DagNodeDefinition{Executor: "video:scrape", Phase: PhaseScrape}, NodeStateRunning, "scraping", true},
		{"sniff 节点 RUNNING → sniffing", DagNodeDefinition{Executor: "sniff", Phase: PhaseScrape}, NodeStateRunning, "sniffing", true},
		{"任意节点 PAUSED → paused", DagNodeDefinition{Executor: "download", Phase: PhaseDownload}, NodeStatePaused, "paused", true},
		{"verify 节点 NEEDS_RETRY → failed（用户可见可重试）", verifyDefFor("vf-1"), NodeStateNeedsRetry, "failed", true},
		{"任意节点 CANCELLED → cancelled", DagNodeDefinition{Executor: "download", Phase: PhaseDownload}, NodeStateCancelled, "cancelled", true},
		{"VERIFYING 内部态 → 不写", DagNodeDefinition{Executor: "download", Phase: PhaseDownload}, NodeStateVerifying, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := r.MapNodeToEntityStatus(tt.def, tt.state)
			if got != tt.want || ok != tt.wantOK {
				t.Fatalf("MapNodeToEntityStatus() = (%q, %v), want (%q, %v)", got, ok, tt.want, tt.wantOK)
			}
		})
	}
}

func verifyDefFor(id string) DagNodeDefinition {
	return DagNodeDefinition{ID: id, Executor: "verify", Phase: PhaseFinalize}
}
