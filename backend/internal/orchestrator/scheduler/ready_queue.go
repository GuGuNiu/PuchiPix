package scheduler

import (
	"container/heap"
	"sync"
	"time"
)

// readyItem is a single entry in the priority ready queue. The ordering
// is: priority desc -> dagDispatchCount asc -> submittedAt asc -> seq
// asc (FIFO within the same priority and submission instant, preventing
// comparison instability).
//
// dagDispatchCount provides cross-DAG fairness: when multiple DAGs
// have nodes at the same priority level, the queue alternates between
// them rather than dispatching all nodes from one DAG consecutively.
// The count is sourced from the ReadyQueue's per-DAG dispatch tracker
// at Push time and does not change while the item is queued.
type readyItem struct {
	node              SchedulableNodeAdapter
	priority          int
	dagDispatchCount  int
	submittedAt       time.Time
	seq               uint64
	heapIndex         int
}

// readyItemHeap implements heap.Interface as a max-priority queue.
type readyItemHeap []*readyItem

func (h readyItemHeap) Len() int { return len(h) }

func (h readyItemHeap) Less(i, j int) bool {
	a, b := h[i], h[j]
	if a.priority != b.priority {
		return a.priority > b.priority // higher priority first
	}
	// Cross-DAG fairness: among same-priority nodes, prefer the DAG
	// that has been dispatched less recently. This prevents one DAG's
	// batch of same-priority nodes from monopolizing the scheduler.
	if a.dagDispatchCount != b.dagDispatchCount {
		return a.dagDispatchCount < b.dagDispatchCount
	}
	if !a.submittedAt.Equal(b.submittedAt) {
		return a.submittedAt.Before(b.submittedAt) // earlier submission first
	}
	return a.seq < b.seq // stable tie-break
}

func (h readyItemHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].heapIndex = i
	h[j].heapIndex = j
}

func (h *readyItemHeap) Push(x any) {
	item := x.(*readyItem)
	item.heapIndex = len(*h)
	*h = append(*h, item)
}

func (h *readyItemHeap) Pop() any {
	old := *h
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.heapIndex = -1
	*h = old[:n-1]
	return item
}

// ReadyQueue is a concurrent-safe priority queue for schedulable nodes,
// replacing the previous map + O(n) SelectNext scan with O(log n)
// push/pop. The starvation-lottery promotion scans the index only when
// the lottery fires, keeping the common path allocation-free.
//
// Cross-DAG fairness: a dagDispatch map tracks how many nodes from
// each DAG have been dispatched (popped) recently. When a node is
// pushed, its dagDispatchCount is set to the DAG's current count so
// the heap ordering alternates among same-priority DAGs. The count
// is bumped on PopBest and reset when a DAG has no queued nodes left,
// preventing stale counts from penalizing re-submissions.
type ReadyQueue struct {
	mu            sync.Mutex
	h             readyItemHeap
	index         map[string]*readyItem // key: dagID + ":" + nodeID
	seq           uint64
	dagDispatch   map[string]int       // dagID -> cumulative dispatch count
}

// NewReadyQueue creates an empty ready queue.
func NewReadyQueue() *ReadyQueue {
	q := &ReadyQueue{
		index:       make(map[string]*readyItem),
		dagDispatch: make(map[string]int),
	}
	heap.Init(&q.h)
	return q
}

func queueKeyOf(dagID, nodeID string) string { return dagID + ":" + nodeID }

// Push inserts a node. Returns false if the node is already queued.
func (q *ReadyQueue) Push(node SchedulableNodeAdapter) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	key := queueKeyOf(node.DagID, node.NodeID)
	if _, exists := q.index[key]; exists {
		return false
	}
	q.seq++
	item := &readyItem{
		node:              node,
		priority:          node.Priority,
		dagDispatchCount:  q.dagDispatch[node.DagID],
		submittedAt:       node.SubmittedAt,
		seq:               q.seq,
	}
	heap.Push(&q.h, item)
	q.index[key] = item
	return true
}

// PopBest atomically removes and returns the highest-priority item whose
// resource requirements fit the available slots, or nil if none fit.
// Non-fitting items are temporarily set aside and restored before
// returning, so heap order is preserved. Selection + removal is a single
// locked operation, which keeps the engine's acquire-then-dispatch flow
// race-free without a separate Remove call.
//
// On successful dispatch, the DAG's dispatch count is bumped so the
// next same-priority node from a different DAG wins the fairness
// tie-break. When a DAG has no more queued nodes after a pop, its
// dispatch count is reset to prevent stale accumulation.
func (q *ReadyQueue) PopBest(fits func(SchedulableNodeAdapter) bool) *SchedulableNodeAdapter {
	q.mu.Lock()
	defer q.mu.Unlock()

	var skipped []*readyItem
	restore := func() {
		for _, item := range skipped {
			heap.Push(&q.h, item)
		}
	}

	for q.h.Len() > 0 {
		item := heap.Pop(&q.h).(*readyItem)
		if fits(item.node) {
			restore()
			delete(q.index, queueKeyOf(item.node.DagID, item.node.NodeID))
			// Bump the DAG's dispatch count for cross-DAG fairness.
			q.dagDispatch[item.node.DagID]++
			// If the DAG has no more queued nodes, reset its count so
			// future re-submissions are not penalized by stale history.
			q.cleanupDagDispatchIfEmpty(item.node.DagID)
			node := item.node
			return &node
		}
		skipped = append(skipped, item)
	}
	restore()
	return nil
}

// UpdatePriority dynamically re-prioritizes a queued node, restoring
// heap order via heap.Fix at the item's current index. Returns false
// when the node is not queued (callers should treat it as a no-op).
// This backs the dynamic priority adjustment feature: a node's priority
// is no longer frozen at submission time.
func (q *ReadyQueue) UpdatePriority(dagID, nodeID string, newPriority int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	item, exists := q.index[queueKeyOf(dagID, nodeID)]
	if !exists {
		return false
	}
	item.priority = newPriority
	item.node.Priority = newPriority
	heap.Fix(&q.h, item.heapIndex)
	return true
}

// Remove deletes a node from the queue. Returns true if it was present.
func (q *ReadyQueue) Remove(dagID, nodeID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	key := queueKeyOf(dagID, nodeID)
	item, exists := q.index[key]
	if !exists {
		return false
	}
	heap.Remove(&q.h, item.heapIndex)
	delete(q.index, key)
	// Clean up dagDispatch if this was the last queued node for the DAG.
	q.cleanupDagDispatchIfEmpty(dagID)
	return true
}

// Has reports whether a node is currently queued.
func (q *ReadyQueue) Has(dagID, nodeID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, exists := q.index[queueKeyOf(dagID, nodeID)]
	return exists
}

// Len returns the number of queued nodes.
func (q *ReadyQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.index)
}

// CountBySlotType counts queued nodes that require the given slot type.
// This preserves the queue-capacity accounting semantics of the previous
// map-based implementation (a node with multiple requirements counts
// once per relevant type... matching the old getQueuedCountBySlotTypeLocked
// behavior of counting the node under each type it requires).
func (q *ReadyQueue) CountBySlotType(slotType string) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	count := 0
	for _, item := range q.index {
		for _, req := range item.node.ResourceRequirements {
			if req.SlotType == slotType {
				count++
				break
			}
		}
	}
	return count
}

// PromoteOldestLowPriority implements the starvation lottery: when the
// lottery fires, the oldest item at `lowPriority` waiting longer than
// `olderThan` is re-prioritized by moving its effective submission time
// to the distant past, which sorts it ahead of same-priority items (and
// below any higher priority). Returns true if a promotion happened.
// O(k) over the index, only on lottery hits.
func (q *ReadyQueue) PromoteOldestLowPriority(lowPriority int, olderThan time.Duration, now time.Time) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	var oldest *readyItem
	for _, item := range q.index {
		if item.node.Priority != lowPriority {
			continue
		}
		if now.Sub(item.submittedAt) < olderThan {
			continue
		}
		if oldest == nil || item.submittedAt.Before(oldest.submittedAt) {
			oldest = item
		}
	}
	if oldest == nil {
		return false
	}
	// Move the item's effective submission time to the distant past so
	// it wins the FIFO tie-break within its priority band. The heap is
	// re-established via Fix at the item's current index.
	oldest.submittedAt = time.Unix(0, 0)
	heap.Fix(&q.h, oldest.heapIndex)
	return true
}

// Snapshot returns a copy of all queued nodes for stats reporting.
func (q *ReadyQueue) Snapshot() []SchedulableNodeAdapter {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]SchedulableNodeAdapter, 0, len(q.index))
	for _, item := range q.index {
		out = append(out, item.node)
	}
	return out
}

// cleanupDagDispatchIfEmpty checks whether the given DAG still has
// queued nodes; if not, its entry in dagDispatch is deleted so future
// re-submissions start with a fresh count. Caller must hold q.mu.
func (q *ReadyQueue) cleanupDagDispatchIfEmpty(dagID string) {
	for key := range q.index {
		if key[:len(dagID)+1] == dagID+":" {
			return // still has queued nodes
		}
	}
	delete(q.dagDispatch, dagID)
}
