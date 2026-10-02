package governor

import (
	"sync"
	"sync/atomic"
	"time"

	"backend/internal/infra"
)

// BackpressureLayer identifies one of the six layers in the multi-layer
// backpressure coordination mechanism. Each layer operates at a different scope
// and must coordinate with the others to prevent resource exhaustion.
type BackpressureLayer string

const (
	LayerAPIGate        BackpressureLayer = "api_gate"        // FlowController token bucket
	LayerScheduler      BackpressureLayer = "scheduler"       // scheduler queue
	LayerSlotPool       BackpressureLayer = "slot_pool"       // execution slots
	LayerGlobalDownload BackpressureLayer = "global_download" // global download concurrency
	LayerSSE            BackpressureLayer = "sse"             // SSE traffic shaping
	LayerExecutor       BackpressureLayer = "executor"        // executor cooperative pause
	LayerDomainPool     BackpressureLayer = "domain_pool"     // per-domain admission saturation
)

// LayerStatus captures the instantaneous load of one backpressure layer.
type LayerStatus struct {
	Layer    BackpressureLayer `json:"layer"`
	Load     float64           `json:"load"`     // 0.0 = idle, 1.0 = full
	Current  int               `json:"current"`  // current in-flight count
	Capacity int               `json:"capacity"` // maximum capacity
	QueueLen int               `json:"queueLen"` // pending items in queue
	Healthy  bool              `json:"healthy"`  // false = overloaded/critical
	Trend    string            `json:"trend"`    // "rising", "falling", "stable"
}

// BackpressureSnapshot is a point-in-time reading of all six layers.
// It is used by the BackpressureMonitor for logging, alerting, and
// adaptive rate adjustments.
type BackpressureSnapshot struct {
	Timestamp time.Time     `json:"timestamp"`
	Layers    []LayerStatus `json:"layers"`
	// CompositeLoad is the worst-case load across all layers (0.0–1.0).
	// A value above 0.8 means at least one layer is near capacity.
	CompositeLoad float64 `json:"compositeLoad"`
	// CriticalLayers lists layers that are at or above their critical
	// threshold and may need immediate intervention (e.g., shedding load).
	CriticalLayers []string `json:"criticalLayers,omitempty"`
}

// LayerSampler is implemented by each backpressure layer to report its
// current load. The monitor calls Sample() periodically to build a
// composite snapshot. Implementations must tolerate concurrent use.
type LayerSampler interface {
	Layer() BackpressureLayer
	Sample() LayerStatus
}

// BackpressureMonitor periodically samples all registered layers and
// computes a composite pressure index. It is the "dashboard" for the
// multi-layer backpressure coordination mechanism: callers (API, SSE,
// scheduler) consult it to make shedding decisions under stress.
//
// The monitor does NOT enforce backpressure; it only observes and
// reports. Enforcement is the responsibility of each layer (e.g. the
// FlowController adjusts its rate, the SSE aggregator starts coalescing
// events), keeping sampling side-effect-free and control domain-specific.
type BackpressureMonitor struct {
	mu sync.RWMutex

	samplers      []LayerSampler
	sampleHistory []BackpressureSnapshot
	historyCap    int
	interval      time.Duration

	// alertCounters tracks how many times each layer entered critical state.
	alertCounters map[BackpressureLayer]*int64

	logger *infra.Logger
}

// NewBackpressureMonitor creates a monitor with the given sampling
// interval. A shorter interval means more responsive alerting but
// more overhead. 5-10s is recommended for production.
func NewBackpressureMonitor(interval time.Duration) *BackpressureMonitor {
	return &BackpressureMonitor{
		samplers:      make([]LayerSampler, 0, 6),
		sampleHistory: make([]BackpressureSnapshot, 0, 120),
		historyCap:    120,
		interval:      interval,
		alertCounters: make(map[BackpressureLayer]*int64),
		logger:        infra.NewLogger("BackpressureMon"),
	}
}

// Register adds a layer sampler. Must be called before Start().
// Duplicate layers (same Layer() value) are ignored.
func (m *BackpressureMonitor) Register(s LayerSampler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.samplers {
		if existing.Layer() == s.Layer() {
			return
		}
	}
	m.samplers = append(m.samplers, s)
	m.alertCounters[s.Layer()] = new(int64)
}

// Idempotent: calling it twice starts only one goroutine.
// The goroutine stops when ctx is cancelled.
func (m *BackpressureMonitor) Start(ctx <-chan struct{}) {
	m.mu.Lock()
	if m.alertCounters == nil {
		m.alertCounters = make(map[BackpressureLayer]*int64)
	}
	started := len(m.samplers) > 0
	m.mu.Unlock()

	if !started {
		return
	}

	go func() {
		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.sample()
			case <-ctx:
				return
			}
		}
	}()
}

// sample takes a reading from all registered layers and stores it
// in the history, logging a warning for any layer in a critical state.
func (m *BackpressureMonitor) sample() {
	m.mu.RLock()
	samplers := make([]LayerSampler, len(m.samplers))
	copy(samplers, m.samplers)
	m.mu.RUnlock()

	now := time.Now()
	layers := make([]LayerStatus, 0, len(samplers))
	compositeLoad := 0.0
	var critical []string

	for _, s := range samplers {
		status := s.Sample()
		layers = append(layers, status)

		if status.Load > compositeLoad {
			compositeLoad = status.Load
		}

		if !status.Healthy {
			critical = append(critical, string(status.Layer))
			m.mu.Lock()
			if counter, ok := m.alertCounters[s.Layer()]; ok {
				atomic.AddInt64(counter, 1)
			}
			m.mu.Unlock()
		}
	}

	snap := BackpressureSnapshot{
		Timestamp:      now,
		Layers:         layers,
		CompositeLoad:  compositeLoad,
		CriticalLayers: critical,
	}

	m.mu.Lock()
	m.sampleHistory = append(m.sampleHistory, snap)
	if len(m.sampleHistory) > m.historyCap {
		m.sampleHistory = m.sampleHistory[len(m.sampleHistory)-m.historyCap:]
	}
	m.mu.Unlock()

	if len(critical) > 0 {
		m.logger.Warn("Backpressure layer critical",
			infra.LogContext{Extra: map[string]any{
				"criticalLayers": critical,
				"compositeLoad":  compositeLoad,
			}})
	}
}

// LatestSnapshot returns the most recent backpressure reading,
// or a zero-value snapshot if no sample has been taken yet.
func (m *BackpressureMonitor) LatestSnapshot() BackpressureSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.sampleHistory) == 0 {
		return BackpressureSnapshot{}
	}
	return m.sampleHistory[len(m.sampleHistory)-1]
}

// IsCritical returns true if any layer is currently in a critical
// state (load above its unhealthy threshold). Callers can use this
// to decide whether to shed load (e.g., reject new tasks, start SSE
// aggregation).
func (m *BackpressureMonitor) IsCritical() bool {
	snap := m.LatestSnapshot()
	return len(snap.CriticalLayers) > 0
}

// AlertCount returns the number of times a layer has entered critical
// state since the monitor started. Useful for metrics and dashboards.
func (m *BackpressureMonitor) AlertCount(layer BackpressureLayer) int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if counter, ok := m.alertCounters[layer]; ok {
		return atomic.LoadInt64(counter)
	}
	return 0
}

// History returns a copy of the recent backpressure snapshots for
// trend analysis and dashboard rendering.
func (m *BackpressureMonitor) History() []BackpressureSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]BackpressureSnapshot, len(m.sampleHistory))
	copy(out, m.sampleHistory)
	return out
}
