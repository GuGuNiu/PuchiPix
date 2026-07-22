package dagclient

// NodeStateI18nKey returns the i18n key for a node state, mirroring
// the TypeScript getNodeStateI18nKey function.
func NodeStateI18nKey(state NodeState) string {
	switch state {
	case NodeStatePending:
		return "dag.nodeState.pending"
	case NodeStateReady:
		return "dag.nodeState.ready"
	case NodeStateQueued:
		return "dag.nodeState.queued"
	case NodeStateAllocated:
		return "dag.nodeState.allocated"
	case NodeStateRunning:
		return "dag.nodeState.running"
	case NodeStatePaused:
		return "dag.nodeState.paused"
	case NodeStateVerifying:
		return "dag.nodeState.verifying"
	case NodeStateResumeVerify:
		return "dag.nodeState.resumeVerify"
	case NodeStateCompleted:
		return "dag.nodeState.completed"
	case NodeStateFailed:
		return "dag.nodeState.failed"
	case NodeStateCancelled:
		return "dag.nodeState.cancelled"
	case NodeStateTimeout:
		return "dag.nodeState.timeout"
	case NodeStateNeedsRetry:
		return "dag.nodeState.needsRetry"
	default:
		return "dag.nodeState.pending"
	}
}
