package dag

import (
	"context"
	"testing"
	"time"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/slot"
)

// verifyTestOrch builds a single-node DAG harness for OnNodeCompleted
// tests. def is the node definition; the caller owns driving the FSM.
func verifyTestOrch(t *testing.T, dagID string, def orchestrator.DagNodeDefinition) (*DagOrchestrator, *orchestrator.TaskStateMachine, *recordingScheduler) {
	t.Helper()
	fsm := orchestrator.NewTaskStateMachine(dagID, def.ID, def.Phase, def)
	dag := &dagInstance{
		id: dagID,
		definition: orchestrator.DagDefinition{
			ID:       dagID,
			TaskType: orchestrator.TaskTypeGallery,
			Nodes:    []orchestrator.DagNodeDefinition{def},
		},
		nodes: map[string]*dagNodeInstance{def.ID: {definition: def, fsm: fsm}},
	}
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", Label: "Scraping", DefaultMax: 2, Min: 1, Max: 5})
	sched := &recordingScheduler{}
	orch := NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), pool)
	orch.SetScheduler(sched)
	orch.dags[dagID] = dag
	return orch, fsm, sched
}

// TestNeedsRetryBudgetExhaustion: an executor that keeps reporting
// needs_retry re-queues exactly MaxRetries times and then lands in FAILED,
// instead of cycling NEEDS_RETRY → READY forever.
func TestNeedsRetryBudgetExhaustion(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:         "sc-7",
		TaskType:   orchestrator.TaskTypeGallery,
		Phase:      orchestrator.PhaseScrape,
		Executor:   "scrape",
		MaxRetries: 2,
	}
	orch, fsm, sched := verifyTestOrch(t, "dagBudget", def)

	needsRetryResult := orchestrator.NodeExecutionResult{
		Success: false,
		Data:    map[string]any{"needsRetry": true, "needsRetryReason": "scrape persisted zero rows"},
	}

	for attempt := 1; attempt <= 2; attempt++ {
		driveToRunning(t, fsm)
		if err := orch.OnNodeCompleted(context.Background(), "dagBudget", def.ID, needsRetryResult); err != nil {
			t.Fatalf("attempt %d: OnNodeCompleted: %v", attempt, err)
		}
		if state := fsm.State(); state != orchestrator.NodeStateQueued {
			t.Fatalf("attempt %d: node state = %s, want queued (re-queued)", attempt, state)
		}
		if got := fsm.VerifyRetryCount(); got != attempt {
			t.Fatalf("attempt %d: verifyRetryCount = %d, want %d", attempt, got, attempt)
		}
	}

	// Budget spent: the third needs_retry must fail the node instead of
	// re-queueing it a third time.
	driveToRunning(t, fsm)
	if err := orch.OnNodeCompleted(context.Background(), "dagBudget", def.ID, needsRetryResult); err != nil {
		t.Fatalf("exhausted attempt: OnNodeCompleted: %v", err)
	}
	if state := fsm.State(); state != orchestrator.NodeStateFailed {
		t.Fatalf("exhausted node state = %s, want failed", state)
	}
	if ferr := fsm.Error(); ferr == nil || ferr.Code != "VERIFY_RETRY_EXHAUSTED" {
		t.Fatalf("exhausted node error = %v, want VERIFY_RETRY_EXHAUSTED", ferr)
	}
	if len(sched.submitted) != 2 {
		t.Fatalf("scheduler submissions = %d, want 2 (no third re-queue)", len(sched.submitted))
	}
}

// TestNeedsRetryUnlimitedWithoutBudget: with no policy and no MaxRetries
// the re-queue stays unlimited (backward-compatible default).
func TestNeedsRetryUnlimitedWithoutBudget(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:       "sc-8",
		TaskType: orchestrator.TaskTypeGallery,
		Phase:    orchestrator.PhaseScrape,
		Executor: "scrape",
	}
	orch, fsm, _ := verifyTestOrch(t, "dagNoBudget", def)
	needsRetryResult := orchestrator.NodeExecutionResult{
		Success: false,
		Data:    map[string]any{"needsRetry": true},
	}
	for attempt := 1; attempt <= 3; attempt++ {
		driveToRunning(t, fsm)
		if err := orch.OnNodeCompleted(context.Background(), "dagNoBudget", def.ID, needsRetryResult); err != nil {
			t.Fatalf("attempt %d: OnNodeCompleted: %v", attempt, err)
		}
		if state := fsm.State(); state != orchestrator.NodeStateQueued {
			t.Fatalf("attempt %d: node state = %s, want queued", attempt, state)
		}
	}
}

// TestOnNodeCompletedTimeoutState: a run the supervisor ended at its
// deadline lands the node in TIMEOUT (reachable), not FAILED.
func TestOnNodeCompletedTimeoutState(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:       "vdl-T9",
		TaskType: orchestrator.TaskTypeVideo,
		Phase:    orchestrator.PhaseDownload,
		Executor: "video:download",
	}
	orch, fsm, _ := verifyTestOrch(t, "dagTimeout", def)
	driveToRunning(t, fsm)

	err := orch.OnNodeCompleted(context.Background(), "dagTimeout", def.ID, orchestrator.NodeExecutionResult{
		Success: false,
		Error:   &orchestrator.NodeError{Code: orchestrator.ErrorCodeExecutionTimeout, Message: "node execution timeout"},
	})
	if err != nil {
		t.Fatalf("OnNodeCompleted: %v", err)
	}
	if state := fsm.State(); state != orchestrator.NodeStateTimeout {
		t.Fatalf("node state = %s, want timeout", state)
	}
	// The aggregate must still read the run as a failure.
	aggregate := orchestrator.AggregateTaskStatus(orchestrator.TaskTypeVideo, []orchestrator.NodeSnapshotInfo{{State: fsm.State()}})
	if aggregate != "failed" {
		t.Fatalf("aggregate with timeout node = %q, want failed", aggregate)
	}
}

// TestOnNodeCompletedFailureStillFailed: an ordinary failure keeps landing
// in FAILED (the timeout reroute must not swallow generic errors).
func TestOnNodeCompletedFailureStillFailed(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:       "vdl-T10",
		TaskType: orchestrator.TaskTypeVideo,
		Phase:    orchestrator.PhaseDownload,
		Executor: "video:download",
	}
	orch, fsm, _ := verifyTestOrch(t, "dagFail", def)
	driveToRunning(t, fsm)

	err := orch.OnNodeCompleted(context.Background(), "dagFail", def.ID, orchestrator.NodeExecutionResult{
		Success: false,
		Error:   &orchestrator.NodeError{Code: orchestrator.ErrorCodeExecutionFailed, Message: "segments failed"},
	})
	if err != nil {
		t.Fatalf("OnNodeCompleted: %v", err)
	}
	if state := fsm.State(); state != orchestrator.NodeStateFailed {
		t.Fatalf("node state = %s, want failed", state)
	}
}

// TestPolicyBudgetGovernsVerifyRetry: a policy RetryPolicy overrides the
// definition's MaxRetries for the needs_retry budget.
func TestPolicyBudgetGovernsVerifyRetry(t *testing.T) {
	def := orchestrator.DagNodeDefinition{
		ID:         "sc-11",
		TaskType:   orchestrator.TaskTypeGallery,
		Phase:      orchestrator.PhaseScrape,
		Executor:   "scrape",
		MaxRetries: 99,
	}
	orch, fsm, _ := verifyTestOrch(t, "dagPolicy", def)
	fsm.SetPolicy(&orchestrator.TransitionPolicy{
		RetryPolicy: &orchestrator.RetryPolicy{MaxAttempts: 1, BackoffMs: 1},
	})
	if got := orch.verifyRetryLimit(fsm); got != 1 {
		t.Fatalf("verifyRetryLimit = %d, want 1 (policy wins)", got)
	}
}

var _ = time.Now
