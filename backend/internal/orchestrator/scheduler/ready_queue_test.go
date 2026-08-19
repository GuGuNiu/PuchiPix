package scheduler

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator/slot"
)

func makeNode(dagID, nodeID string, priority int, submittedAt time.Time) SchedulableNodeAdapter {
	return SchedulableNodeAdapter{
		NodeID:      nodeID,
		DagID:       dagID,
		TaskType:    "gallery",
		Priority:    priority,
		SubmittedAt: submittedAt,
		ResourceRequirements: []slot.ResourceRequirement{
			{SlotType: "scraping", Count: 1},
		},
	}
}

func fitsAll(SchedulableNodeAdapter) bool { return true }

// TestReadyQueuePriorityOrder verifies PopBest returns nodes in
// priority-descending order regardless of insertion order.
func TestReadyQueuePriorityOrder(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()
	q.Push(makeNode("d", "low", 3, now))
	q.Push(makeNode("d", "critical", 10, now))
	q.Push(makeNode("d", "normal", 5, now))
	q.Push(makeNode("d", "high", 8, now))

	var order []string
	for {
		n := q.PopBest(fitsAll)
		if n == nil {
			break
		}
		order = append(order, n.NodeID)
	}
	assert.Equal(t, []string{"critical", "high", "normal", "low"}, order)
}

// TestReadyQueueFIFOWithinPriority verifies that within the same
// priority band, earlier submissions pop first (stable FIFO).
func TestReadyQueueFIFOWithinPriority(t *testing.T) {
	q := NewReadyQueue()
	base := time.Now()
	q.Push(makeNode("d", "third", 5, base.Add(2*time.Second)))
	q.Push(makeNode("d", "first", 5, base))
	q.Push(makeNode("d", "second", 5, base.Add(time.Second)))

	var order []string
	for {
		n := q.PopBest(fitsAll)
		if n == nil {
			break
		}
		order = append(order, n.NodeID)
	}
	assert.Equal(t, []string{"first", "second", "third"}, order)
}

// TestReadyQueuePopBestSkipsUnfitting verifies that PopBest skips nodes
// whose slots don't fit and restores them for later passes.
func TestReadyQueuePopBestSkipsUnfitting(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()
	q.Push(makeNode("d", "big", 10, now)) // needs 5 scraping slots
	q.index[queueKeyOf("d", "big")].node.ResourceRequirements = []slot.ResourceRequirement{{SlotType: "scraping", Count: 5}}
	q.Push(makeNode("d", "small", 1, now))

	fitsOnlySmall := func(n SchedulableNodeAdapter) bool {
		for _, r := range n.ResourceRequirements {
			if r.Count > 1 {
				return false
			}
		}
		return true
	}

	n := q.PopBest(fitsOnlySmall)
	require.NotNil(t, n)
	assert.Equal(t, "small", n.NodeID, "should skip unfitting high-priority node")
	assert.True(t, q.Has("d", "big"), "skipped node must remain queued")
}

// TestReadyQueueDuplicateRejected verifies pushing the same node twice
// is a no-op returning false.
func TestReadyQueueDuplicateRejected(t *testing.T) {
	q := NewReadyQueue()
	assert.True(t, q.Push(makeNode("d", "n1", 5, time.Now())))
	assert.False(t, q.Push(makeNode("d", "n1", 5, time.Now())))
	assert.Equal(t, 1, q.Len())
}

// TestReadyQueueStarvationPromotion verifies the lottery promotion moves
// the oldest starving LOW node ahead of fresher LOW peers.
func TestReadyQueueStarvationPromotion(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()
	old := now.Add(-31 * time.Minute)
	q.Push(makeNode("d", "old-low", 3, old))
	q.Push(makeNode("d", "new-low", 3, now))

	promoted := q.PromoteOldestLowPriority(3, 30*time.Minute, now)
	assert.True(t, promoted)

	n := q.PopBest(fitsAll)
	require.NotNil(t, n)
	assert.Equal(t, "old-low", n.NodeID)
}

// TestReadyQueueStarvationPromotionNoStarving verifies no promotion when
// every LOW node is younger than the threshold.
func TestReadyQueueStarvationPromotionNoStarving(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()
	q.Push(makeNode("d", "young-low", 3, now.Add(-time.Minute)))
	assert.False(t, q.PromoteOldestLowPriority(3, 30*time.Minute, now))
}

// TestReadyQueueConcurrentAccess hammers the queue with mixed
// Push/PopBest/Remove/Has from many goroutines; run with -race.
func TestReadyQueueConcurrentAccess(t *testing.T) {
	q := NewReadyQueue()
	const workers = 100
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			node := makeNode("d", fmt.Sprintf("n-%d", w), w%10+1, time.Now())
			q.Push(node)
			q.Has("d", fmt.Sprintf("n-%d", w))
			if w%3 == 0 {
				q.PopBest(fitsAll)
			} else {
				q.Remove("d", fmt.Sprintf("n-%d", w))
			}
			q.Len()
			q.CountBySlotType("scraping")
			q.Snapshot()
		}(w)
	}
	wg.Wait()
	// Drain whatever remains; must not deadlock or panic.
	for q.PopBest(fitsAll) != nil {
	}
}

// TestReadyQueueUpdatePriority verifies that a queued node's priority
// can be changed at runtime and that the heap reorders immediately.
func TestReadyQueueUpdatePriority(t *testing.T) {
	q := NewReadyQueue()
	now := time.Now()
	q.Push(makeNode("d", "a", 3, now))
	q.Push(makeNode("d", "b", 5, now))
	q.Push(makeNode("d", "c", 10, now))

	// Promote "a" (LOW=3) above everything.
	require.True(t, q.UpdatePriority("d", "a", 10))

	var order []string
	for {
		n := q.PopBest(fitsAll)
		if n == nil {
			break
		}
		order = append(order, n.NodeID)
	}
	assert.Equal(t, []string{"a", "c", "b"}, order)
}

// TestReadyQueueUpdatePriorityNotQueued verifies updating a node that
// is not in the queue is a safe no-op returning false.
func TestReadyQueueUpdatePriorityNotQueued(t *testing.T) {
	q := NewReadyQueue()
	q.Push(makeNode("d", "a", 5, time.Now()))
	require.False(t, q.UpdatePriority("d", "missing", 10))
	require.False(t, q.UpdatePriority("other-dag", "a", 10))
	// Original node still pops normally.
	n := q.PopBest(fitsAll)
	require.NotNil(t, n)
	assert.Equal(t, "a", n.NodeID)
}
