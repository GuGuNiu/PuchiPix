package scheduler

import (
	"container/heap"
	"sync"
	"time"
)

// readyItem is a single entry in the priority ready queue. The ordering
// is: priority desc -> submittedAt asc -> seq asc (FIFO within the same
// priority and submission instant, preventing comparison instability).
type readyItem struct {
	node        SchedulableNodeAdapter
	priority    int
	submittedAt time.Time
	seq         uint64
	heapIndex   int
}

// readyItemHeap implements heap.Interface as a max-priority queue.
type readyItemHeap []*readyItem

func (h readyItemHeap) Len() int { return len(h) }

func (h readyItemHeap) Less(i, j int) bool {
	a, b := h[i], h[j]
	if a.priority != b.priority {
		return a.priority > b.priority // higher priority first
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
type ReadyQueue struct {
	mu    sync.Mutex
	h     readyItemHeap
	index map[string]*readyItem // key: dagID + ":" + nodeID
	seq   uint64
}

// NewReadyQueue creates an empty ready queue.
func NewReadyQueue() *ReadyQueue {
	q := &ReadyQueue{index: make(map[string]*readyItem)}
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
		node:        node,
		priority:    node.Priority,
		submittedAt: node.SubmittedAt,
		seq:         q.seq,
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
			node := item.node
			return &node
		}
		skipped = append(skipped, item)
	}
	restore()
	return nil
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
