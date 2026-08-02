package scheduler

import (
	"context"
	"math/rand"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator/slot"
)

// Starvation-lottery tuning, mirroring the TypeScript scheduler: LOW
// priority nodes waiting longer than starvationThreshold get a
// starvationLotteryRate chance of promotion per scheduling pass.
const (
	starvationThreshold   = 30 * time.Minute
	starvationLotteryRate = 0.1
	lowPriorityValue      = 3 // PriorityLow
)

// SchedulingStrategy is the interface for selecting the next node
// from the ready queue given current slot availability.
type SchedulingStrategy interface {
	Name() string
	SelectNext(nodes []SchedulableNodeEntry, slots map[string]slot.SlotUsage) *SchedulableNodeEntry
}

// SchedulableNodeEntry wraps SchedulableNode with a queue key for
// efficient removal from the ready queue.
type SchedulableNodeEntry struct {
	orchestratorNode SchedulableNodeAdapter
	QueueKey         string
}

// SchedulableNodeAdapter is a lightweight adapter that the scheduler
// uses to avoid importing orchestrator directly.
type SchedulableNodeAdapter struct {
	NodeID               string
	DagID                string
	TaskType             string
	Phase                string
	ExecutorKey          string
	Priority             int
	ResourceRequirements []slot.ResourceRequirement
	Config               map[string]any
	SubmittedAt          time.Time
	// TimeoutMs is the per-node execution timeout in milliseconds
	// (0 disables enforcement). Sourced from DagNodeDefinition.Timeout.
	TimeoutMs            int
	// NonCritical marks a node whose failure should not cascade to its
	// dependents or cause the DAG to fail.
	NonCritical          bool
}

// PriorityFairStrategy selects the highest-priority node whose resource
// requirements can be satisfied by the current slot availability.
type PriorityFairStrategy struct{}

func (s *PriorityFairStrategy) Name() string { return "priority-fair" }

func (s *PriorityFairStrategy) SelectNext(nodes []SchedulableNodeEntry, slots map[string]slot.SlotUsage) *SchedulableNodeEntry {
	var best *SchedulableNodeEntry
	bestPriority := -1
	for i := range nodes {
		node := &nodes[i]
		canFit := true
		for _, req := range node.orchestratorNode.ResourceRequirements {
			usage, ok := slots[req.SlotType]
			if !ok || usage.Available < req.Count {
				canFit = false
				break
			}
		}
		if !canFit {
			continue
		}
		if node.orchestratorNode.Priority > bestPriority {
			bestPriority = node.orchestratorNode.Priority
			best = node
		}
	}
	return best
}

// SchedulerStats mirrors orchestrator.SchedulerStats for query responses.
type SchedulerStats struct {
	QueueSize  int
	ByPriority map[string]int
	ByTaskType map[string]int
	Strategy   string
}

// ExecutorFunc is the signature for node execution callbacks registered
// by the DAG orchestrator. The context carries the per-node timeout and
// drain cancellation; executors driving chromedp should derive their
// browser contexts from it so timeouts cancel in-flight browser work.
type ExecutorFunc func(ctx context.Context, node SchedulableNodeAdapter) (bool, error)

// SchedulerEngine is the central scheduling engine that accepts
// submitted nodes, selects them for execution based on the active
// strategy, acquires slot resources, and dispatches to executors.
type SchedulerEngine struct {
	mu                  sync.Mutex
	strategy            SchedulingStrategy
	readyQueue          *ReadyQueue
	dagOrchestrator     DagOrchestratorInterface
	slotPool            *slot.SlotPool
	scheduling          bool
	logger              *infra.Logger
	executorFn          ExecutorFunc
	maxQueueSizePerSlot map[string]int
	scanTicker          *time.Ticker
	stopCh              chan struct{}
	// nowFunc is injectable for starvation-lottery tests.
	nowFunc func() time.Time
	// lotteryFunc is injectable; returns true when the starvation
	// lottery fires (default: 10% chance per scheduling pass).
	lotteryFunc func() bool

	// drain state (Stage 4 graceful shutdown)
	draining   bool
	runningWg  sync.WaitGroup
	nodeCancel map[string]context.CancelFunc // holderID -> cancel of running node ctx
}

// DagOrchestratorInterface is the contract the scheduler needs from
// the DAG orchestrator.
type DagOrchestratorInterface interface {
	TransitionNode(dagID, nodeID string, toState string, reason, triggeredBy string) error
	OnNodeCompleted(dagID, nodeID string, success bool, data map[string]any, errMsg string) error
	ReactivateReadyNodes()
	GetNodeForVerification(dagID, nodeID string) interface{}
}

// NewSchedulerEngine creates a scheduler with the given slot pool.
func NewSchedulerEngine(sp *slot.SlotPool) *SchedulerEngine {
	return &SchedulerEngine{
		strategy:   &PriorityFairStrategy{},
		readyQueue: NewReadyQueue(),
		slotPool:   sp,
		logger:     infra.NewLogger("Scheduler"),
		maxQueueSizePerSlot: map[string]int{
			"scraping": 5,
			"download": 5,
			"sniff":    1,
		},
		stopCh:      make(chan struct{}),
		nowFunc:     time.Now,
		lotteryFunc: func() bool { return rand.Float64() < starvationLotteryRate },
		nodeCancel:  make(map[string]context.CancelFunc),
	}
}

// SetDagOrchestrator connects the orchestrator for transition callbacks.
func (s *SchedulerEngine) SetDagOrchestrator(orch DagOrchestratorInterface) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dagOrchestrator = orch
}

// SetExecutorFunc installs the callback used to dispatch node execution.
func (s *SchedulerEngine) SetExecutorFunc(fn ExecutorFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.executorFn = fn
}

// SyncQueueCapacityFromSlotPool aligns queue size limits with the
// slot pool's max values.
func (s *SchedulerEngine) SyncQueueCapacityFromSlotPool() {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot := s.slotPool.GetSnapshot()
	for slotType, usage := range snapshot {
		s.maxQueueSizePerSlot[slotType] = usage.Max
	}
	s.logger.Info("Queue capacity synced")
}

// Submit adds a node to the ready queue if capacity allows, then
// triggers a scheduling pass. Returns false if the queue is full.
func (s *SchedulerEngine) Submit(node SchedulableNodeAdapter) bool {
	s.mu.Lock()
	if s.draining {
		s.mu.Unlock()
		s.logger.Warn("Scheduler draining, node rejected", "nodeId", node.NodeID, "dagId", node.DagID)
		return false
	}
	maxQueue := s.maxQueueSizePerSlot
	s.mu.Unlock()

	for _, req := range node.ResourceRequirements {
		maxSize, ok := maxQueue[req.SlotType]
		if !ok {
			continue
		}
		queuedCount := s.readyQueue.CountBySlotType(req.SlotType)
		if queuedCount >= maxSize {
			s.logger.Warn("Queue full, node rejected", "slotType", req.SlotType, "queued", queuedCount, "max", maxSize, "nodeId", node.NodeID, "dagId", node.DagID)
			return false
		}
	}

	if !s.readyQueue.Push(node) {
		s.logger.Warn("Node already queued", "nodeId", node.NodeID, "dagId", node.DagID)
		return false
	}

	s.logger.Info("Node enqueued", "nodeId", node.NodeID, "dagId", node.DagID, "priority", node.Priority, "queueSize", s.readyQueue.Len())
	s.Schedule()
	return true
}

// HasNode checks whether a node is in the ready queue.
func (s *SchedulerEngine) HasNode(dagID, nodeID string) bool {
	return s.readyQueue.Has(dagID, nodeID)
}

// CancelNode removes a node from the ready queue.
func (s *SchedulerEngine) CancelNode(dagID, nodeID string) {
	s.readyQueue.Remove(dagID, nodeID)
}

// UpdateNodePriority dynamically re-prioritizes a queued node. The
// ready queue is reordered immediately; nodes not currently queued
// are unaffected (the orchestrator persists the new priority for
// future submissions). Returns true when the node was queued and
// updated.
func (s *SchedulerEngine) UpdateNodePriority(dagID, nodeID string, newPriority int) bool {
	updated := s.readyQueue.UpdatePriority(dagID, nodeID, newPriority)
	if updated {
		s.logger.Info("Node priority updated", "nodeId", nodeID, "dagId", dagID, "priority", newPriority)
	}
	return updated
}

// SubmitWithDelay enqueues a node after the given delay without
// blocking the caller. This replaces blocking time.Sleep backoff in
// retry paths: the orchestrator returns immediately while the timer
// goroutine performs the delayed submission. Submit still applies
// drain checks and queue-capacity backpressure at fire time.
func (s *SchedulerEngine) SubmitWithDelay(node SchedulableNodeAdapter, delay time.Duration) {
	if delay <= 0 {
		s.Submit(node)
		return
	}
	time.AfterFunc(delay, func() {
		if !s.Submit(node) {
			// Submission rejected (e.g. draining or queue full); the
			// orchestrator's rollback-to-READY handles the state.
			s.logger.Warn("Delayed submit rejected", "nodeId", node.NodeID, "dagId", node.DagID, "delayMs", delay.Milliseconds())
		}
	})
}

// OnSlotFreed is called by the slot pool when a slot is released,
// triggering a scheduling pass to use the freed capacity.
func (s *SchedulerEngine) OnSlotFreed(slotType string) {
	s.Schedule()
}

// Schedule attempts to dispatch as many ready nodes as possible
// to executors, given current slot availability.
func (s *SchedulerEngine) Schedule() {
	s.mu.Lock()
	if s.scheduling {
		s.mu.Unlock()
		return
	}
	s.scheduling = true
	nowFunc := s.nowFunc
	lotteryFunc := s.lotteryFunc
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.scheduling = false
		s.mu.Unlock()
	}()

	// Starvation lottery: occasionally promote the oldest starving LOW
	// node so it can out-compete same-band peers on the FIFO tie-break.
	if lotteryFunc() {
		if s.readyQueue.PromoteOldestLowPriority(lowPriorityValue, starvationThreshold, nowFunc()) {
			s.logger.Info("Starvation lottery promoted a LOW priority node")
		}
	}

	// Take one slot snapshot per scheduling pass and maintain it locally
	// as nodes are dispatched, instead of re-locking the pool on every
	// iteration. Correctness is preserved: the pool's release callback
	// re-enters Schedule() (guarded by the scheduling flag), and
	// AcquireBatch remains the final arbiter — a stale fit simply loses
	// the race and the node is requeued for a later pass.
	slots := s.slotPool.GetSnapshot()
	consume := func(reqs []slot.ResourceRequirement) {
		for _, req := range reqs {
			u, ok := slots[req.SlotType]
			if !ok {
				continue
			}
			u.Current += req.Count
			u.Available -= req.Count
			slots[req.SlotType] = u
		}
	}

	for {
		if s.readyQueue.Len() == 0 {
			return
		}

		fits := func(node SchedulableNodeAdapter) bool {
			for _, req := range node.ResourceRequirements {
				usage, ok := slots[req.SlotType]
				if !ok || usage.Available < req.Count {
					return false
				}
			}
			return true
		}

		selected := s.readyQueue.PopBest(fits)
		if selected == nil {
			return
		}

		holderID := selected.DagID + ":" + selected.NodeID
		if !s.slotPool.AcquireBatch(selected.ResourceRequirements, holderID) {
			// Lost the slot race ??requeue so a later pass can retry.
			s.readyQueue.Push(*selected)
			return
		}
		consume(selected.ResourceRequirements)

		s.mu.Lock()
		executorFn := s.executorFn
		orch := s.dagOrchestrator
		s.mu.Unlock()

		if orch != nil {
			_ = orch.TransitionNode(
				selected.DagID,
				selected.NodeID,
				"allocated",
				"resources allocated",
				"scheduler",
			)
		}

		if executorFn != nil {
			entry := SchedulableNodeEntry{
				orchestratorNode: *selected,
				QueueKey:         holderID,
			}
			go s.executeNode(entry, executorFn, orch)
		}
	}
}

// executeNode runs the node's executor and reports the result back
// to the DAG orchestrator. The orchestrator reference is passed in
// rather than read from the struct to avoid a data race with
// SetDagOrchestrator.
func (s *SchedulerEngine) executeNode(entry SchedulableNodeEntry, fn ExecutorFunc, orch DagOrchestratorInterface) {
	node := entry.orchestratorNode
	holderID := node.DagID + ":" + node.NodeID

	// Per-node timeout: TimeoutMs<=0 disables enforcement. The context
	// is registered in nodeCancel so Stop() can cancel in-flight work
	// during drain; chromedp contexts derived from it are cancelled too.
	parent := context.Background()
	var ctx context.Context
	var cancel context.CancelFunc
	if node.TimeoutMs > 0 {
		ctx, cancel = context.WithTimeout(parent, time.Duration(node.TimeoutMs)*time.Millisecond)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}
	s.mu.Lock()
	s.nodeCancel[holderID] = cancel
	s.runningWg.Add(1)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.nodeCancel, holderID)
		s.mu.Unlock()
		cancel()
		s.slotPool.ReleaseAll(holderID)
		s.runningWg.Done()
	}()

	if orch != nil {
		_ = orch.TransitionNode(
			node.DagID,
			node.NodeID,
			"running",
			"execution started",
			"scheduler",
		)
	}

	success := true
	var errMsg string
	var data map[string]any

	result, err := fn(ctx, node)
	// Distinguish timeout/cancel from ordinary failure so the
	// orchestrator can drive the FAILED(TIMEOUT) retry path.
	timedOut := ctx.Err() == context.DeadlineExceeded
	cancelled := ctx.Err() == context.Canceled
	if err != nil || !result {
		success = false
		switch {
		case timedOut:
			errMsg = "node execution timeout"
		case cancelled:
			errMsg = "node execution cancelled"
		case err != nil:
			errMsg = err.Error()
		}
		s.logger.Error("Node execution failed", err, "nodeId", node.NodeID, "dagId", node.DagID, "timeout", timedOut, "cancelled", cancelled)
	} else {
		s.logger.Info("Node execution completed", "nodeId", node.NodeID, "dagId", node.DagID)
	}

	if orch != nil {
		if timedOut {
			_ = orch.TransitionNode(node.DagID, node.NodeID, "failed", "node execution timeout", "scheduler")
		}
		_ = orch.OnNodeCompleted(node.DagID, node.NodeID, success, data, errMsg)
	}
}

// GetStats returns the current scheduler queue statistics.
func (s *SchedulerEngine) GetStats() SchedulerStats {
	snapshot := s.readyQueue.Snapshot()

	stats := SchedulerStats{
		QueueSize:  len(snapshot),
		ByPriority: make(map[string]int),
		ByTaskType: make(map[string]int),
		Strategy:   s.strategy.Name(),
	}

	priorityNames := map[int]string{
		1: "BATCH", 3: "LOW", 5: "NORMAL", 8: "HIGH", 10: "CRITICAL",
	}
	for _, node := range snapshot {
		name, ok := priorityNames[node.Priority]
		if !ok {
			name = "UNKNOWN"
		}
		stats.ByPriority[name]++
		stats.ByTaskType[node.TaskType]++
	}
	return stats
}

// StartScanTimer begins a periodic timer that re-scans for schedulable
// nodes, compensating for missed slot-freed callbacks. A random jitter
// (~25% of interval) is added to each tick to spread out schedule
// attempts across goroutines and prevent thundering herd.
func (s *SchedulerEngine) StartScanTimer(interval time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.scanTicker != nil {
		s.scanTicker.Stop()
	}
	ticker := time.NewTicker(interval)
	s.scanTicker = ticker
	go func() {
		for {
			select {
			case <-ticker.C:
				// Jitter: ~25% of base interval to de-synchronize scans.
				jitterRange := interval / 4
				jitterNs := rand.Int63n(int64(jitterRange)*2+1) - int64(jitterRange)
				time.Sleep(time.Duration(jitterNs))
				s.Schedule()
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop halts the scan timer and releases goroutines (legacy immediate
// form, kept for callers that do not need drain semantics).
func (s *SchedulerEngine) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.scanTicker != nil {
		s.scanTicker.Stop()
		s.scanTicker = nil
	}
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
}

// StopWithDrain performs a graceful shutdown: stop accepting new
// submissions, halt the scan timer, then wait for in-flight nodes to
// finish until ctx's deadline. On deadline, remaining node contexts are
// cancelled (chromedp work aborts) and the wait completes; callers are
// expected to follow with EventStore.Flush + snapshot (see
// DagOrchestrator.Shutdown). Returns true if all nodes drained in time.
func (s *SchedulerEngine) StopWithDrain(ctx context.Context) bool {
	s.mu.Lock()
	s.draining = true
	if s.scanTicker != nil {
		s.scanTicker.Stop()
		s.scanTicker = nil
	}
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
	s.mu.Unlock()

	// Wait for running nodes with deadline awareness.
	done := make(chan struct{})
	go func() {
		s.runningWg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return true
	case <-ctx.Done():
		// Deadline hit: cancel every in-flight node context so executors
		// (and any derived chromedp contexts) abort promptly, then give
		// them a bounded grace period to unwind through their defers
		// (slot release, FAILED(cancelled) completion callbacks).
		s.mu.Lock()
		cancels := make([]context.CancelFunc, 0, len(s.nodeCancel))
		for _, c := range s.nodeCancel {
			cancels = append(cancels, c)
		}
		s.mu.Unlock()
		for _, c := range cancels {
			c()
		}
		graceCtx, graceCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer graceCancel()
		select {
		case <-done:
		case <-graceCtx.Done():
			s.logger.Warn("Drain grace period expired with nodes still running")
		}
		return false
	}
}

// IsDraining reports whether the scheduler has begun graceful shutdown.
func (s *SchedulerEngine) IsDraining() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.draining
}

// ── Slot introspection (API stubs — full implementation pending) ──

// GetSlotSnapshot returns current slot usage per type for the dashboard API.
func (s *SchedulerEngine) GetSlotSnapshot() map[string]slot.SlotUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.slotPool.GetSnapshot()
}

// UpdateSlotMax adjusts the max concurrency for a slot type at runtime.
func (s *SchedulerEngine) UpdateSlotMax(slotType string, max int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.slotPool.UpdateMax(slotType, max)
}

// GetActiveSlotHolders returns which tasks currently hold each slot type.
func (s *SchedulerEngine) GetActiveSlotHolders() map[string][]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.slotPool.GetActiveHolders()
}
