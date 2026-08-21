package orchestrator

// StatusReporter maps DAG node states back to entity-table statuses
// (download_tasks / galleries / sniff_tasks), closing the "DB status vs
// real scheduling state" gap that made every submitted task look like
// it was actively identifying ("scraping") even when the scheduler had
// rejected it (queue full) and rolled it back to READY.
//
// Design rule (restored from the 260717 slot-unification design):
//   - 运行中/已入队 (QUEUED/ALLOCATED/RUNNING) → 进行中状态
//     (scraping / downloading / sniffing) —— 只有真正获得调度资格
//     的节点才显示为进行中
//   - 等待调度/被压住 (PENDING/READY) → "pending"（等待中）——
//     队列满被拒的任务如实显示为等待，而不是假的"识别中"
//   - 终态 → completed / failed / cancelled / paused
//
// The phase / executor of the node determines WHICH in-progress label
// applies: video M3U8 identification occupies the scraping slot and
// reports "scraping"; the download phase reports "downloading".
type StatusReporter struct{}

// MapNodeToEntityStatus converts a node's FSM state into the entity
// table status string. ok=false means "no DB write" (states that do
// not map to a user-visible entity status, e.g. intermediate
// verifying / needs_retry which are internal to the DAG layer).
func (r *StatusReporter) MapNodeToEntityStatus(def DagNodeDefinition, state NodeState) (string, bool) {
	switch state {
	case NodeStateQueued, NodeStateAllocated, NodeStateRunning:
		return r.inProgressStatus(def), true
	case NodeStateReady, NodeStatePending:
		// READY = rejected by the scheduler (queue full) or paused-and-
		// resumed; the node is waiting for capacity. Report "pending".
		return "pending", true
	case NodeStatePaused:
		return "paused", true
	case NodeStateCompleted:
		return "completed", true
	case NodeStateFailed, NodeStateTimeout, NodeStateNeedsRetry:
		return "failed", true
	case NodeStateCancelled:
		return "cancelled", true
	default:
		// verifying / resume_verify / internal states: no entity write.
		return "", false
	}
}

// inProgressStatus derives the entity status label for an actively
// running / queued node from its executor key and phase:
//   - scrape / video:scrape / phase=scrape → "scraping" (识别中)
//   - download / video:download / phase=download → "downloading" (下载中)
//   - sniff / phase=scrape with sniffId → "sniffing"
//   - extract/verify (slotless CPU/IO) → keep the previous phase label
func (r *StatusReporter) inProgressStatus(def DagNodeDefinition) string {
	switch def.Executor {
	case "scrape", "video:scrape":
		return "scraping"
	case "download", "video:download":
		return "downloading"
	case "sniff":
		return "sniffing"
	}
	// Fall back on phase for executors without a dedicated slot type.
	switch def.Phase {
	case PhaseScrape:
		return "scraping"
	case PhaseDownload:
		return "downloading"
	case PhaseFinalize, PhaseCreate:
		// extract / verify are post-download steps; keep the download
		// label so the frontend shows the task as still in progress
		// rather than dropping it back to a waiting state.
		return "downloading"
	default:
		return "pending"
	}
}

// NewStatusReporter returns a shared StatusReporter (stateless).
func NewStatusReporter() *StatusReporter {
	return &StatusReporter{}
}
