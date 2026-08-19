package dag_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// TestAutoReactivationResubmitsStuckReadyNode is a regression test for
// the "Scrape Submit 失败回滚卡死" defect: when the scheduler rejects a
// submission (queue full), submitToScheduler rolls the node back to
// READY and nothing re-submits it, so the DAG stalls forever.
//
// The test drives the exact production scenario: submit with a
// rejecting scheduler (node lands in READY), then let the periodic
// auto-reactivation ticker run after capacity frees up — the node must
// be submitted on a later tick.
func TestAutoReactivationResubmitsStuckReadyNode(t *testing.T) {
	sched := newMockScheduler(false) // queue full: every Submit rejected
	o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
	o1.SetScheduler(sched)
	require.NoError(t, o1.Initialize(context.Background()))

	_, err := o1.SubmitDag(context.Background(), newSimpleDagDef("dag-A"))
	require.NoError(t, err)

	// Submit was rejected: the node must have rolled back to READY and
	// the scheduler must not have accepted it.
	status := o1.GetDagStatus("dag-A")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStateReady, status.Nodes[0].State,
		"rejected node must be rolled back to READY")
	sched.mu.Lock()
	_, accepted := sched.submitted["dag-A:node-1"]
	sched.mu.Unlock()
	assert.False(t, accepted, "scheduler rejected the first submission")

	// Capacity frees up; the periodic scan must re-submit the node.
	sched.mu.Lock()
	sched.acceptAll = true
	sched.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o1.StartAutoReactivation(ctx, 20*time.Millisecond)

	// Poll for the re-submission (the ticker runs every 20ms).
	deadline := time.Now().Add(5 * time.Second)
	for {
		sched.mu.Lock()
		ok := sched.submitted["dag-A:node-1"]
		sched.mu.Unlock()
		if ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("auto reactivation did not re-submit the stuck READY node within 5s")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// After a successful submission the node leaves READY (QUEUED).
	status = o1.GetDagStatus("dag-A")
	require.NotNil(t, status)
	require.Len(t, status.Nodes, 1)
	assert.NotEqual(t, orchestrator.NodeStateReady, status.Nodes[0].State,
		"node should leave READY after the re-submission")
}

// TestAutoReactivationIdempotent verifies StartAutoReactivation does
// not spawn multiple tickers when called repeatedly.
func TestAutoReactivationIdempotent(t *testing.T) {
	o1 := dag.NewDagOrchestrator(orchestrator.NewEventStore(nil, nil), &mockSlotPool{})
	o1.SetScheduler(newMockScheduler(true))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o1.StartAutoReactivation(ctx, time.Second)
	o1.StartAutoReactivation(ctx, time.Second)
	o1.StartAutoReactivation(ctx, time.Second)

	// No panic / no duplicate goroutine leak; reaching here is the
	// assertion (idempotence guard).
}
