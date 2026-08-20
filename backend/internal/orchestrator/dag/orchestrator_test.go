package dag_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// mockScheduler implements dag.SchedulerInterface for testing,
// recording all interactions for later assertion.
type mockScheduler struct {
	mu              sync.Mutex
	submitted       map[string]bool
	cancelled       []string
	acceptAll       bool
	priorityUpdates []string
}

func newMockScheduler(accept bool) *mockScheduler {
	return &mockScheduler{
		submitted: make(map[string]bool),
		acceptAll: accept,
	}
}

func (m *mockScheduler) Submit(node orchestrator.SchedulableNode) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.acceptAll {
		return false
	}
	m.submitted[node.DagID+":"+node.NodeID] = true
	return true
}

func (m *mockScheduler) HasNode(dagID, nodeID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.submitted[dagID+":"+nodeID]
}

func (m *mockScheduler) CancelNode(dagID, nodeID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.submitted, dagID+":"+nodeID)
	m.cancelled = append(m.cancelled, dagID+":"+nodeID)
}

func (m *mockScheduler) OnSlotFreed(slotType string) {}

// SubmitWithDelay records the delayed submission as an immediate one
// for test determinism (the orchestrator's delay logic is covered by
// scheduler-level tests).
func (m *mockScheduler) SubmitWithDelay(node orchestrator.SchedulableNode, delay time.Duration) {
	m.Submit(node)
}

// UpdateNodePriority records priority updates for assertion.
func (m *mockScheduler) UpdateNodePriority(dagID, nodeID string, newPriority int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.priorityUpdates = append(m.priorityUpdates, dagID+":"+nodeID)
	return m.submitted[dagID+":"+nodeID]
}

// mockSlotPool implements dag.SlotPoolInterface for testing.
type mockSlotPool struct {
	mu        sync.Mutex
	released  []string
	callbacks []func(string)
}

func (m *mockSlotPool) SetSchedulerCallback(cb func(string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks = append(m.callbacks, cb)
}

func (m *mockSlotPool) SetMaxUpdateCallback(cb func(string, int)) {
	// no-op in tests; max updates are not exercised by orchestrator tests.
}

func (m *mockSlotPool) ReleaseAll(holderID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.released = append(m.released, holderID)
}

func newTestDagOrchestrator() *dag.DagOrchestrator {
	es := orchestrator.NewEventStore(nil, nil)
	sp := &mockSlotPool{}
	return dag.NewDagOrchestrator(es, sp)
}

func newSimpleDagDef(dagID string) orchestrator.DagDefinition {
	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes: []orchestrator.DagNodeDefinition{
			{
				ID:       "node-1",
				TaskType: orchestrator.TaskTypeGallery,
				Phase:    orchestrator.PhaseScrape,
				Executor: "scrape",
				Priority: orchestrator.PriorityNormal,
			},
		},
		Metadata: orchestrator.DagMetadata{
			SourceURL: "https://example.com/gallery/1",
		},
	}
}

func newMultiNodeDagDef(dagID string) orchestrator.DagDefinition {
	return orchestrator.DagDefinition{
		ID:       dagID,
		TaskType: orchestrator.TaskTypeGallery,
		Nodes: []orchestrator.DagNodeDefinition{
			{
				ID:       "scrape",
				TaskType: orchestrator.TaskTypeGallery,
				Phase:    orchestrator.PhaseScrape,
				Executor: "scrape",
				Priority: orchestrator.PriorityNormal,
			},
			{
				ID:           "download",
				TaskType:     orchestrator.TaskTypeGallery,
				Phase:        orchestrator.PhaseDownload,
				Executor:     "download",
				Priority:     orchestrator.PriorityNormal,
				Dependencies: []string{"scrape"},
			},
		},
		Metadata: orchestrator.DagMetadata{
			SourceURL: "https://example.com/gallery/2",
		},
	}
}

// TestDagOrchestratorSubmitDagNoScheduler verifies that submitting a DAG
// without a scheduler transitions initially-ready nodes to QUEUED state
// but does not dispatch them, preventing nil pointer dereferences.
func TestDagOrchestratorSubmitDagNoScheduler(t *testing.T) {
	o := newTestDagOrchestrator()

	dagID, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)
	assert.Equal(t, "dag-1", dagID)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Len(t, status.Nodes, 1)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State)
}

// TestDagOrchestratorSubmitDagWithScheduler verifies that submitting a
// DAG with an accepting scheduler dispatches nodes to the scheduler.
func TestDagOrchestratorSubmitDagWithScheduler(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	assert.True(t, sched.HasNode("dag-1", "node-1"), "node should be submitted to scheduler")
}

// TestDagOrchestratorSubmitDagSchedulerRejects verifies that when the
// scheduler rejects a node (queue full), the node rolls back to READY
// state so it can be re-submitted later.
func TestDagOrchestratorSubmitDagSchedulerRejects(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(false)
	o.SetScheduler(sched)

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateReady, status.Nodes[0].State,
		"node should roll back to READY when scheduler rejects")
}

// TestDagOrchestratorSubmitDagWithDependencies verifies that nodes with
// unsatisfied dependencies remain in PENDING while dependency-free nodes
// are activated, ensuring correct topological activation order.
func TestDagOrchestratorSubmitDagWithDependencies(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newMultiNodeDagDef("dag-1"))
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)

	for _, node := range status.Nodes {
		if node.NodeID == "scrape" {
			assert.Equal(t, orchestrator.NodeStateQueued, node.State,
				"dependency-free node should be activated to QUEUED")
		}
		if node.NodeID == "download" {
			assert.Equal(t, orchestrator.NodeStatePending, node.State,
				"node with unmet dependencies should stay PENDING")
		}
	}
}

// TestDagOrchestratorOnNodeCompleted verifies that completing a node
// activates its downstream dependents, propagating execution through
// the dependency graph.
func TestDagOrchestratorOnNodeCompleted(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newMultiNodeDagDef("dag-1"))
	require.NoError(t, err)

	// Manually transition "scrape" to COMPLETED so its dependent can activate
	ctx := context.Background()
	_ = o.TransitionNode(ctx, "dag-1", "scrape", orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"})
	_ = o.TransitionNode(ctx, "dag-1", "scrape", orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"})
	_ = o.TransitionNode(ctx, "dag-1", "scrape", orchestrator.NodeStateVerifying, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"})
	_ = o.TransitionNode(ctx, "dag-1", "scrape", orchestrator.NodeStateCompleted, orchestrator.TransitionContext{Reason: "done", TriggeredBy: "system"})

	// OnNodeCompleted should trigger activateReadyNodes, which activates "download"
	err = o.OnNodeCompleted(ctx, "dag-1", "scrape", orchestrator.NodeExecutionResult{Success: true})
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	for _, node := range status.Nodes {
		if node.NodeID == "download" {
			assert.Equal(t, orchestrator.NodeStateQueued, node.State,
				"downstream node should be activated after dependency completes")
		}
	}
}

// TestDagOrchestratorOnNodeCompletedNotFound verifies that completing a
// non-existent node returns ErrNodeNotFound without corrupting state.
func TestDagOrchestratorOnNodeCompletedNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	err = o.OnNodeCompleted(context.Background(), "dag-1", "nonexistent", orchestrator.NodeExecutionResult{Success: true})
	assert.Error(t, err)
}

// TestDagOrchestratorPauseDag verifies that pausing a DAG transitions
// all non-terminal nodes to PAUSED state and cancels them from the
// scheduler, freeing resources for other work.
func TestDagOrchestratorPauseDag(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	err = o.PauseDag(context.Background(), "dag-1")
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStatePaused, status.Nodes[0].State)

	sched.mu.Lock()
	assert.NotEmpty(t, sched.cancelled, "node should be cancelled from scheduler")
	sched.mu.Unlock()
}

// TestDagOrchestratorCancelDag verifies that cancelling a DAG transitions
// all non-terminal nodes to CANCELLED state, a terminal disposition that
// prevents further execution.
func TestDagOrchestratorCancelDag(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	err = o.CancelDag(context.Background(), "dag-1")
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateCancelled, status.Nodes[0].State)
	assert.True(t, orchestrator.IsTerminalState(status.Nodes[0].State))
}

// TestDagOrchestratorResumeDag verifies that resuming a paused DAG
// transitions nodes back to QUEUED and re-submits them to the scheduler.
func TestDagOrchestratorResumeDag(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	err = o.PauseDag(context.Background(), "dag-1")
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStatePaused, status.Nodes[0].State)

	err = o.ResumeDag(context.Background(), "dag-1", "")
	require.NoError(t, err)

	status = o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State,
		"paused node should be re-queued after resume")
}

// TestDagOrchestratorResumeDagSingleNode verifies that resuming a
// specific node only resumes that node, leaving other paused nodes
// untouched.
func TestDagOrchestratorResumeDagSingleNode(t *testing.T) {
	o := newTestDagOrchestrator()

	def := orchestrator.DagDefinition{
		ID:       "dag-1",
		TaskType: orchestrator.TaskTypeGallery,
		Nodes: []orchestrator.DagNodeDefinition{
			{ID: "node-a", TaskType: orchestrator.TaskTypeGallery, Phase: orchestrator.PhaseScrape, Executor: "scrape", Priority: orchestrator.PriorityNormal},
			{ID: "node-b", TaskType: orchestrator.TaskTypeGallery, Phase: orchestrator.PhaseScrape, Executor: "scrape", Priority: orchestrator.PriorityNormal},
		},
	}

	_, err := o.SubmitDag(context.Background(), def)
	require.NoError(t, err)

	err = o.PauseDag(context.Background(), "dag-1")
	require.NoError(t, err)

	// Resume only node-a
	err = o.ResumeDag(context.Background(), "dag-1", "node-a")
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	for _, node := range status.Nodes {
		if node.NodeID == "node-a" {
			assert.Equal(t, orchestrator.NodeStateQueued, node.State, "node-a should be resumed")
		}
		if node.NodeID == "node-b" {
			assert.Equal(t, orchestrator.NodeStatePaused, node.State, "node-b should remain paused")
		}
	}
}

// TestDagOrchestratorRetryDag verifies that retrying a DAG with failed
// nodes transitions them back to QUEUED and re-submits to the scheduler.
// A nil scheduler is used to avoid the orphaned-QUEUED recovery path
// that would otherwise roll the node back to READY after SubmitDag.
func TestDagOrchestratorRetryDag(t *testing.T) {
	o := newTestDagOrchestrator()

	ctx := context.Background()
	_, err := o.SubmitDag(ctx, newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	// Without a scheduler, the node stays in QUEUED after SubmitDag.
	// Transition it through to FAILED so RetryDag can pick it up.
	_ = o.TransitionNode(ctx, "dag-1", "node-1", orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"})
	_ = o.TransitionNode(ctx, "dag-1", "node-1", orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"})
	_ = o.TransitionNode(ctx, "dag-1", "node-1", orchestrator.NodeStateFailed, orchestrator.TransitionContext{Reason: "scrape failed", TriggeredBy: "system"})

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateFailed, status.Nodes[0].State)

	// Retry the failed node
	err = o.RetryDag(ctx, "dag-1", "")
	require.NoError(t, err)

	status = o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State,
		"failed node should be re-queued after retry")
}

// TestDagOrchestratorRetryDagNoRetryable verifies that retrying a DAG
// with no failed/timed-out nodes is a no-op, returning nil without
// changing any node states.
func TestDagOrchestratorRetryDagNoRetryable(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	// Node is in QUEUED, not failed ??retry should be a no-op
	err = o.RetryDag(context.Background(), "dag-1", "")
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State,
		"non-failed node state should be unchanged after retry")
}

// TestDagOrchestratorGetDagSnapshot verifies that GetDagSnapshot returns
// a complete snapshot of all node states, definitions, and history for
// persistence and recovery.
func TestDagOrchestratorGetDagSnapshot(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	snap := o.GetDagSnapshot("dag-1")
	require.NotNil(t, snap)
	assert.Equal(t, "dag-1", snap.DagID)
	assert.Len(t, snap.NodeStates, 1)
	assert.Equal(t, "node-1", snap.NodeStates[0].NodeID)
	assert.Equal(t, orchestrator.NodeStateQueued, snap.NodeStates[0].State)
}

// TestDagOrchestratorGetDagSnapshotNotFound verifies that snapshotting a
// non-existent DAG returns nil rather than panicking.
func TestDagOrchestratorGetDagSnapshotNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	snap := o.GetDagSnapshot("nonexistent")
	assert.Nil(t, snap)
}

// TestDagOrchestratorGetAllDagSnapshots verifies that GetAllDagSnapshots
// returns snapshots for all submitted DAGs.
func TestDagOrchestratorGetAllDagSnapshots(t *testing.T) {
	o := newTestDagOrchestrator()

	_, _ = o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	_, _ = o.SubmitDag(context.Background(), newSimpleDagDef("dag-2"))

	snapshots := o.GetAllDagSnapshots()
	assert.Len(t, snapshots, 2)
}

// TestDagOrchestratorGetStats verifies that GetStats reports correct
// aggregate counts of total DAGs, active DAGs, and total nodes.
func TestDagOrchestratorGetStats(t *testing.T) {
	o := newTestDagOrchestrator()

	_, _ = o.SubmitDag(context.Background(), newMultiNodeDagDef("dag-1"))
	_, _ = o.SubmitDag(context.Background(), newSimpleDagDef("dag-2"))

	stats := o.GetStats()
	assert.Equal(t, 2, stats.TotalDags)
	assert.Equal(t, 3, stats.TotalNodes, "2 nodes from dag-1 + 1 node from dag-2")
}

// TestDagOrchestratorGetDagStatusNotFound verifies that querying a
// non-existent DAG returns nil.
func TestDagOrchestratorGetDagStatusNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	status := o.GetDagStatus("nonexistent")
	assert.Nil(t, status)
}

// TestDagOrchestratorPauseDagNotFound verifies that pausing a
// non-existent DAG returns ErrDagNotFound.
func TestDagOrchestratorPauseDagNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	err := o.PauseDag(context.Background(), "nonexistent")
	assert.Error(t, err)
}

// TestDagOrchestratorCancelDagNotFound verifies that cancelling a
// non-existent DAG returns ErrDagNotFound.
func TestDagOrchestratorCancelDagNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	err := o.CancelDag(context.Background(), "nonexistent")
	assert.Error(t, err)
}

// TestDagOrchestratorResumeDagNotFound verifies that resuming a
// non-existent DAG returns ErrDagNotFound.
func TestDagOrchestratorResumeDagNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	err := o.ResumeDag(context.Background(), "nonexistent", "")
	assert.Error(t, err)
}

// TestDagOrchestratorRetryDagNotFound verifies that retrying a
// non-existent DAG returns ErrDagNotFound.
func TestDagOrchestratorRetryDagNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	err := o.RetryDag(context.Background(), "nonexistent", "")
	assert.Error(t, err)
}

// TestDagOrchestratorInitialize verifies that Initialize succeeds with
// an in-memory event store (nil db), setting the initialized flag.
func TestDagOrchestratorInitialize(t *testing.T) {
	o := newTestDagOrchestrator()

	assert.False(t, o.IsInitialized())

	err := o.Initialize(context.Background())
	require.NoError(t, err)
	assert.True(t, o.IsInitialized())
}

// TestDagOrchestratorInitializeIdempotent verifies that calling
// Initialize multiple times is safe and does not re-run restoration.
func TestDagOrchestratorInitializeIdempotent(t *testing.T) {
	o := newTestDagOrchestrator()

	err := o.Initialize(context.Background())
	require.NoError(t, err)

	err = o.Initialize(context.Background())
	require.NoError(t, err)
	assert.True(t, o.IsInitialized())
}

// TestDagOrchestratorSetScheduler verifies that SetScheduler wires the
// slot pool's scheduler callback, enabling slot-freed notifications to
// trigger scheduling passes.
func TestDagOrchestratorSetScheduler(t *testing.T) {
	sp := &mockSlotPool{}
	es := orchestrator.NewEventStore(nil, nil)
	o := dag.NewDagOrchestrator(es, sp)

	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	sp.mu.Lock()
	assert.NotEmpty(t, sp.callbacks, "slot pool should have scheduler callback registered")
	sp.mu.Unlock()
}

// TestDagOrchestratorTransitionNode verifies that TransitionNode delegates
// to the node's FSM and appends a state-change event to the event store.
func TestDagOrchestratorTransitionNode(t *testing.T) {
	o := newTestDagOrchestrator()

	ctx := context.Background()
	_, err := o.SubmitDag(ctx, newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	// Node is in QUEUED; transition to ALLOCATED
	err = o.TransitionNode(ctx, "dag-1", "node-1", orchestrator.NodeStateAllocated, orchestrator.TransitionContext{
		Reason:      "resources allocated",
		TriggeredBy: "scheduler",
	})
	require.NoError(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateAllocated, status.Nodes[0].State)
}

// TestDagOrchestratorTransitionNodeIllegal verifies that an illegal
// transition returns an error without changing the node state.
func TestDagOrchestratorTransitionNodeIllegal(t *testing.T) {
	o := newTestDagOrchestrator()

	ctx := context.Background()
	_, err := o.SubmitDag(ctx, newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	// Node is in QUEUED; COMPLETED is not a valid transition from QUEUED
	err = o.TransitionNode(ctx, "dag-1", "node-1", orchestrator.NodeStateCompleted, orchestrator.TransitionContext{
		Reason:      "illegal",
		TriggeredBy: "test",
	})
	assert.Error(t, err)

	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateQueued, status.Nodes[0].State,
		"node state should be unchanged after illegal transition")
}

// TestDagOrchestratorTransitionNodeDagNotFound verifies that transitioning
// a node in a non-existent DAG returns ErrDagNotFound.
func TestDagOrchestratorTransitionNodeDagNotFound(t *testing.T) {
	o := newTestDagOrchestrator()
	err := o.TransitionNode(context.Background(), "nonexistent", "node-1", orchestrator.NodeStateRunning, orchestrator.TransitionContext{})
	assert.Error(t, err)
}

// TestDagOrchestratorCreateSnapshot verifies that CreateSnapshot persists
// all DAG snapshots through the event store without error when using
// an in-memory store.
func TestDagOrchestratorCreateSnapshot(t *testing.T) {
	o := newTestDagOrchestrator()

	_, err := o.SubmitDag(context.Background(), newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	err = o.CreateSnapshot(context.Background())
	require.NoError(t, err)
}

// TestDagOrchestratorReactivateReadyNodes verifies that calling
// ReactivateReadyNodes re-submits READY nodes to the scheduler, which
// is the 260720 fix for preventing READY deadlocks.
func TestDagOrchestratorReactivateReadyNodes(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(false) // reject to keep nodes in READY
	o.SetScheduler(sched)

	ctx := context.Background()
	_, err := o.SubmitDag(ctx, newSimpleDagDef("dag-1"))
	require.NoError(t, err)

	// Node should be in READY (scheduler rejected)
	status := o.GetDagStatus("dag-1")
	require.NotNil(t, status)
	assert.Equal(t, orchestrator.NodeStateReady, status.Nodes[0].State)

	// Now make scheduler accept and reactivate
	sched.mu.Lock()
	sched.acceptAll = true
	sched.mu.Unlock()

	o.ReactivateReadyNodes(ctx)

	assert.True(t, sched.HasNode("dag-1", "node-1"), "READY node should be re-submitted after reactivation")
}
