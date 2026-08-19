package scheduler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator/slot"
)

// newEngineWithPool builds an engine with a single-slot pool for
// deterministic timeout/drain tests.
func newEngineWithPool() *SchedulerEngine {
	sp := slot.NewSlotPool()
	sp.RegisterType(slot.SlotTypeDefinition{Key: "scraping", Label: "Scraping", DefaultMax: 1, Min: 1, Max: 1})
	return NewSchedulerEngine(sp)
}

// TestExecuteNodeTimeout verifies that a node exceeding its TimeoutMs is
// failed with a timeout reason and its slot is released.
func TestExecuteNodeTimeout(t *testing.T) {
	engine := newEngineWithPool()
	orch := &timeoutMockOrch{}
	engine.SetDagOrchestrator(orch)

	executed := make(chan struct{}, 2)
	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		executed <- struct{}{}
		if node.NodeID == "n-next" {
			return true, nil
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(5 * time.Second):
			return true, nil
		}
	})

	node := SchedulableNodeAdapter{
		NodeID: "n-timeout", DagID: "d", TaskType: "gallery", Priority: 5,
		SubmittedAt: time.Now(),
		TimeoutMs:   100,
		ResourceRequirements: []slot.ResourceRequirement{
			{SlotType: "scraping", Count: 1},
		},
	}
	require.True(t, engine.Submit(node))

	select {
	case <-executed:
	case <-time.After(2 * time.Second):
		t.Fatal("executor never started")
	}

	require.Eventually(t, func() bool {
		return orch.failedTimeout.Load()
	}, 3*time.Second, 20*time.Millisecond, "node should transition to failed(timeout)")

	// Slot must be released so a second node can run.
	require.True(t, engine.Submit(SchedulableNodeAdapter{
		NodeID: "n-next", DagID: "d", TaskType: "gallery", Priority: 5,
		SubmittedAt:          time.Now(),
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}))
}

// TestStopWithDrainWaitsForRunning verifies drain blocks until an
// in-flight node completes when it finishes before the deadline.
func TestStopWithDrainWaitsForRunning(t *testing.T) {
	engine := newEngineWithPool()
	engine.SetDagOrchestrator(&timeoutMockOrch{})

	executing := make(chan struct{})
	release := make(chan struct{})
	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		close(executing)
		<-release
		return true, nil
	})
	require.True(t, engine.Submit(SchedulableNodeAdapter{
		NodeID: "n-run", DagID: "d", TaskType: "gallery", Priority: 5,
		SubmittedAt:          time.Now(),
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}))
	// Wait for executor to actually start blocking.
	<-executing

	// Start drain in background; it blocks because node is still running.
	drained := make(chan bool, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		drained <- engine.StopWithDrain(ctx)
	}()

	// Drain must have set the draining flag by now.
	require.Eventually(t, func() bool {
		return engine.IsDraining()
	}, time.Second, 5*time.Millisecond)

	// New submissions are rejected while draining.
	assert.False(t, engine.Submit(SchedulableNodeAdapter{
		NodeID: "n-late", DagID: "d", TaskType: "gallery", Priority: 5,
		SubmittedAt:          time.Now(),
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}))

	// Release the running node; drain should complete.
	close(release)
	select {
	case ok := <-drained:
		assert.True(t, ok, "should drain cleanly before deadline")
	case <-time.After(5 * time.Second):
		t.Fatal("drain did not return")
	}
}

// TestStopWithDrainCancelsOnDeadline verifies that a node outliving the
// drain deadline is cancelled and drain reports false.
func TestStopWithDrainCancelsOnDeadline(t *testing.T) {
	engine := newEngineWithPool()
	engine.SetDagOrchestrator(&timeoutMockOrch{})

	executing := make(chan struct{})
	cancelled := make(chan struct{})
	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		close(executing)
		<-ctx.Done()
		close(cancelled)
		return false, ctx.Err()
	})
	require.True(t, engine.Submit(SchedulableNodeAdapter{
		NodeID: "n-stuck", DagID: "d", TaskType: "gallery", Priority: 5,
		SubmittedAt:          time.Now(),
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}))
	<-executing

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	ok := engine.StopWithDrain(ctx)
	assert.False(t, ok, "deadline hit should report incomplete drain")

	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("running node context was not cancelled on drain deadline")
	}
}

// timeoutMockOrch records timeout transitions and completions.
type timeoutMockOrch struct {
	failedTimeout atomic.Bool
	completions   atomic.Int32
}

func (m *timeoutMockOrch) TransitionNode(dagID, nodeID, toState, reason, triggeredBy string) error {
	if toState == "failed" && reason == "node execution timeout" {
		m.failedTimeout.Store(true)
	}
	return nil
}

func (m *timeoutMockOrch) OnNodeCompleted(dagID, nodeID string, success bool, data map[string]any, errMsg string) error {
	m.completions.Add(1)
	return nil
}

func (m *timeoutMockOrch) ReactivateReadyNodes() {}

func (m *timeoutMockOrch) GetNodeForVerification(dagID, nodeID string) interface{} { return nil }
