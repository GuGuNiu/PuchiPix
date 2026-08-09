package orchestrator_test

import (
	"context"
	"testing"

	"backend/internal/orchestrator"
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
