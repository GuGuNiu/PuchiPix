package orchestrator

// StatusReporter maps DAG node states back to entity-table statuses
// (download_tasks / galleries / sniff_tasks).
//
// Only nodes that actually won a scheduler slot report an in-progress
// label:
//   - QUEUED / ALLOCATED / RUNNING map to the active status for the node's
//     phase (scraping / downloading / sniffing).
//   - PENDING / READY map to "pending", so a queue-full rejection reads as
//     waiting instead of as if work had already started.
//   - Terminal states map to completed / failed / cancelled / paused.
//
// Video M3U8 identification occupies the scraping slot and reports
// "scraping", while the download phase reports "downloading".
type StatusReporter struct{}

// MapNodeToEntityStatus converts a node's FSM state into the entity
// table status string. ok=false means "no DB write" (states that do
// not map to a user-visible entity status, e.g. intermediate
// verifying / needs_retry which are internal to the DAG layer).
func (r *StatusReporter) MapNodeToEntityStatus(def DagNodeDefinition, state NodeState) (string, bool) {
	switch state {
	case NodeStateQueued, NodeStateAllocated, NodeStateRunning:
		// Post-processing nodes (extract/verify — PhaseFinalize) never drive
		// the entity status for in-progress states: the download executor
		// has already written the terminal outcome by then, so a
		// QUEUED/RUNNING write here would regress it back to "downloading"
		// and pin the task at 100% while still reported as running.
		if def.Phase == PhaseFinalize {
			return "", false
		}
		return r.inProgressStatus(def), true
	case NodeStateReady, NodeStatePending:
		// READY means the scheduler rejected the node (queue full) or it was
		// paused and resumed, so it is waiting for capacity. Finalize nodes
		// are excluded for the same regression reason as above: a rolled-back
		// extract must not flip completed back to pending.
		if def.Phase == PhaseFinalize {
			return "", false
		}
		return "pending", true
	case NodeStatePaused:
		return "paused", true
	case NodeStateCompleted:
		return "completed", true
	case NodeStateFailed, NodeStateTimeout:
		// Non-critical failures (e.g. gallery extract) must not regress the
		// entity: the download executor already recorded the real outcome,
		// and a non-critical post-processing failure does not change it.
		if def.NonCritical {
			return "", false
		}
		return "failed", true
	case NodeStateNeedsRetry:
		return "failed", true
	case NodeStateCancelled:
		return "cancelled", true
	default:
		return "", false
	}
}

// inProgressStatus derives the entity status label for an actively
// running / queued node from its executor key and phase:
//   - scrape / video:scrape / phase=scrape → "scraping"
//   - download / video:download / phase=download → "downloading"
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

func NewStatusReporter() *StatusReporter {
	return &StatusReporter{}
}
