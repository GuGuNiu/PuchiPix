package governor

import (
	"math"
	"sync"
	"time"

	"backend/internal/infra"
	"backend/internal/orchestrator/slot"
)

// PressureGauge is the friction level of one slot type (0.0=idle, 1.0=full).
type PressureGauge struct {
	SlotType   string  `json:"slotType"`
	Running    int     `json:"running"`
	Max        int     `json:"max"`
	QueueCount int     `json:"queueCount"`
	QueueMax   int     `json:"queueMax"`
	Pressure   float64 `json:"pressure"`
	Overloaded bool    `json:"overloaded"`
}

// PressureMonitor samples SlotPool + ReadyQueue to compute a composite
// pressure index used by the Governor to adjust admission rate.
type PressureMonitor struct {
	mu sync.Mutex

	slotPool          *slot.SlotPool
	queueSizer        QueueSizer
	overloadThreshold float64
	criticalThreshold float64

	history    []PressureSnapshot
	historyCap int
	lastSample time.Time

	logger *infra.Logger
}

// QueueSizer reads queue depth from the scheduler (avoids a cycle import).
type QueueSizer interface {
	QueueDepth(slotType string) int
	QueueCapacity(slotType string) int
}

func NewPressureMonitor(sp *slot.SlotPool, overloadThreshold, criticalThreshold float64) *PressureMonitor {
	return &PressureMonitor{
		slotPool:          sp,
		overloadThreshold: overloadThreshold,
		criticalThreshold: criticalThreshold,
		historyCap:        60,
		history:           make([]PressureSnapshot, 0, 60),
		logger:            infra.NewLogger("PressureMon"),
	}
}

func (pm *PressureMonitor) SetQueueSizer(qs QueueSizer) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.queueSizer = qs
}

// SampleAndGet returns a point-in-time pressure snapshot.
func (pm *PressureMonitor) SampleAndGet() PressureSnapshot {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	slotSnap := pm.slotPool.GetSnapshot()

	gauges := make([]PressureGauge, 0, len(slotSnap))
	worstPressure := 0.0
	overloadedCount := 0

	for st, usage := range slotSnap {
		runningRatio := 0.0
		if usage.Max > 0 {
			runningRatio = float64(usage.Current) / float64(usage.Max)
		}

		queueCount := 0
		queueMax := usage.Max
		if pm.queueSizer != nil {
			queueCount = pm.queueSizer.QueueDepth(st)
			queueMax = pm.queueSizer.QueueCapacity(st)
			if queueMax == 0 {
				queueMax = usage.Max
			}
		}
		queueRatio := 0.0
		if queueMax > 0 {
			queueRatio = float64(queueCount) / float64(queueMax)
		}

		// Running carries more weight: active work consumes real resources,
		// queue is only pending demand.
		pressure := runningRatio*0.6 + queueRatio*0.4
		if pressure > 1.0 {
			pressure = 1.0
		}

		gauge := PressureGauge{
			SlotType:   st,
			Running:    usage.Current,
			Max:        usage.Max,
			QueueCount: queueCount,
			QueueMax:   queueMax,
			Pressure:   round3(pressure),
			Overloaded: pressure >= pm.overloadThreshold,
		}
		gauges = append(gauges, gauge)

		if pressure > worstPressure {
			worstPressure = pressure
		}
		if gauge.Overloaded {
			overloadedCount++
		}
	}

	snap := PressureSnapshot{
		Timestamp:         now,
		Gauges:            gauges,
		CompositePressure: round3(worstPressure),
		OverloadedCount:   overloadedCount,
		SystemLevel:       pressureLevel(worstPressure, pm.overloadThreshold, pm.criticalThreshold),
	}

	pm.history = append(pm.history, snap)
	if len(pm.history) > pm.historyCap {
		pm.history = pm.history[len(pm.history)-pm.historyCap:]
	}
	pm.lastSample = now
	return snap
}

func (pm *PressureMonitor) LastSample() PressureSnapshot {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if len(pm.history) == 0 {
		return PressureSnapshot{}
	}
	return pm.history[len(pm.history)-1]
}

func (pm *PressureMonitor) History() []PressureSnapshot {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	out := make([]PressureSnapshot, len(pm.history))
	copy(out, pm.history)
	return out
}

// Trend returns "rising", "falling", or "stable" comparing oldest vs newest.
func (pm *PressureMonitor) Trend() string {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	n := len(pm.history)
	if n < 6 {
		return "stable"
	}

	third := n / 3
	oldSum, newSum := 0.0, 0.0
	for i := 0; i < third; i++ {
		oldSum += pm.history[i].CompositePressure
	}
	for i := n - third; i < n; i++ {
		newSum += pm.history[i].CompositePressure
	}

	diff := newSum/float64(third) - oldSum/float64(third)
	switch {
	case diff > 0.05:
		return "rising"
	case diff < -0.05:
		return "falling"
	default:
		return "stable"
	}
}

type PressureSnapshot struct {
	Timestamp         time.Time       `json:"timestamp"`
	Gauges            []PressureGauge `json:"gauges"`
	CompositePressure float64         `json:"compositePressure"`
	OverloadedCount   int             `json:"overloadedCount"`
	SystemLevel       PressureLevel   `json:"systemLevel"`
}

type PressureLevel string

const (
	LevelIdle       PressureLevel = "idle"
	LevelNormal     PressureLevel = "normal"
	LevelOverloaded PressureLevel = "overloaded"
	LevelCritical   PressureLevel = "critical"
)

func pressureLevel(p, overload, critical float64) PressureLevel {
	switch {
	case p >= critical:
		return LevelCritical
	case p >= overload:
		return LevelOverloaded
	case p >= 0.3:
		return LevelNormal
	default:
		return LevelIdle
	}
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}
