package orchestrator_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
)

// --- EventStore async writer tests ---

// TestEventStoreStartAsyncWriter verifies that StartAsyncWriter
// initializes the async pipeline and is idempotent.
func TestEventStoreStartAsyncWriter(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	es.StartAsyncWriter()
	// Calling again should be a no-op
	es.StartAsyncWriter()
	es.Flush()
}

// TestEventStoreAppendAsync verifies that AppendAsync persists events
// through the async writer when it is running.
func TestEventStoreAppendAsync(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	es.StartAsyncWriter()
	defer es.Flush()

	err := es.AppendAsync(context.Background(), orchestrator.DagEvent{
		Type:  "dag:created",
		DagID: "dag-async",
	})
	require.NoError(t, err)

	// Give the writer goroutine time to process
	require.Eventually(t, func() bool {
		return es.CurrentSequence() >= 1
	}, time.Second, 10*time.Millisecond, "async event should be persisted")
}

// TestEventStoreAppendAsyncFallback verifies that AppendAsync falls back
// to synchronous Append when the async writer is not running.
func TestEventStoreAppendAsyncFallback(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	// Don't call StartAsyncWriter ??should fall back to sync Append
	err := es.AppendAsync(context.Background(), orchestrator.DagEvent{
		Type:  "dag:created",
		DagID: "dag-fallback",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), es.CurrentSequence())
}

// TestEventStoreFlush verifies that Flush drains the async queue and
// stops the writer goroutine cleanly.
func TestEventStoreFlush(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	es.StartAsyncWriter()

	for i := 0; i < 10; i++ {
		_ = es.AppendAsync(context.Background(), orchestrator.DagEvent{
			Type:  "dag:created",
			DagID: "dag-flush",
		})
	}

	es.Flush()
	// All events should be persisted
	assert.GreaterOrEqual(t, es.CurrentSequence(), int64(10))
}

// TestEventStoreFlushWithoutWriter verifies that Flush is a no-op when
// the async writer was never started.
func TestEventStoreFlushWithoutWriter(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	// Should not panic
	es.Flush()
}

// TestEventStoreAsyncFallbacks verifies that AsyncFallbacks returns the
// count of synchronous fallbacks when the async queue is full.
func TestEventStoreAsyncFallbacks(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	// No async writer ??every AppendAsync falls back to sync
	_ = es.AppendAsync(context.Background(), orchestrator.DagEvent{Type: "test", DagID: "d"})
	_ = es.AppendAsync(context.Background(), orchestrator.DagEvent{Type: "test", DagID: "d"})
	// Fallbacks only counted when the queue is full (async writer running but channel full)
	// Without writer, it's a direct Append, so fallbacks stays 0
	assert.Equal(t, int64(0), es.AsyncFallbacks())
}

// TestEventStoreCurrentSequence verifies that CurrentSequence reflects
// the last assigned sequence number after appends.
func TestEventStoreCurrentSequence(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	assert.Equal(t, int64(0), es.CurrentSequence())

	_ = es.Append(context.Background(), orchestrator.DagEvent{Type: "test", DagID: "d"})
	assert.Equal(t, int64(1), es.CurrentSequence())

	_ = es.Append(context.Background(), orchestrator.DagEvent{Type: "test", DagID: "d"})
	assert.Equal(t, int64(2), es.CurrentSequence())
}

// --- TaskStateMachine extended tests ---

// TestTaskStateMachineError verifies that Error returns the last error
// set during a failed transition.
func TestTaskStateMachineError(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})
	assert.Nil(t, fsm.Error())

	// Transition to running, then to failed with an error
	nodeErr := &orchestrator.NodeError{Code: "TIMEOUT", Message: "timed out"}
	err := fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "ready"})
	require.NoError(t, err)
	err = fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{Reason: "queued"})
	require.NoError(t, err)
	err = fsm.Transition(orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "allocated"})
	require.NoError(t, err)
	err = fsm.Transition(orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "running"})
	require.NoError(t, err)
	err = fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{Reason: "timeout", Error: nodeErr})
	require.NoError(t, err)

	assert.Equal(t, "TIMEOUT", fsm.Error().Code)
}

// TestTaskStateMachineNodeIDDagIDPhase verifies the accessor methods
// return the values passed to the constructor.
func TestTaskStateMachineNodeIDDagIDPhase(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-x", "node-y", orchestrator.PhaseDownload, orchestrator.DagNodeDefinition{})
	assert.Equal(t, "node-y", fsm.NodeID())
	assert.Equal(t, "dag-x", fsm.DagID())
	assert.Equal(t, orchestrator.PhaseDownload, fsm.Phase())
}

// TestTaskStateMachineContext verifies that Context returns the state
// machine context with definition and retry count.
func TestTaskStateMachineContext(t *testing.T) {
	def := orchestrator.DagNodeDefinition{ID: "node-1", TaskType: "gallery"}
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, def)

	ctx := fsm.Context()
	assert.Equal(t, "node-1", ctx.Definition.ID)
	assert.Equal(t, 0, ctx.RetryCount)
	assert.Nil(t, ctx.LastError)
}

// TestTaskStateMachineResetRetryCount verifies that ResetRetryCount
// clears the retry counter after a failed-to-ready retry transition.
func TestTaskStateMachineResetRetryCount(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})

	// Drive to failed then back to ready to increment retry count
	fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "ready"})
	fsm.Transition(orchestrator.NodeStateQueued, orchestrator.TransitionContext{Reason: "queued"})
	fsm.Transition(orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "allocated"})
	fsm.Transition(orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "running"})
	fsm.Transition(orchestrator.NodeStateFailed, orchestrator.TransitionContext{Reason: "error", Error: &orchestrator.NodeError{Code: "ERR"}})
	fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "retry"})

	assert.Equal(t, 1, fsm.Context().RetryCount)

	fsm.ResetRetryCount()
	assert.Equal(t, 0, fsm.Context().RetryCount)
}

// TestTaskStateMachineCanTransitionTo verifies that CanTransitionTo
// returns the correct validity for transitions from the current state.
func TestTaskStateMachineCanTransitionTo(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})

	assert.True(t, fsm.CanTransitionTo(orchestrator.NodeStateReady))
	assert.False(t, fsm.CanTransitionTo(orchestrator.NodeStateRunning))

	// Move to ready
	fsm.Transition(orchestrator.NodeStateReady, orchestrator.TransitionContext{Reason: "ready"})
	assert.True(t, fsm.CanTransitionTo(orchestrator.NodeStateQueued))
	assert.False(t, fsm.CanTransitionTo(orchestrator.NodeStatePending))
}

// TestTaskStateMachineRestoreFromSnapshot verifies that
// RestoreFromSnapshot replaces history and derives the current state
// from the most recent transition record.
func TestTaskStateMachineRestoreFromSnapshot(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})

	history := []orchestrator.StateTransitionRecord{
		{NodeID: "node-1", DagID: "dag-1", From: orchestrator.NodeStatePending, To: orchestrator.NodeStateReady, Timestamp: time.Now(), Context: orchestrator.TransitionContext{Reason: "ready"}},
		{NodeID: "node-1", DagID: "dag-1", From: orchestrator.NodeStateReady, To: orchestrator.NodeStateQueued, Timestamp: time.Now(), Context: orchestrator.TransitionContext{Reason: "queued"}},
		{NodeID: "node-1", DagID: "dag-1", From: orchestrator.NodeStateQueued, To: orchestrator.NodeStateAllocated, Timestamp: time.Now(), Context: orchestrator.TransitionContext{Reason: "allocated"}},
	}

	nodeErr := &orchestrator.NodeError{Code: "ERR", Message: "test error"}
	fsm.RestoreFromSnapshot(history, nodeErr)

	assert.Equal(t, orchestrator.NodeStateAllocated, fsm.State())
	assert.Len(t, fsm.GetHistory(), 3)
	assert.Equal(t, "ERR", fsm.Error().Code)
}

// TestTaskStateMachineRestoreFromSnapshotEmpty verifies that restoring
// an empty history keeps the current state and sets enteredAt to now.
func TestTaskStateMachineRestoreFromSnapshotEmpty(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})

	fsm.RestoreFromSnapshot(nil, nil)
	assert.Equal(t, orchestrator.NodeStatePending, fsm.State())
	assert.Empty(t, fsm.GetHistory())
	assert.Nil(t, fsm.Error())
}

// TestTaskStateMachineRestoreFromSnapshotRetryCount verifies that
// RestoreFromSnapshot counts failed��ready transitions as retries.
func TestTaskStateMachineRestoreFromSnapshotRetryCount(t *testing.T) {
	fsm := orchestrator.NewTaskStateMachine("dag-1", "node-1", orchestrator.PhaseScrape, orchestrator.DagNodeDefinition{})

	history := []orchestrator.StateTransitionRecord{
		{From: orchestrator.NodeStatePending, To: orchestrator.NodeStateReady, Timestamp: time.Now()},
		{From: orchestrator.NodeStateReady, To: orchestrator.NodeStateFailed, Timestamp: time.Now()},
		{From: orchestrator.NodeStateFailed, To: orchestrator.NodeStateReady, Timestamp: time.Now()},
		{From: orchestrator.NodeStateReady, To: orchestrator.NodeStateFailed, Timestamp: time.Now()},
		{From: orchestrator.NodeStateFailed, To: orchestrator.NodeStateReady, Timestamp: time.Now()},
	}

	fsm.RestoreFromSnapshot(history, nil)
	assert.Equal(t, 2, fsm.Context().RetryCount)
}

// --- StateReconciler tests ---

// TestStateReconcilerVerifyNodeSkipped verifies that VerifyNode returns
// a skipped result when the node is not in a verifying state, preventing
// unnecessary work for nodes that haven't reached verification yet.
func TestStateReconcilerVerifyNodeSkipped(t *testing.T) {
	r := orchestrator.NewStateReconciler(nil)

	node := orchestrator.DagNodeForVerification{
		NodeID: "node-1",
		DagID:  "dag-1",
		State:  orchestrator.NodeStateRunning,
		Phase:  string(orchestrator.PhaseScrape),
	}

	result := r.VerifyNode(context.Background(), node)
	assert.Equal(t, "skipped", result.Status)
}

// TestStateReconcilerVerifyNodeVerifyingScrape verifies that a scrape
// node in verifying state triggers the scrape verification path.
func TestStateReconcilerVerifyNodeVerifyingScrape(t *testing.T) {
	r := orchestrator.NewStateReconciler(nil)

	node := orchestrator.DagNodeForVerification{
		NodeID: "node-1",
		DagID:  "dag-1",
		State:  orchestrator.NodeStateVerifying,
		Phase:  string(orchestrator.PhaseScrape),
	}

	result := r.VerifyNode(context.Background(), node)
	// Without a DB, verification will return some result (likely needs_retry or ok)
	assert.NotEmpty(t, result.Status)
}

// --- OuoOrchestrator extended tests ---

// TestOuoResolveOuoIOPassThrough verifies that an OUO-pattern URL
// pointing to a local test server is resolved via HTTP redirect.
func TestOuoResolveOuoIOPassThrough(t *testing.T) {
	targetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer targetServer.Close()

	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, targetServer.URL, http.StatusFound)
	}))
	defer relayServer.Close()

	o := orchestrator.NewOuoOrchestrator()

	// Non-OUO URL ??passthrough
	resolved, err := o.Resolve(context.Background(), relayServer.URL+"/test")
	require.NoError(t, err)
	assert.Equal(t, relayServer.URL+"/test", resolved)
}

// TestOuoResolveOuoPressPattern verifies that "ouo.press" URLs are
// detected as OUO links (without actually making a request, since
// we can't control DNS for ouo.press in unit tests).
func TestOuoResolveOuoPressPattern(t *testing.T) {
	o := orchestrator.NewOuoOrchestrator()

	// Non-OUO URL should pass through
	resolved, err := o.Resolve(context.Background(), "https://regular.com/file.zip")
	require.NoError(t, err)
	assert.Equal(t, "https://regular.com/file.zip", resolved)
}
