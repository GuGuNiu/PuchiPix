package dag_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator"
	"backend/internal/orchestrator/dag"
)

// TestVideoPipelineFailureCascadesToDownload verifies the 260821
// failure-cascade fix: when the video:scrape node fails critically, the
// dependent video:download node must be failed in place (not activated),
// so the DAG converges to a terminal state and the entity status syncs
// to "failed". Previously the failed scrape node still activated the
// download node, which re-identified the M3U8 URL, failed again, and
// left download_tasks.status stuck at "downloading".
func TestVideoPipelineFailureCascadesToDownload(t *testing.T) {
	o := newTestDagOrchestrator()
	sched := newMockScheduler(true)
	o.SetScheduler(sched)

	def := dag.NewDagFactory().NewVideoPipeline(42)
	dagID, err := o.SubmitDag(context.Background(), def)
	require.NoError(t, err)

	// Drive vsc-42 to RUNNING so OnNodeCompleted's failure branch applies.
	ctx := context.Background()
	require.NoError(t, o.TransitionNode(ctx, dagID, "vsc-42",
		orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "vsc-42",
		orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"}))

	// vdl-42 must NOT have been queued by the scrape node's activation.
	// (The pipeline DAG submits only the initial node at SubmitDag.)
	status := o.GetDagStatus(dagID)
	require.NotNil(t, status)
	vdlState := ""
	for _, n := range status.Nodes {
		if n.NodeID == "vdl-42" {
			vdlState = string(n.State)
		}
	}
	assert.Equal(t, string(orchestrator.NodeStatePending), vdlState,
		"vdl should still be PENDING before the scrape node completes")

	// Fail the scrape node.
	require.NoError(t, o.OnNodeCompleted(ctx, dagID, "vsc-42",
		orchestrator.NodeExecutionResult{Success: false, Error: &orchestrator.NodeError{
			Code: "EXECUTION_FAILED", Message: "no M3U8 URL found",
		}}))

	// The download node must be cascaded to FAILED, and the DAG must
	// have converged (all nodes terminal).
	status = o.GetDagStatus(dagID)
	require.NotNil(t, status)
	seenVdl := false
	for _, n := range status.Nodes {
		if n.NodeID == "vdl-42" {
			seenVdl = true
			assert.Equal(t, orchestrator.NodeStateFailed, n.State,
				"vdl must be cascaded to FAILED after vsc fails")
		}
	}
	assert.True(t, seenVdl, "vdl-42 node must exist in DAG status")
}

// TestVideoPipelineSuccessActivatesDownload verifies the happy path: a
// completed video:scrape node activates the video:download node (QUEUED),
// which is the prerequisite for the "scraping → downloading" status flow.
func TestVideoPipelineSuccessActivatesDownload(t *testing.T) {
	o := newTestDagOrchestrator()
	o.SetScheduler(newMockScheduler(true))

	def := dag.NewDagFactory().NewVideoPipeline(7)
	dagID, err := o.SubmitDag(context.Background(), def)
	require.NoError(t, err)

	ctx := context.Background()
	require.NoError(t, o.TransitionNode(ctx, dagID, "vsc-7",
		orchestrator.NodeStateAllocated, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "vsc-7",
		orchestrator.NodeStateRunning, orchestrator.TransitionContext{Reason: "test", TriggeredBy: "test"}))
	require.NoError(t, o.TransitionNode(ctx, dagID, "vsc-7",
		orchestrator.NodeStateCompleted, orchestrator.TransitionContext{Reason: "done", TriggeredBy: "system"}))

	require.NoError(t, o.OnNodeCompleted(ctx, dagID, "vsc-7",
		orchestrator.NodeExecutionResult{Success: true}))

	status := o.GetDagStatus(dagID)
	require.NotNil(t, status)
	for _, n := range status.Nodes {
		if n.NodeID == "vdl-7" {
			assert.Equal(t, orchestrator.NodeStateQueued, n.State,
				"vdl must be queued after vsc completes")
		}
	}
}
