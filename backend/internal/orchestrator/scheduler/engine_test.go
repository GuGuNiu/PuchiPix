package scheduler

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator/slot"
)

// mockDagOrchestrator captures scheduler callbacks for assertion without
// requiring a real DAG orchestrator or database connection.
type mockDagOrchestrator struct {
	mu           sync.Mutex
	transitions  []mockTransition
	completions  []mockCompletion
	reactivated  int
	completed    chan struct{}
}

type mockTransition struct {
	dagID, nodeID, toState, reason, triggeredBy string
}

type mockCompletion struct {
	dagID, nodeID, errMsg string
	success               bool
	data                  map[string]any
}

func newMockDagOrchestrator() *mockDagOrchestrator {
	return &mockDagOrchestrator{
		completed: make(chan struct{}, 100),
	}
}

func (m *mockDagOrchestrator) TransitionNode(dagID, nodeID, toState, reason, triggeredBy string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.transitions = append(m.transitions, mockTransition{dagID, nodeID, toState, reason, triggeredBy})
	return nil
}

func (m *mockDagOrchestrator) OnNodeCompleted(dagID, nodeID string, success bool, data map[string]any, errMsg string) error {
	m.mu.Lock()
	m.completions = append(m.completions, mockCompletion{dagID, nodeID, errMsg, success, data})
	m.mu.Unlock()
	m.completed <- struct{}{}
	return nil
}

func (m *mockDagOrchestrator) ReactivateReadyNodes() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reactivated++
}

func (m *mockDagOrchestrator) GetNodeForVerification(dagID, nodeID string) interface{} {
	return nil
}

// waitForCompletion blocks until at least one OnNodeCompleted call arrives
// or the test times out, providing a race-free synchronization point.
func (m *mockDagOrchestrator) waitForCompletion(t *testing.T) {
	t.Helper()
	select {
	case <-m.completed:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for node completion")
	}
}

// TestPriorityFairStrategyName verifies the strategy identifier so
// monitoring dashboards can label scheduling metrics correctly.
func TestPriorityFairStrategyName(t *testing.T) {
	s := &PriorityFairStrategy{}
	assert.Equal(t, "priority-fair", s.Name())
}

// TestPriorityFairStrategySelectNext verifies that the strategy picks
// the highest-priority node whose resource requirements are satisfiable,
// preventing low-priority nodes from starving critical work.
func TestPriorityFairStrategySelectNext(t *testing.T) {
	strategy := &PriorityFairStrategy{}
	slots := map[string]slot.SlotUsage{
		"scraping": {SlotType: "scraping", Available: 2},
	}

	nodes := []SchedulableNodeEntry{
		{orchestratorNode: SchedulableNodeAdapter{NodeID: "low", Priority: 3, ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}}, QueueKey: "dag:low"},
		{orchestratorNode: SchedulableNodeAdapter{NodeID: "high", Priority: 8, ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}}, QueueKey: "dag:high"},
		{orchestratorNode: SchedulableNodeAdapter{NodeID: "normal", Priority: 5, ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}}, QueueKey: "dag:normal"},
	}

	selected := strategy.SelectNext(nodes, slots)
	require.NotNil(t, selected)
	assert.Equal(t, "high", selected.orchestratorNode.NodeID)
}

// TestPriorityFairStrategySelectNextResourceUnavailable verifies that
// nodes are skipped when the slot pool cannot satisfy their requirements,
// preventing the scheduler from over-committing resources.
func TestPriorityFairStrategySelectNextResourceUnavailable(t *testing.T) {
	strategy := &PriorityFairStrategy{}
	slots := map[string]slot.SlotUsage{
		"scraping": {SlotType: "scraping", Available: 0},
	}

	nodes := []SchedulableNodeEntry{
		{orchestratorNode: SchedulableNodeAdapter{NodeID: "n1", Priority: 5, ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}}, QueueKey: "dag:n1"},
	}

	selected := strategy.SelectNext(nodes, slots)
	assert.Nil(t, selected)
}

// TestPriorityFairStrategySelectNextUnknownSlotType verifies that a node
// requiring an unregistered slot type is skipped, avoiding dispatch to
// a resource pool that does not exist.
func TestPriorityFairStrategySelectNextUnknownSlotType(t *testing.T) {
	strategy := &PriorityFairStrategy{}
	slots := map[string]slot.SlotUsage{
		"scraping": {SlotType: "scraping", Available: 5},
	}

	nodes := []SchedulableNodeEntry{
		{orchestratorNode: SchedulableNodeAdapter{NodeID: "n1", Priority: 5, ResourceRequirements: []slot.ResourceRequirement{{SlotType: "unknown", Count: 1}}}, QueueKey: "dag:n1"},
	}

	selected := strategy.SelectNext(nodes, slots)
	assert.Nil(t, selected)
}

// TestPriorityFairStrategySelectNextEmpty verifies the strategy returns
// nil for an empty node list, allowing the scheduler to exit its loop.
func TestPriorityFairStrategySelectNextEmpty(t *testing.T) {
	strategy := &PriorityFairStrategy{}
	selected := strategy.SelectNext([]SchedulableNodeEntry{}, map[string]slot.SlotUsage{})
	assert.Nil(t, selected)
}

// TestSchedulerEngineSubmitAndHasNode verifies that submitted nodes are
// tracked in the ready queue and queryable via HasNode, and that
// CancelNode removes them from the queue.
func TestSchedulerEngineSubmitAndHasNode(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 10})
	engine := NewSchedulerEngine(pool)

	node := SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}

	accepted := engine.Submit(node)
	assert.True(t, accepted)
	assert.True(t, engine.HasNode("dag-1", "node-1"))

	engine.CancelNode("dag-1", "node-1")
	assert.False(t, engine.HasNode("dag-1", "node-1"))
}

// TestSchedulerEngineSubmitQueueFull verifies that the per-slot capacity
// limit rejects excess submissions, preventing unbounded queue growth
// when the downstream service cannot keep up.
func TestSchedulerEngineSubmitQueueFull(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "sniff", DefaultMax: 0, Min: 0, Max: 10})
	engine := NewSchedulerEngine(pool)

	// sniff has maxQueueSize = 1 by default
	node1 := SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "sniff", Count: 1}},
	}
	node2 := SchedulableNodeAdapter{
		NodeID:               "node-2",
		DagID:                "dag-2",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "sniff", Count: 1}},
	}

	assert.True(t, engine.Submit(node1))
	assert.False(t, engine.Submit(node2), "second sniff node should be rejected when queue is full")
}

// TestSchedulerEngineGetStats verifies that queue statistics correctly
// categorize nodes by priority and task type for monitoring dashboards.
func TestSchedulerEngineGetStats(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 20})
	engine := NewSchedulerEngine(pool)

	engine.Submit(SchedulableNodeAdapter{NodeID: "n1", DagID: "d1", Priority: 5, TaskType: "gallery", ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}})
	engine.Submit(SchedulableNodeAdapter{NodeID: "n2", DagID: "d2", Priority: 8, TaskType: "video", ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}})

	stats := engine.GetStats()
	assert.Equal(t, 2, stats.QueueSize)
	assert.Equal(t, "priority-fair", stats.Strategy)
	assert.Equal(t, 1, stats.ByPriority["NORMAL"])
	assert.Equal(t, 1, stats.ByPriority["HIGH"])
	assert.Equal(t, 1, stats.ByTaskType["gallery"])
	assert.Equal(t, 1, stats.ByTaskType["video"])
}

// TestSchedulerEngineGetStatsUnknownPriority verifies that nodes with
// non-standard priority values are categorized as UNKNOWN rather than
// silently dropped from statistics.
func TestSchedulerEngineGetStatsUnknownPriority(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 20})
	engine := NewSchedulerEngine(pool)

	engine.Submit(SchedulableNodeAdapter{NodeID: "n1", DagID: "d1", Priority: 42, TaskType: "gallery", ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}}})

	stats := engine.GetStats()
	assert.Equal(t, 1, stats.ByPriority["UNKNOWN"])
}

// TestSchedulerEngineScheduleDispatch verifies that Schedule acquires
// slots, transitions the node through allocated/running, and invokes
// the executor function, completing the full dispatch lifecycle.
func TestSchedulerEngineScheduleDispatch(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 2, Min: 1, Max: 10})
	engine := NewSchedulerEngine(pool)

	mockOrch := newMockDagOrchestrator()
	engine.SetDagOrchestrator(mockOrch)

	var executedNode SchedulableNodeAdapter
	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		executedNode = node
		return true, nil
	})

	node := SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		Priority:             5,
		TaskType:             "gallery",
		ExecutorKey:          "scrape",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}

	engine.Submit(node)

	// Wait for the executor goroutine to call OnNodeCompleted
	mockOrch.waitForCompletion(t)

	assert.Equal(t, "node-1", executedNode.NodeID)
	assert.False(t, engine.HasNode("dag-1", "node-1"), "node should be removed from queue after dispatch")

	mockOrch.mu.Lock()
	defer mockOrch.mu.Unlock()
	assert.NotEmpty(t, mockOrch.transitions, "should have transition callbacks for allocated and running")
	assert.Len(t, mockOrch.completions, 1)
	assert.True(t, mockOrch.completions[0].success)
}

// TestSchedulerEngineScheduleDispatchFailure verifies that a failed
// executor result is reported back to the DAG orchestrator with the
// error message, enabling retry logic to kick in.
func TestSchedulerEngineScheduleDispatchFailure(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 2, Min: 1, Max: 10})
	engine := NewSchedulerEngine(pool)

	mockOrch := newMockDagOrchestrator()
	engine.SetDagOrchestrator(mockOrch)

	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		return false, fmt.Errorf("scrape timeout")
	})

	node := SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		Priority:             5,
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	}

	engine.Submit(node)
	mockOrch.waitForCompletion(t)

	mockOrch.mu.Lock()
	defer mockOrch.mu.Unlock()
	assert.Len(t, mockOrch.completions, 1)
	assert.False(t, mockOrch.completions[0].success)
	assert.Contains(t, mockOrch.completions[0].errMsg, "scrape timeout")
}

// TestSchedulerEngineSyncQueueCapacity verifies that the queue capacity
// is updated from the slot pool's max values, allowing runtime
// reconfiguration to accept more queued nodes.
func TestSchedulerEngineSyncQueueCapacity(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 20})
	engine := NewSchedulerEngine(pool)

	// Default queue capacity for scraping is 5; fill it
	for i := 0; i < 5; i++ {
		accepted := engine.Submit(SchedulableNodeAdapter{
			NodeID:               fmt.Sprintf("node-%d", i),
			DagID:                fmt.Sprintf("dag-%d", i),
			ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
		})
		require.True(t, accepted, "node %d should be accepted within default capacity", i)
	}

	// 6th node should be rejected (queue full at 5)
	rejected := engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-5",
		DagID:                "dag-5",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})
	assert.False(t, rejected, "6th node should be rejected when queue is full at default capacity")

	// Increase pool max and sync queue capacity
	pool.UpdateMax("scraping", 10)
	engine.SyncQueueCapacityFromSlotPool()

	// Now the 6th node should be accepted
	accepted := engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-5",
		DagID:                "dag-5",
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})
	assert.True(t, accepted, "node should be accepted after capacity sync increased the limit")
}

// TestSchedulerEngineOnSlotFreed verifies that OnSlotFreed triggers a
// scheduling pass, allowing queued nodes to be dispatched when capacity
// becomes available after a slot is released.
func TestSchedulerEngineOnSlotFreed(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 1, Min: 1, Max: 10})
	engine := NewSchedulerEngine(pool)

	mockOrch := newMockDagOrchestrator()
	engine.SetDagOrchestrator(mockOrch)

	var mu sync.Mutex
	var executed []string
	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		mu.Lock()
		executed = append(executed, node.NodeID)
		mu.Unlock()
		return true, nil
	})

	// Submit first node ??dispatched immediately (max=1)
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		Priority:             5,
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})

	// Wait for first node to complete (releases the slot)
	mockOrch.waitForCompletion(t)

	// Submit second node ??should dispatch since the slot was freed
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-2",
		DagID:                "dag-2",
		Priority:             5,
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})

	// If Submit's Schedule didn't dispatch it, OnSlotFreed will
	engine.OnSlotFreed("scraping")

	mockOrch.waitForCompletion(t)

	mu.Lock()
	defer mu.Unlock()
	assert.Contains(t, executed, "node-1")
	assert.Contains(t, executed, "node-2")
}

// TestSchedulerEngineStartScanTimer verifies that the periodic scan
// triggers scheduling passes, compensating for missed slot-freed
// callbacks when a slot pool's capacity is increased at runtime.
func TestSchedulerEngineStartScanTimer(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 0, Min: 0, Max: 10})
	engine := NewSchedulerEngine(pool)

	mockOrch := newMockDagOrchestrator()
	engine.SetDagOrchestrator(mockOrch)

	engine.SetExecutorFunc(func(ctx context.Context, node SchedulableNodeAdapter) (bool, error) {
		return true, nil
	})

	engine.StartScanTimer(50 * time.Millisecond)
	defer engine.Stop()

	// Submit a node while no slots are available ??it stays in queue
	engine.Submit(SchedulableNodeAdapter{
		NodeID:               "node-1",
		DagID:                "dag-1",
		Priority:             5,
		ResourceRequirements: []slot.ResourceRequirement{{SlotType: "scraping", Count: 1}},
	})
	assert.True(t, engine.HasNode("dag-1", "node-1"), "node should stay in queue when no slots available")

	// Increase capacity ??the scan timer should pick it up
	pool.UpdateMax("scraping", 2)

	// Wait for the scan timer to dispatch the node
	mockOrch.waitForCompletion(t)
	assert.False(t, engine.HasNode("dag-1", "node-1"), "node should be dispatched by scan timer")
}

// TestSchedulerEngineStop verifies that Stop cleanly shuts down the
// scan timer without panicking, even when called multiple times.
func TestSchedulerEngineStop(t *testing.T) {
	pool := slot.NewSlotPool()
	pool.RegisterType(slot.SlotTypeDefinition{Key: "scraping", DefaultMax: 1, Min: 1, Max: 10})
	engine := NewSchedulerEngine(pool)

	engine.StartScanTimer(100 * time.Millisecond)
	engine.Stop()

	// Stopping again should not panic
	assert.NotPanics(t, func() {
		engine.Stop()
	})
}
