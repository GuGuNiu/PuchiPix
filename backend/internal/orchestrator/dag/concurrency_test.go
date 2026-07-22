package dag_test

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
)

// TestDagOrchestratorConcurrentDags stresses per-DAG lock splitting:
// many DAGs are submitted, completed, paused, and queried concurrently.
// With the old single global mutex this would serialize (and risk
// deadlocks); with per-DAG locks it must stay race-free. Run with -race.
func TestDagOrchestratorConcurrentDags(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)
	ctx := context.Background()

	const dagCount = 20
	var wg sync.WaitGroup
	for i := 0; i < dagCount; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			dagID := fmt.Sprintf("dag-conc-%d", i)
			if _, err := o.SubmitDag(ctx, buildChainDagDef(dagID, 4)); err != nil {
				t.Errorf("submit %s: %v", dagID, err)
				return
			}
			completeNode(t, o, dagID, "node-0")
			if err := o.OnNodeCompleted(ctx, dagID, "node-0", orchestrator.NodeExecutionResult{Success: true}); err != nil {
				t.Errorf("complete %s: %v", dagID, err)
			}
			_ = o.GetDagStatus(dagID)
			_ = o.GetStats()
			if i%2 == 0 {
				_ = o.PauseDag(ctx, dagID)
				_ = o.ResumeDag(ctx, dagID, "")
			}
			_ = o.GetAllDagSnapshots()
		}(i)
	}
	wg.Wait()

	stats := o.GetStats()
	assert.Equal(t, dagCount, stats.TotalDags)
}

// TestDagOrchestratorConcurrentNodesSameDag hammers transitions and
// completions on nodes of the SAME dag, exercising dag.mu contention.
func TestDagOrchestratorConcurrentNodesSameDag(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)
	ctx := context.Background()

	const leaves = 30
	_, err := o.SubmitDag(ctx, buildFanOutDagDef("dag-shared", leaves))
	require.NoError(t, err)

	completeNode(t, o, "dag-shared", "root")
	require.NoError(t, o.OnNodeCompleted(ctx, "dag-shared", "root", orchestrator.NodeExecutionResult{Success: true}))

	var wg sync.WaitGroup
	for i := 1; i < leaves; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			nodeID := fmt.Sprintf("leaf-%d", i)
			completeNode(t, o, "dag-shared", nodeID)
			_ = o.OnNodeCompleted(ctx, "dag-shared", nodeID, orchestrator.NodeExecutionResult{Success: true})
		}(i)
	}
	wg.Wait()

	status := o.GetDagStatus("dag-shared")
	require.NotNil(t, status)
	completed := 0
	for _, ns := range status.Nodes {
		if ns.State == orchestrator.NodeStateCompleted {
			completed++
		}
	}
	assert.Equal(t, leaves, completed, "all nodes should complete")
}

// TestEventStoreAsyncSeqOrdering verifies that events written through
// AppendAsync receive strictly increasing sequence numbers in
// submission order once flushed.
func TestEventStoreAsyncSeqOrdering(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	es.StartAsyncWriter()
	ctx := context.Background()

	const events = 200
	for i := 0; i < events; i++ {
		require.NoError(t, es.AppendAsync(ctx, orchestrator.DagEvent{
			Type:  "dag:test",
			DagID: "dag-seq",
			Payload: map[string]any{
				"i": i,
			},
		}))
	}
	es.Flush()

	replayed, err := es.Replay(ctx, 0, "dag-seq")
	require.NoError(t, err)
	require.Len(t, replayed, events)
	for i := 1; i < len(replayed); i++ {
		assert.Greater(t, replayed[i].Seq, replayed[i-1].Seq,
			"seq must be strictly increasing at position %d", i)
	}
}

// TestEventStoreAsyncFallbackWithoutWriter verifies AppendAsync degrades
// to synchronous writes when the async writer was never started.
func TestEventStoreAsyncFallbackWithoutWriter(t *testing.T) {
	es := orchestrator.NewEventStore(nil, nil)
	require.NoError(t, es.AppendAsync(context.Background(), orchestrator.DagEvent{
		Type:  "dag:test",
		DagID: "dag-sync",
	}))
	replayed, err := es.Replay(context.Background(), 0, "dag-sync")
	require.NoError(t, err)
	assert.Len(t, replayed, 1)
}
