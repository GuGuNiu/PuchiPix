package scheduler

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator/executors"
	"backend/internal/orchestrator/slot"
)

// Defaults for the starvation lottery and scheduling iteration params.
// Tuned at runtime via the Set* methods below, loaded from app_configs at
// startup and hot-updated through PUT /api/config.
const (
	defaultStarvationThreshold   = 30 * time.Minute
	defaultStarvationLotteryRate = 0.1
	lowPriorityValue             = 3 // PriorityLow
	defaultMaxScheduleIterations = 256

	// maxStarvationThreshold bounds the configurable starvation threshold
	// (24h): a threshold beyond a day means the lottery effectively never
	// fires and LOW-priority nodes starve for the process lifetime.
	maxStarvationThreshold = 24 * time.Hour
)

// SchedulingStrategy is the interface for selecting the next node
// from the ready queue given current slot availability.
//
// Deprecated: Strategy selection is now handled by ReadyQueue.PopBest,
// which performs O(log n) heap-based priority selection with resource
// fitting in a single atomic operation. The interface and its sole
// implementation (PriorityFairStrategy) are retained only for backward
// compatibility with GetStats().Strategy and external consumers that
// reference the strategy name. The SelectNext method is not called by
// the scheduler engine's hot path.
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
	TimeoutMs int
	// NonCritical marks a node whose failure should not cascade to its
	// dependents or cause the DAG to fail.
	NonCritical bool
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

// SchedulerMetrics tracks cumulative scheduling counters for
// observability. All fields are accessed via atomic operations so the
// hot path (Schedule / executeNode) never blocks on metric collection.
// GetMetrics returns a point-in-time snapshot for API exposure.
type SchedulerMetrics struct {
	// TotalScheduled is the cumulative count of nodes dispatched to
	// executors (successful AcquireBatch + goroutine launch).
	TotalScheduled atomic.Int64
	// TotalRejected is the cumulative count of nodes whose submission
	// was rejected (queue full / draining).
	TotalRejected atomic.Int64
	// TotalSlotRaceLost is the cumulative count of nodes that won the
	// PopBest selection but lost the AcquireBatch race (requeued).
	TotalSlotRaceLost atomic.Int64
	// TotalSchedulePasses is the cumulative count of Schedule() calls
	// (including no-op passes that dispatched nothing).
	TotalSchedulePasses atomic.Int64
	// TotalNoopPasses is the cumulative count of Schedule() calls that
	// dispatched zero nodes (queue empty or no fitting nodes).
	TotalNoopPasses atomic.Int64
	// TotalStarvationPromotions is the cumulative count of starvation
	// lottery promotions.
	TotalStarvationPromotions atomic.Int64
	// LastScheduleAt is the Unix timestamp of the most recent
	// Schedule() invocation, used to detect stalled schedulers.
	LastScheduleAt atomic.Int64
}

// Snapshot returns a point-in-time copy of the metrics for API
// exposure. The struct fields are read atomically so the returned
// values may be slightly inconsistent across fields (each field is
// individually atomic but the snapshot is not transactional).
func (m *SchedulerMetrics) Snapshot() SchedulerMetricsSnapshot {
	return SchedulerMetricsSnapshot{
		TotalScheduled:            m.TotalScheduled.Load(),
		TotalRejected:             m.TotalRejected.Load(),
		TotalSlotRaceLost:         m.TotalSlotRaceLost.Load(),
		TotalSchedulePasses:       m.TotalSchedulePasses.Load(),
		TotalNoopPasses:           m.TotalNoopPasses.Load(),
		TotalStarvationPromotions: m.TotalStarvationPromotions.Load(),
		LastScheduleAt:            m.LastScheduleAt.Load(),
	}
}

// SchedulerMetricsSnapshot is the value type returned by Snapshot,
// suitable for JSON serialization in API responses.
type SchedulerMetricsSnapshot struct {
	TotalScheduled            int64 `json:"totalScheduled"`
	TotalRejected             int64 `json:"totalRejected"`
	TotalSlotRaceLost         int64 `json:"totalSlotRaceLost"`
	TotalSchedulePasses       int64 `json:"totalSchedulePasses"`
	TotalNoopPasses           int64 `json:"totalNoopPasses"`
	TotalStarvationPromotions int64 `json:"totalStarvationPromotions"`
	LastScheduleAt            int64 `json:"lastScheduleAt"`
}

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

	// Runtime-tunable scheduling params. Atomics (not mu-guarded fields)
	// because the Schedule() hot path runs without the lock while
	// Set*/Get* may fire concurrently — an atomic load per pass is
	// race-free and lets hot updates take effect on the very next pass.
	// starvationThreshold is stored as nanoseconds, lotteryRate as
	// float64 bits.
	starvationThreshold   atomic.Int64
	starvationLotteryRate atomic.Uint64
	maxScheduleIterations atomic.Int64

	// drain state
	draining   bool
	runningWg  sync.WaitGroup
	nodeCancel map[string]context.CancelFunc
	nodeDone   map[string]chan struct{}
	// nodeEpoch counts dispatches per holder ID. The supervisor's settle
	// skips its bookkeeping when a newer dispatch of the same node has
	// re-registered (only reachable through out-of-FSM paths), so a late
	// settle can never tear down a fresh run.
	nodeEpoch map[string]uint64

	// metrics tracks cumulative scheduling counters for observability.
	// All fields are atomic; the hot path never blocks on collection.
	metrics SchedulerMetrics
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
	s := &SchedulerEngine{
		strategy:   &PriorityFairStrategy{},
		readyQueue: NewReadyQueue(),
		slotPool:   sp,
		logger:     infra.NewLogger("Scheduler"),
		maxQueueSizePerSlot: map[string]int{
			"scraping": 5,
			"download": 5,
			"sniff":    1,
		},
		stopCh:     make(chan struct{}),
		nowFunc:    time.Now,
		nodeCancel: make(map[string]context.CancelFunc),
		nodeDone:   make(map[string]chan struct{}),
		nodeEpoch:  make(map[string]uint64),
	}
	s.starvationThreshold.Store(int64(defaultStarvationThreshold))
	s.starvationLotteryRate.Store(math.Float64bits(defaultStarvationLotteryRate))
	s.maxScheduleIterations.Store(defaultMaxScheduleIterations)
	// The default lottery closure reads the atomic rate so runtime
	// updates (SetStarvationLotteryRate) take effect without replacing
	// the (test-injectable) closure.
	s.lotteryFunc = func() bool {
		return rand.Float64() < math.Float64frombits(s.starvationLotteryRate.Load())
	}
	return s
}

// SchedulerConfigSnapshot exposes the current tuning values for logging
// and API responses.
type SchedulerConfigSnapshot struct {
	StarvationThreshold   time.Duration `json:"starvationThreshold"`
	StarvationLotteryRate float64       `json:"starvationLotteryRate"`
	MaxScheduleIterations int           `json:"maxScheduleIterations"`
}

// GetSchedulerConfig returns the current tuning values.
func (s *SchedulerEngine) GetSchedulerConfig() SchedulerConfigSnapshot {
	return SchedulerConfigSnapshot{
		StarvationThreshold:   time.Duration(s.starvationThreshold.Load()),
		StarvationLotteryRate: math.Float64frombits(s.starvationLotteryRate.Load()),
		MaxScheduleIterations: int(s.maxScheduleIterations.Load()),
	}
}

// SetStarvationThreshold sets the age at which LOW-priority nodes become
// eligible for lottery promotion. Values outside (0, 24h] are ignored and
// the current value is kept; returns false on rejection.
func (s *SchedulerEngine) SetStarvationThreshold(d time.Duration) bool {
	if d <= 0 || d > maxStarvationThreshold {
		s.logger.Warn("Rejected starvation threshold, keeping current",
			"requested", d.String())
		return false
	}
	s.starvationThreshold.Store(int64(d))
	return true
}

// SetStarvationLotteryRate sets the per-pass promotion probability.
// Values outside [0, 1] are ignored; returns false on rejection.
func (s *SchedulerEngine) SetStarvationLotteryRate(rate float64) bool {
	if rate < 0 || rate > 1 {
		s.logger.Warn("Rejected lottery rate, keeping current",
			"requested", rate)
		return false
	}
	s.starvationLotteryRate.Store(math.Float64bits(rate))
	return true
}

// SetMaxScheduleIterations caps the PopBest attempts per Schedule() pass.
// Values <= 0 are ignored; returns false on rejection.
func (s *SchedulerEngine) SetMaxScheduleIterations(n int) bool {
	if n <= 0 {
		s.logger.Warn("Rejected max schedule iterations, keeping current",
			"requested", n)
		return false
	}
	s.maxScheduleIterations.Store(int64(n))
	return true
}

// SetDagOrchestrator connects the orchestrator for transition callbacks.
func (s *SchedulerEngine) SetDagOrchestrator(orch DagOrchestratorInterface) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dagOrchestrator = orch
}

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
		s.metrics.TotalRejected.Add(1)
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
			s.metrics.TotalRejected.Add(1)
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

// IsExecuting reports whether a live executor supervisor is currently
// running this node. The zombie sweep uses it to tell a node whose
// executor is genuinely gone (supervisor settled, slot released) from
// one that is still in flight.
func (s *SchedulerEngine) IsExecuting(dagID, nodeID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.nodeCancel[dagID+":"+nodeID]
	return ok
}

// CancelNode removes a node from the ready queue.
func (s *SchedulerEngine) CancelNode(dagID, nodeID string) {
	s.readyQueue.Remove(dagID, nodeID)
}

// CancelRunningNode cancels the context of an in-flight executor so a
// pause/cancel actually stops the work instead of only detaching the
// FSM state, which would let the executor keep running and re-execute on
// resume. The cancel func was registered in executeNode. The
// orchestrator must have already transitioned the node to PAUSED /
// CANCELLED before calling this, so the executor's cancellation result
// is ignored by OnNodeCompleted (which only acts on RUNNING nodes).
func (s *SchedulerEngine) CancelRunningNode(dagID, nodeID string) {
	holderID := dagID + ":" + nodeID
	s.mu.Lock()
	if cancel, ok := s.nodeCancel[holderID]; ok {
		cancel()
	}
	s.mu.Unlock()
}

func (s *SchedulerEngine) WaitForDag(ctx context.Context, dagID string) error {
	prefix := dagID + ":"
	for {
		s.mu.Lock()
		channels := make([]<-chan struct{}, 0)
		for holderID, done := range s.nodeDone {
			if strings.HasPrefix(holderID, prefix) {
				channels = append(channels, done)
			}
		}
		s.mu.Unlock()
		if len(channels) == 0 {
			return nil
		}
		for _, done := range channels {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-done:
			}
		}
	}
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
// blocking the caller, which keeps retry backoff off the caller's
// goroutine: the orchestrator returns immediately while the timer
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

// to executors, given current slot availability.
func (s *SchedulerEngine) Schedule() {
	s.mu.Lock()
	if s.scheduling {
		s.mu.Unlock()
		return
	}
	// Fast-exit during drain to prevent post-shutdown scheduling passes
	// from scan-ticker goroutines that haven't yet observed stopCh.
	if s.draining {
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

	s.metrics.TotalSchedulePasses.Add(1)
	s.metrics.LastScheduleAt.Store(time.Now().Unix())

	// Starvation lottery: occasionally promote the oldest starving LOW
	// node so it can out-compete same-band peers on the FIFO tie-break.
	if lotteryFunc() {
		if s.readyQueue.PromoteOldestLowPriority(lowPriorityValue,
			time.Duration(s.starvationThreshold.Load()), nowFunc()) {
			s.metrics.TotalStarvationPromotions.Add(1)
			s.logger.Info("Starvation lottery promoted a LOW priority node")
		}
	}

	// Take one slot snapshot per scheduling pass and maintain it locally
	// as nodes are dispatched, instead of re-locking the pool on every
	// iteration. Correctness is preserved: the pool's release callback
	// re-enters Schedule() (guarded by the scheduling flag), and
	// AcquireBatch remains the final arbiter; a stale fit loses the
	// race and the node is requeued for a later pass.
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

	dispatched := 0
	// Hoisted atomic load: one read caps the whole pass (the value cannot
	// meaningfully change mid-pass).
	maxIter := int(s.maxScheduleIterations.Load())
	for i := 0; i < maxIter; i++ {
		if s.readyQueue.Len() == 0 {
			break
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
			break
		}

		holderID := selected.DagID + ":" + selected.NodeID
		if !s.slotPool.AcquireBatch(selected.ResourceRequirements, holderID) {
			// Lost the slot race; requeue so a later pass can retry.
			s.readyQueue.Push(*selected)
			s.metrics.TotalSlotRaceLost.Add(1)
			break
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
		dispatched++
	}

	if dispatched == 0 {
		s.metrics.TotalNoopPasses.Add(1)
	} else {
		s.metrics.TotalScheduled.Add(int64(dispatched))
	}
}

// executeNode runs the node's executor and reports the result back
// to the DAG orchestrator. The orchestrator reference is passed in
// rather than read from the struct to avoid a data race with
// SetDagOrchestrator.
//
// The executor runs on a detached worker goroutine while executeNode
// acts as its supervisor. This guarantees the node settles even when an
// executor blocks forever on a wait that ignores its context: the
// supervisor settles the node as soon as the worker reports or the
// context deadline fires, releases the slot, and detaches the stuck
// worker — its late result is discarded because the node is terminal by
// then. Without the supervisor, a blocked executor left the node in
// RUNNING forever: the slot pool's stale sweep freed the slot but
// nothing re-drove the node, wedging the DAG. The dispatch epoch guards
// the deferred bookkeeping so a late settle can never tear down a newer
// dispatch of the same node.
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
	done := make(chan struct{})
	s.mu.Lock()
	s.runningWg.Add(1)
	s.nodeEpoch[holderID]++
	epoch := s.nodeEpoch[holderID]
	s.nodeCancel[holderID] = cancel
	s.nodeDone[holderID] = done
	s.mu.Unlock()

	// settle runs exactly once per dispatch (via defer). The epoch check
	// skips the map cleanup and the slot release when a newer dispatch of
	// the same holder has re-registered; this dispatch's done channel is
	// still closed so its WaitForDag waiters unblock and re-collect.
	settle := func() {
		s.mu.Lock()
		current := s.nodeEpoch[holderID]
		if current == epoch {
			delete(s.nodeCancel, holderID)
			delete(s.nodeDone, holderID)
		}
		s.mu.Unlock()
		close(done)
		cancel()
		if current == epoch {
			s.slotPool.ReleaseAll(holderID)
		}
		s.runningWg.Done()
	}
	defer settle()

	if orch != nil {
		if err := orch.TransitionNode(
			node.DagID,
			node.NodeID,
			"running",
			"execution started",
			"scheduler",
		); err != nil {
			// The node was concurrently moved (paused, preparing, retry
			// path): whoever moved it owns its fate. The deferred settle
			// releases the dispatch bookkeeping; the zombie sweep
			// re-drives the node if it was stranded anyway.
			s.logger.Warn("Node execution skipped after state transition", err, "nodeId", node.NodeID, "dagId", node.DagID)
			return
		}
	}

	// resultCh is buffered so a worker finishing after its supervisor has
	// settled (timeout path) never blocks on the send.
	type execOutcome struct {
		result bool
		err    error
	}
	resultCh := make(chan execOutcome, 1)
	go func() {
		defer func() {
			// An executor panic must degrade to a node failure, not take
			// down the whole process.
			if r := recover(); r != nil {
				resultCh <- execOutcome{result: false, err: fmt.Errorf("executor panic: %v", r)}
			}
		}()
		result, err := fn(ctx, node)
		resultCh <- execOutcome{result: result, err: err}
	}()

	// Supervisor: settle as soon as the worker reports or the context
	// deadline fires. The loser's signal is discarded — the buffered
	// channel absorbs a late worker send, and OnNodeCompleted ignores
	// results for nodes that already reached a terminal state.
	var outcome execOutcome
	select {
	case outcome = <-resultCh:
	case <-ctx.Done():
		outcome = execOutcome{result: false, err: ctx.Err()}
	}

	success := true
	var errMsg string
	var data map[string]any

	// Distinguish timeout/cancel from ordinary failure so the
	// orchestrator can drive the FAILED retry path. Classification stays
	// on the context state (matching the previous behavior) even when the
	// worker returned at the same instant the context expired.
	timedOut := ctx.Err() == context.DeadlineExceeded
	cancelled := !timedOut && ctx.Err() == context.Canceled
	if outcome.err != nil || !outcome.result {
		success = false
		switch {
		case timedOut:
			errMsg = "node execution timeout"
		case cancelled:
			errMsg = "node execution cancelled"
		case outcome.err != nil:
			errMsg = outcome.err.Error()
		default:
			errMsg = "node execution failed"
		}
		// needs_retry (verify phase) is retryable, not a terminal failure:
		// flag it via the result data so the orchestrator routes the node
		// to NEEDS_RETRY and re-submits it instead of hard-failing.
		var needsRetryErr *executors.NeedsRetryError
		if errors.As(outcome.err, &needsRetryErr) {
			if data == nil {
				data = map[string]any{}
			}
			data["needsRetry"] = true
			data["needsRetryReason"] = needsRetryErr.Reason
		}
		// Timeout is classified here but landed by the orchestrator: carry
		// it structurally so OnNodeCompleted can drive the TIMEOUT state
		// instead of collapsing the deadline into a generic FAILED.
		if timedOut {
			if data == nil {
				data = map[string]any{}
			}
			data["timedOut"] = true
		}
		s.logger.Error("Node execution failed", outcome.err, "nodeId", node.NodeID, "dagId", node.DagID, "timeout", timedOut, "cancelled", cancelled)
	} else {
		s.logger.Info("Node execution completed", "nodeId", node.NodeID, "dagId", node.DagID)
	}

	// Report through OnNodeCompleted only: it performs the FAILED
	// transition itself AND drives the failure cascade to dependents. (A
	// separate TransitionNode here would settle the node first and make
	// OnNodeCompleted discard the result, stranding successors in PENDING
	// forever after a timeout.)
	if orch != nil {
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

// Stop halts the scan timer and the scheduling loop immediately, without
// waiting for in-flight nodes. Callers that need drain semantics use
// StopWithDrain.
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

// StopWithDrain stops accepting new submissions, halts the scan timer,
// then waits for in-flight nodes until ctx's deadline. On deadline,
// remaining node contexts are cancelled (chromedp work aborts) and a
// bounded grace period is given for them to unwind through their defers
// (slot release, FAILED(cancelled) completion callbacks); callers are
// expected to follow with EventStore.Flush plus a snapshot (see
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

// IsDraining reports whether the scheduler has stopped accepting new
// submissions and is waiting for in-flight nodes.
func (s *SchedulerEngine) IsDraining() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.draining
}

// GetSlotSnapshot returns current slot usage per type for the dashboard API.
func (s *SchedulerEngine) GetSlotSnapshot() map[string]slot.SlotUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.slotPool.GetSnapshot()
}

// UpdateSlotMax adjusts the max concurrency for a slot type at runtime.
// It deliberately does NOT hold s.mu while calling slotPool.UpdateMax.
// UpdateMax fires maxUpdateCallback, which re-enters
// SyncQueueCapacityFromSlotPool and re-acquires s.mu; holding it here
// would self-deadlock and freeze every subsequent PUT /api/slots/{type}
// request.
func (s *SchedulerEngine) UpdateSlotMax(slotType string, max int) {
	s.slotPool.UpdateMax(slotType, max)
}

// GetActiveSlotHolders returns which tasks currently hold each slot type.
func (s *SchedulerEngine) GetActiveSlotHolders() map[string][]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.slotPool.GetActiveHolders()
}

// ResetSlot clears all usage for a single slot type (emergency ghost-slot
// recovery). Returns false if the slot type is not registered.
func (s *SchedulerEngine) ResetSlot(slotType string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.slotPool.ResetType(slotType)
}

// GetMetrics returns a point-in-time snapshot of cumulative scheduling
// counters for observability and API exposure. All counters are atomic
// so this call never blocks the hot path.
func (s *SchedulerEngine) GetMetrics() SchedulerMetricsSnapshot {
	return s.metrics.Snapshot()
}

// QueueDepth returns the number of nodes currently waiting in the ready
// queue that require the given slot type. Used by the pressure monitor
// to compute queue-backed pressure.
func (s *SchedulerEngine) QueueDepth(slotType string) int {
	return s.readyQueue.CountBySlotType(slotType)
}

// QueueCapacity returns the configured maximum queue size for the slot
// type. Used by the pressure monitor to normalize queue depth into a
// ratio.
func (s *SchedulerEngine) QueueCapacity(slotType string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cap, ok := s.maxQueueSizePerSlot[slotType]; ok {
		return cap
	}
	return 0
}
