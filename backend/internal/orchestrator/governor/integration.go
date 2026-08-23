package governor

import (
	"context"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator/scheduler"
	"backend/internal/orchestrator/slot"
)

// FlowController is the unified facade for admission control + pressure
// monitoring + adaptive governor. Call Ask() before scheduler.Submit().
type FlowController struct {
	admission       *AdmissionController
	monitor         *PressureMonitor
	governor        *Governor
	schedulerEngine *scheduler.SchedulerEngine

	mu      sync.Mutex
	running bool
	stopCh  chan struct{}

	logger *infra.Logger
}

type FlowControllerConfig struct {
	AdmissionCapacity    int
	AdmissionInitialRate float64
	AdmissionMinRate     float64
	AdmissionMaxRate     float64

	AIMDAdditive          float64
	AIMDMultiplicative    float64
	MinPressureForIncrease float64

	OverloadThreshold float64
	CriticalThreshold float64

	TickInterval time.Duration
}

// DefaultFlowControllerConfig provides a balanced starting point.
func DefaultFlowControllerConfig() FlowControllerConfig {
	return FlowControllerConfig{
		AdmissionCapacity:      10,
		AdmissionInitialRate:   5.0,
		AdmissionMinRate:       0.1,
		AdmissionMaxRate:       50.0,

		AIMDAdditive:          0.5,
		AIMDMultiplicative:    0.5,
		MinPressureForIncrease: 0.5,

		OverloadThreshold: 0.75,
		CriticalThreshold: 0.95,

		TickInterval: 2 * time.Second,
	}
}

// NewFlowController creates a fully-wired flow controller.
func NewFlowController(sp *slot.SlotPool, se *scheduler.SchedulerEngine, cfg FlowControllerConfig) *FlowController {
	ac := NewAdmissionController(cfg.AdmissionCapacity, cfg.AdmissionInitialRate, cfg.AdmissionMinRate, cfg.AdmissionMaxRate)
	pm := NewPressureMonitor(sp, cfg.OverloadThreshold, cfg.CriticalThreshold)
	gov := NewGovernor(ac, pm)

	gov.SetAIMDParams(cfg.AIMDAdditive, cfg.AIMDMultiplicative, cfg.MinPressureForIncrease)
	gov.SetTickInterval(cfg.TickInterval)

	fc := &FlowController{
		admission:       ac,
		monitor:         pm,
		governor:        gov,
		schedulerEngine: se,
		logger:          infra.NewLogger("FlowCtrl"),
	}

	pm.SetQueueSizer(&queueSorterAdapter{engine: se})
	return fc
}

// Ask blocks until admission is granted or ctx is cancelled.
func (fc *FlowController) Ask(ctx context.Context) error {
	return fc.admission.Acquire(ctx)
}

func (fc *FlowController) TryAsk() bool {
	return fc.admission.TryAcquire()
}

func (fc *FlowController) Start(ctx context.Context) {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	if fc.running {
		return
	}
	fc.running = true
	fc.governor.Start(ctx)
}

func (fc *FlowController) Stop() {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	if !fc.running {
		return
	}
	fc.running = false
	fc.governor.Stop()
}

func (fc *FlowController) Stats() FlowControllerStats {
	return FlowControllerStats{
		Running:  fc.running,
		Governor: fc.governor.Stats(),
	}
}

type FlowControllerStats struct {
	Running  bool           `json:"running"`
	Governor GovernorStats  `json:"governor"`
}

type queueSorterAdapter struct {
	engine *scheduler.SchedulerEngine
}

func (a *queueSorterAdapter) QueueDepth(slotType string) int {
	if a.engine == nil {
		return 0
	}
	return a.engine.QueueDepth(slotType)
}

func (a *queueSorterAdapter) QueueCapacity(slotType string) int {
	if a.engine == nil {
		return 0
	}
	return a.engine.QueueCapacity(slotType)
}
