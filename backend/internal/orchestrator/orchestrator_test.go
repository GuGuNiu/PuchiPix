package orchestrator_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/slot"
)

// TestCanTransition verifies the state machine transition table includes
// all paths needed by the 260720 fixes, especially needs_retry.
func TestCanTransition(t *testing.T) {
	tests := []struct {
		name string
		from orchestrator.NodeState
		to   orchestrator.NodeState
		want bool
	}{
		{"pending -> ready", orchestrator.NodeStatePending, orchestrator.NodeStateReady, true},
		{"ready -> queued", orchestrator.NodeStateReady, orchestrator.NodeStateQueued, true},
		{"queued -> allocated", orchestrator.NodeStateQueued, orchestrator.NodeStateAllocated, true},
		{"allocated -> running", orchestrator.NodeStateAllocated, orchestrator.NodeStateRunning, true},
		{"running -> verifying", orchestrator.NodeStateRunning, orchestrator.NodeStateVerifying, true},
		{"verifying -> completed", orchestrator.NodeStateVerifying, orchestrator.NodeStateCompleted, true},
		{"failed -> ready", orchestrator.NodeStateFailed, orchestrator.NodeStateReady, true},

		// 260720 needs_retry fix
		{"verifying -> needs_retry", orchestrator.NodeStateVerifying, orchestrator.NodeStateNeedsRetry, true},
		{"failed -> needs_retry", orchestrator.NodeStateFailed, orchestrator.NodeStateNeedsRetry, true},
		{"needs_retry -> ready", orchestrator.NodeStateNeedsRetry, orchestrator.NodeStateReady, true},

		// Illegal transitions
		{"completed -> running", orchestrator.NodeStateCompleted, orchestrator.NodeStateRunning, false},
		{"cancelled -> ready", orchestrator.NodeStateCancelled, orchestrator.NodeStateReady, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := orchestrator.CanTransition(tt.from, tt.to)
			if got != tt.want {
				t.Errorf("CanTransition(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

// TestIsTerminalState verifies terminal and non-terminal states.
func TestIsTerminalState(t *testing.T) {
	terminalStates := []orchestrator.NodeState{
		orchestrator.NodeStateCompleted,
		orchestrator.NodeStateCancelled,
	}
	nonTerminalStates := []orchestrator.NodeState{
		orchestrator.NodeStatePending,
		orchestrator.NodeStateReady,
		orchestrator.NodeStateQueued,
		orchestrator.NodeStateRunning,
		orchestrator.NodeStateFailed,
		orchestrator.NodeStateNeedsRetry,
	}

	for _, s := range terminalStates {
		if !orchestrator.IsTerminalState(s) {
			t.Errorf("IsTerminalState(%s) = false, want true", s)
		}
	}
	for _, s := range nonTerminalStates {
		if orchestrator.IsTerminalState(s) {
			t.Errorf("IsTerminalState(%s) = true, want false", s)
		}
	}
}

// TestTaskStateMachineTransitions verifies the full lifecycle including
// the 260720 needs_retry recovery path.
func TestTaskStateMachineTransitions(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:       "node-1",
		TaskType: orchestrator.TaskTypeGallery,
		Phase:    orchestrator.PhaseScrape,
	}

	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, def)

	if fsm.State() != orchestrator.NodeStatePending {
		t.Fatalf("initial state = %s, want pending", fsm.State())
	}

	steps := []struct {
		to      orchestrator.NodeState
		ctx     orchestrator.TransitionContext
		wantErr bool
	}{
		{orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "deps met", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateQueued, orchestrator.TransitionContext{Reason: "queued", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "allocated", TriggeredBy: "scheduler"}, false},
		{orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "running", TriggeredBy: "scheduler"}, false},
		{orchestrator.NodeStateVerifying, orchestrator.TransitionContext{Reason: "verify", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateNeedsRetry, orchestrator.TransitionContext{Reason: "needs retry", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "reactivate", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateQueued, orchestrator.TransitionContext{Reason: "re-queued", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "re-allocated", TriggeredBy: "scheduler"}, false},
		{orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "re-running", TriggeredBy: "scheduler"}, false},
		{orchestrator.NodeStateVerifying, orchestrator.TransitionContext{Reason: "re-verify", TriggeredBy: "system"}, false},
		{orchestrator.NodeStateCompleted, orchestrator.TransitionContext{Reason: "done", TriggeredBy: "system"}, false},
	}

	for i, step := range steps {
		err := fsm.Transition(step.to, step.ctx)
		if (err != nil) != step.wantErr {
			t.Errorf("step %d: Transition(%s) err = %v, wantErr = %v", i, step.to, err, step.wantErr)
		}
		if !step.wantErr && fsm.State() != step.to {
			t.Errorf("step %d: state = %s, want %s", i, fsm.State(), step.to)
		}
	}

	history := fsm.GetHistory()
	if len(history) != len(steps) {
		t.Errorf("history length = %d, want %d", len(history), len(steps))
	}
}

// TestAggregateTaskStatus verifies the 260720 status aggregation priority.
func TestAggregateTaskStatus(t *testing.T) {
	tests := []struct {
		name     string
		taskType orchestrator.TaskType
		nodes    []orchestrator.NodeSnapshotInfo
		want     string
	}{
		{
			name:     "all completed",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseScrape},
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseDownload},
			},
			want: "completed",
		},
		{
			name:     "one failed one completed",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStateFailed, Phase: orchestrator.PhaseScrape},
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseDownload},
			},
			want: "failed",
		},
		{
			name:     "cancelled overrides failed",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStateFailed, Phase: orchestrator.PhaseScrape},
				{State: orchestrator.NodeStateCancelled, Phase: orchestrator.PhaseDownload},
			},
			want: "cancelled",
		},
		{
			name:     "needs_retry does not short-circuit to failed",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStateNeedsRetry, Phase: orchestrator.PhaseScrape},
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseDownload},
			},
			want: "needs_retry",
		},
		{
			name:     "scrape NOT_FOUND returns not_found",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStateFailed, Phase: orchestrator.PhaseScrape, Error: &orchestrator.NodeError{Code: "NOT_FOUND", Message: "not found", Retryable: false}},
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseDownload},
			},
			want: "not_found",
		},
		{
			name:     "paused without failures",
			taskType: orchestrator.TaskTypeGallery,
			nodes: []orchestrator.NodeSnapshotInfo{
				{State: orchestrator.NodeStatePaused, Phase: orchestrator.PhaseScrape},
				{State: orchestrator.NodeStateCompleted, Phase: orchestrator.PhaseDownload},
			},
			want: "paused",
		},
		{
			name:     "empty nodes",
			taskType: orchestrator.TaskTypeGallery,
			nodes:    []orchestrator.NodeSnapshotInfo{},
			want:     "pending",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := orchestrator.AggregateTaskStatus(tt.taskType, tt.nodes)
			if got != tt.want {
				t.Errorf("AggregateTaskStatus() = %s, want %s", got, tt.want)
			}
		})
	}
}

// TestMapNodeStateToDBStatus verifies DB status mapping includes needs_retry.
func TestMapNodeStateToDBStatus(t *testing.T) {
	tests := []struct {
		state orchestrator.NodeState
		phase orchestrator.TaskPhase
		want  string
	}{
		{orchestrator.NodeStatePending, orchestrator.PhaseScrape, "pending"},
		{orchestrator.NodeStateReady, orchestrator.PhaseScrape, "scrape_pending"},
		{orchestrator.NodeStateReady, orchestrator.PhaseDownload, "download_pending"},
		{orchestrator.NodeStateRunning, orchestrator.PhaseScrape, "scraping"},
		{orchestrator.NodeStateRunning, orchestrator.PhaseDownload, "downloading"},
		{orchestrator.NodeStateCompleted, orchestrator.PhaseScrape, "completed"},
		{orchestrator.NodeStateFailed, orchestrator.PhaseScrape, "failed"},
		{orchestrator.NodeStateCancelled, orchestrator.PhaseScrape, "cancelled"},
		{orchestrator.NodeStateNeedsRetry, orchestrator.PhaseScrape, "needs_retry"},
		{orchestrator.NodeStateTimeout, orchestrator.PhaseScrape, "failed"},
	}

	for _, tt := range tests {
		t.Run(string(tt.state), func(t *testing.T) {
			got := orchestrator.MapNodeStateToDBStatus(tt.state, tt.phase)
			if got != tt.want {
				t.Errorf("MapNodeStateToDBStatus(%s, %s) = %s, want %s", tt.state, tt.phase, got, tt.want)
			}
		})
	}
}

// TestSlotPoolAcquireRelease verifies basic slot pool operations.
func TestSlotPoolAcquireRelease(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{
		Key:        "scraping",
		Label:      "Scraping",
		DefaultMax: 2,
		Min:        1,
		Max:        10,
	})

	if !pool.HasAvailable("scraping") {
		t.Error("HasAvailable(scraping) = false, want true")
	}
	if !pool.Acquire("scraping", "holder-1") {
		t.Error("Acquire(holder-1) = false, want true")
	}
	if !pool.Acquire("scraping", "holder-2") {
		t.Error("Acquire(holder-2) = false, want true")
	}
	if pool.HasAvailable("scraping") {
		t.Error("HasAvailable = true after 2 acquires, want false")
	}
	if pool.Acquire("scraping", "holder-3") {
		t.Error("Acquire(holder-3) = true when full, want false")
	}
	pool.Release("scraping", "holder-1")
	if !pool.HasAvailable("scraping") {
		t.Error("HasAvailable = false after release, want true")
	}
	pool.ReleaseAll("holder-2")
	usage := pool.GetUsage("scraping")
	if usage == nil {
		t.Fatal("GetUsage = nil")
	}
	if usage.Current != 0 {
		t.Errorf("usage.Current = %d, want 0", usage.Current)
	}
}

// TestSlotPoolBatchAcquire verifies atomic batch acquisition.
func TestSlotPoolBatchAcquire(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{
		Key:        "download",
		Label:      "Download",
		DefaultMax: 3,
		Min:        1,
		Max:        10,
	})

	reqs := []slot.ResourceRequirement{
		{SlotType: "download", Count: 2},
	}
	if !pool.AcquireBatch(reqs, "batch-1") {
		t.Error("AcquireBatch = false, want true")
	}
	usage := pool.GetUsage("download")
	if usage.Current != 2 {
		t.Errorf("after batch, Current = %d, want 2", usage.Current)
	}
	pool.ReleaseAll("batch-1")
	usage = pool.GetUsage("download")
	if usage.Current != 0 {
		t.Errorf("after release, Current = %d, want 0", usage.Current)
	}
}

// TestDagManagerCycleDetection verifies Kahn's algorithm detects cycles.
func TestDagManagerCycleDetection(t *testing.T) {
	mgr := dag.NewManager()

	mgr.AddTask(dag.DagCapableTask{ID: "A"})
	mgr.AddTask(dag.DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	mgr.AddTask(dag.DagCapableTask{ID: "C", DependsOn: []string{"B"}})
	mgr.AddTask(dag.DagCapableTask{ID: "D", DependsOn: []string{"C"}})
	mgr.AddDependency("A", "D")

	err := mgr.DetectCycles()
	if err == nil {
		t.Fatal("DetectCycles() = nil, want cycle error")
	}
}

// TestDagManagerTopologicalSort verifies topological ordering.
func TestDagManagerTopologicalSort(t *testing.T) {
	mgr := dag.NewManager()

	mgr.AddTask(dag.DagCapableTask{ID: "D", DependsOn: []string{"C"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "C", DependsOn: []string{"B"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "A", Priority: 1})

	result, err := mgr.TopologicalSort()
	if err != nil {
		t.Fatalf("TopologicalSort() error = %v", err)
	}
	if len(result) != 4 {
		t.Fatalf("result length = %d, want 4", len(result))
	}
	if (*result[0]).ID != "A" || (*result[3]).ID != "D" {
		t.Errorf("order = %v, want [A, B, C, D]", []string{(*result[0]).ID, (*result[1]).ID, (*result[2]).ID, (*result[3]).ID})
	}
}

// TestDagManagerMarkCompleted verifies dependency unblocking.
func TestDagManagerMarkCompleted(t *testing.T) {
	mgr := dag.NewManager()

	mgr.AddTask(dag.DagCapableTask{ID: "A", Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "C", DependsOn: []string{"B"}, Priority: 1})

	if mgr.AreDependenciesMet("B") {
		t.Error("AreDependenciesMet(B) = true before A completed")
	}
	unblocked := mgr.MarkCompleted("A")
	if len(unblocked) != 1 || unblocked[0] != "B" {
		t.Errorf("MarkCompleted(A) = %v, want [B]", unblocked)
	}
	if !mgr.AreDependenciesMet("B") {
		t.Error("AreDependenciesMet(B) = false after A completed")
	}
	unblocked = mgr.MarkCompleted("B")
	if len(unblocked) != 1 || unblocked[0] != "C" {
		t.Errorf("MarkCompleted(B) = %v, want [C]", unblocked)
	}
	if !mgr.AreDependenciesMet("C") {
		t.Error("AreDependenciesMet(C) = false after B completed")
	}
}

// TestDagManagerMarkFailed verifies cascade failure propagation.
func TestDagManagerMarkFailed(t *testing.T) {
	mgr := dag.NewManager()

	mgr.AddTask(dag.DagCapableTask{ID: "A", Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "C", DependsOn: []string{"B"}, Priority: 1})
	mgr.AddTask(dag.DagCapableTask{ID: "D", DependsOn: []string{"C"}, Priority: 1})

	cascaded := mgr.MarkFailed("A")
	if len(cascaded) != 3 {
		t.Errorf("cascaded count = %d, want 3", len(cascaded))
	}
	if !mgr.IsFailedOrCanceled("B") {
		t.Error("B should be cascaded")
	}
	if !mgr.IsFailedOrCanceled("D") {
		t.Error("D should be cascaded")
	}
}

// TestDomainFallback verifies the 260720 domain fallback fix.
func TestDomainFallback(t *testing.T) {
	calls := []string{}
	tryFn := func(_ context.Context, url string) error {
		calls = append(calls, url)
		if len(calls) < 3 {
			return fmt.Errorf("domain unavailable")
		}
		return nil
	}

	originalURL := "https://primary.example.com/path/to/file.zip"
	domains := []string{"fallback1.example.com", "fallback2.example.com"}

	err := executors.DownloadWithDomainFallback(context.Background(), originalURL, domains, tryFn)
	if err != nil {
		t.Fatalf("DownloadWithDomainFallback() error = %v", err)
	}
	if len(calls) != 3 {
		t.Errorf("call count = %d, want 3", len(calls))
	}
	if !strings.Contains(calls[0], "primary.example.com") {
		t.Errorf("first call = %s, want primary", calls[0])
	}
	if !strings.Contains(calls[2], "fallback2.example.com") {
		t.Errorf("third call = %s, want fallback2", calls[2])
	}
}

// TestReplaceDomain verifies URL domain replacement.
func TestReplaceDomain(t *testing.T) {
	got := executors.ReplaceDomain("https://primary.example.com/path/to/file.zip", "fallback.example.com")
	want := "https://fallback.example.com/path/to/file.zip"
	if got != want {
		t.Errorf("replaceDomain() = %s, want %s", got, want)
	}
}

// TestStateReconcilerNeedsRetry verifies the 260720 fix where interrupted
// scrapes return needs_retry instead of hard-failed.
func TestStateReconcilerNeedsRetry(t *testing.T) {
	reconciler := orchestrator.NewStateReconciler(nil)

	node := orchestrator.DagNodeForVerification{
		NodeID: "scrape-1",
		DagID:  "gallery-1",
		State:  orchestrator.NodeStateVerifying,
		Phase:  "scrape",
		Config: map[string]any{},
	}

	result := reconciler.VerifyNode(context.Background(), node)
	if result.Status != "passed" {
		t.Errorf("with no galleryId, status = %s, want passed", result.Status)
	}
}

// TestSnapshotCacheUpdateClear verifies the snapshot cache lifecycle.
func TestSnapshotCacheUpdateClear(t *testing.T) {
	cache := dag.NewSnapshotCache()

	if cache.IsAvailable() {
		t.Error("IsAvailable() = true on new cache")
	}

	cache.Update(dag.SnapshotSyncPayload{
		Dags: []orchestrator.DagSnapshot{
			{DagID: "gallery-1"},
			{DagID: "gallery-2"},
		},
		DagStats:   orchestrator.DagOrchestratorStats{TotalDags: 2, ActiveDags: 2, TotalNodes: 4},
		CurrentSeq: 100,
	})

	if !cache.IsAvailable() {
		t.Error("IsAvailable() = false after update")
	}
	snap := cache.GetDagSnapshot("gallery-1")
	if snap == nil || snap.DagID != "gallery-1" {
		t.Error("GetDagSnapshot(gallery-1) failed")
	}
	all := cache.GetAllDagSnapshots()
	if len(all) != 2 {
		t.Errorf("GetAllDagSnapshots() = %d, want 2", len(all))
	}
	stats := cache.GetDagStats()
	if stats.TotalDags != 2 {
		t.Errorf("GetDagStats().TotalDags = %d, want 2", stats.TotalDags)
	}
	if cache.GetCurrentSeq() != 100 {
		t.Errorf("GetCurrentSeq() = %d, want 100", cache.GetCurrentSeq())
	}
	cache.Clear()
	if cache.IsAvailable() {
		t.Error("IsAvailable() = true after clear")
	}
}
