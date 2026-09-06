package orchestrator

import "testing"

// TestStatusReporterFinalizeNoWrite 锁定 260820「100%+downloading 永久卡死」缺陷的修复：
// 后处理节点（extract/verify — PhaseFinalize）在执行期间不得回写实体状态。
// 此前 extract/verify 的 QUEUED/RUNNING 转换把下载执行器刚写入的
// completed/partial 覆盖回 downloading，前端与 DB 同时回退。
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

// TestStatusReporterNonCriticalFailureNoWrite 非关键节点（gallery extract）失败
// 不得把实体回退为 failed：下载执行器已记录真实结果，
// 非关键后处理失败不改变任务结局（否则全内容图库被误标 failed 且守卫无法治愈）。
func TestStatusReporterNonCriticalFailureNoWrite(t *testing.T) {
	r := NewStatusReporter()

	extractDef := DagNodeDefinition{ID: "ex-1", Executor: "extract", Phase: PhaseFinalize, NonCritical: true}
	for _, st := range []NodeState{NodeStateFailed, NodeStateTimeout} {
		if _, ok := r.MapNodeToEntityStatus(extractDef, st); ok {
			t.Errorf("nonCritical node in terminal-failure state %s must NOT write entity status", st)
		}
	}

	// 关键节点失败仍必须写 failed。
	criticalDef := DagNodeDefinition{ID: "dl-1", Executor: "download", Phase: PhaseDownload}
	if status, ok := r.MapNodeToEntityStatus(criticalDef, NodeStateFailed); !ok || status != "failed" {
		t.Errorf("critical node FAILED = (%q, %v), want (failed, true)", status, ok)
	}
}

// TestStatusReporterCoreMapping 验证核心管线节点的标准映射不被本次调整破坏。
func TestStatusReporterCoreMapping(t *testing.T) {
	r := NewStatusReporter()

	tests := []struct {
		name string
		def  DagNodeDefinition
		state NodeState
		want string
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
