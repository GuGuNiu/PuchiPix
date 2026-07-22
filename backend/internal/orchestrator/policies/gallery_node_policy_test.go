package policies

import (
	"testing"

	"backend/internal/orchestrator"
)

// TestGalleryNodePolicy_SkipVerifyGuard verifies that skipVerify=true
// nodes bypass VERIFYING.
func TestGalleryNodePolicy_SkipVerifyGuard(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{
			Config: map[string]any{"skipVerify": true},
		},
	}
	// skipVerify guard should return true (skip verification).
	if !skipVerify(ctx, orchestrator.TransitionContext{}) {
		t.Fatal("skipVerify guard should return true when Config.skipVerify=true")
	}
	// shouldVerify guard should return false (complement).
	if shouldVerify(ctx, orchestrator.TransitionContext{}) {
		t.Fatal("shouldVerify guard should return false when Config.skipVerify=true")
	}
}

// TestGalleryNodePolicy_DefaultVerify verifies that nodes without
// skipVerify config default to requiring verification.
func TestGalleryNodePolicy_DefaultVerify(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{
			Config: map[string]any{},
		},
	}
	if skipVerify(ctx, orchestrator.TransitionContext{}) {
		t.Fatal("skipVerify should default to false when Config has no skipVerify key")
	}
	if !shouldVerify(ctx, orchestrator.TransitionContext{}) {
		t.Fatal("shouldVerify should default to true")
	}
}

// TestGalleryNodePolicy_OnPause_Scrape verifies that scrape nodes pause
// to READY (re-schedulable, no side effects).
func TestGalleryNodePolicy_OnPause_Scrape(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{Phase: orchestrator.PhaseScrape},
	}
	got := galleryOnPause(ctx)
	if got != orchestrator.NodeStateReady {
		t.Fatalf("scrape node pause should return READY, got %s", got)
	}
}

// TestGalleryNodePolicy_OnPause_Download verifies that download nodes
// pause to PAUSED (preserve partial files).
func TestGalleryNodePolicy_OnPause_Download(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{Phase: orchestrator.PhaseDownload},
	}
	got := galleryOnPause(ctx)
	if got != orchestrator.NodeStatePaused {
		t.Fatalf("download node pause should return PAUSED, got %s", got)
	}
}

// TestGalleryNodePolicy_OnRestart_Resumable verifies that resumableVerify
// nodes with retryCount < 2 go to RESUME_VERIFY.
func TestGalleryNodePolicy_OnRestart_Resumable(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{
			Config: map[string]any{"resumableVerify": true},
		},
		RetryCount: 1,
	}
	got := galleryOnRestart(ctx)
	if got != orchestrator.NodeStateResumeVerify {
		t.Fatalf("resumable node with retryCount<2 should go to RESUME_VERIFY, got %s", got)
	}
}

// TestGalleryNodePolicy_OnRestart_RetryExhausted verifies that
// resumableVerify nodes with retryCount >= 2 go to FAILED.
func TestGalleryNodePolicy_OnRestart_RetryExhausted(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{
			Config: map[string]any{"resumableVerify": true},
		},
		RetryCount: 2,
	}
	got := galleryOnRestart(ctx)
	if got != orchestrator.NodeStateFailed {
		t.Fatalf("resumable node with retryCount>=2 should go to FAILED, got %s", got)
	}
}

// TestGalleryNodePolicy_OnRestart_NotResumable verifies that nodes
// without resumableVerify go to FAILED on restart.
func TestGalleryNodePolicy_OnRestart_NotResumable(t *testing.T) {
	ctx := orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{
			Config: map[string]any{},
		},
		RetryCount: 0,
	}
	got := galleryOnRestart(ctx)
	if got != orchestrator.NodeStateFailed {
		t.Fatalf("non-resumable node should go to FAILED, got %s", got)
	}
}

// TestGalleryNodePolicy_ActionsRun verifies onEnterRunning/onExitRunning
// actions execute and track timing.
func TestGalleryNodePolicy_ActionsRun(t *testing.T) {
	ctx := &orchestrator.StateMachineContext{
		Definition: orchestrator.DagNodeDefinition{},
		Extras:     map[string]any{},
	}
	onEnterRunning(ctx, orchestrator.TransitionContext{})
	if _, ok := ctx.Extras["runningStartedAt"]; !ok {
		t.Fatal("onEnterRunning should set runningStartedAt")
	}
	onExitRunning(ctx, orchestrator.TransitionContext{})
	if _, ok := ctx.Extras["runningStartedAt"]; ok {
		t.Fatal("onExitRunning should clear runningStartedAt")
	}
	if _, ok := ctx.Extras["runningDurationMs"]; !ok {
		t.Fatal("onExitRunning should set runningDurationMs")
	}
}

// TestGalleryNodePolicy_RetryPolicy verifies the retry policy config.
func TestGalleryNodePolicy_RetryPolicy(t *testing.T) {
	if GalleryNodePolicy.RetryPolicy == nil {
		t.Fatal("GalleryNodePolicy should have a RetryPolicy")
	}
	if GalleryNodePolicy.RetryPolicy.MaxAttempts != 3 {
		t.Fatalf("expected MaxAttempts=3, got %d", GalleryNodePolicy.RetryPolicy.MaxAttempts)
	}
	if GalleryNodePolicy.RetryPolicy.BackoffStrategy != "exponential" {
		t.Fatalf("expected exponential backoff, got %s", GalleryNodePolicy.RetryPolicy.BackoffStrategy)
	}
}

// TestGalleryNodePolicy_TransitionsDefined verifies that the RUNNING
// state has guard rules for VERIFYING and COMPLETED.
func TestGalleryNodePolicy_TransitionsDefined(t *testing.T) {
	rules, ok := GalleryNodePolicy.Transitions[orchestrator.NodeStateRunning]
	if !ok {
		t.Fatal("GalleryNodePolicy should define transitions from RUNNING")
	}
	hasVerify := false
	hasComplete := false
	for _, r := range rules {
		if r.To == orchestrator.NodeStateVerifying {
			hasVerify = true
		}
		if r.To == orchestrator.NodeStateCompleted {
			hasComplete = true
		}
	}
	if !hasVerify {
		t.Fatal("GalleryNodePolicy should have RUNNING ??VERIFYING rule")
	}
	if !hasComplete {
		t.Fatal("GalleryNodePolicy should have RUNNING ??COMPLETED rule (skipVerify)")
	}
}
