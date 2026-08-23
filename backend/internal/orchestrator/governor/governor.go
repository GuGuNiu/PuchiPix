package governor

import (
	"context"
	"math"
	"sync"
	"time"

	"backend/internal/infra"
)

// Governor is the control loop that samples pressure and adjusts the
// admission rate. AIMD: additive increase when idle/normal, multiplicative
// decrease when overloaded. Mirrors TCP congestion control to probe gently
// and back off fast under stress.
type Governor struct {
	mu sync.Mutex

	admission *AdmissionController
	monitor   *PressureMonitor

	aimdAdditive          float64
	aimdMultiplicative    float64
	tickInterval          time.Duration
	minPressureForIncrease float64

	sampleCount   atomicCounter
	lastDecision  string
	runningCh     chan struct{}
	stopOnce      sync.Once
	logger        *infra.Logger
}

// NewGovernor creates a governor. Defaults: additive 0.5/s, multiplicative
// 0.5, tick 2s, probe threshold 0.5.
func NewGovernor(ac *AdmissionController, pm *PressureMonitor) *Governor {
	return &Governor{
		admission:             ac,
		monitor:               pm,
		aimdAdditive:          0.5,
		aimdMultiplicative:    0.5,
		tickInterval:          2 * time.Second,
		minPressureForIncrease: 0.5,
		logger:                infra.NewLogger("Governor"),
	}
}

func (g *Governor) SetAIMDParams(additive, multiplicative, minPressure float64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.aimdAdditive = additive
	g.aimdMultiplicative = multiplicative
	g.minPressureForIncrease = minPressure
}

func (g *Governor) SetTickInterval(d time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.tickInterval = d
}

func (g *Governor) Start(ctx context.Context) {
	g.mu.Lock()
	if g.runningCh != nil {
		g.mu.Unlock()
		return
	}
	g.runningCh = make(chan struct{})
	g.mu.Unlock()
	go g.run(ctx)
}

func (g *Governor) Stop() {
	g.stopOnce.Do(func() {
		g.mu.Lock()
		ch := g.runningCh
		g.runningCh = nil
		g.mu.Unlock()
		if ch != nil {
			close(ch)
		}
	})
}

func (g *Governor) run(ctx context.Context) {
	ticker := time.NewTicker(g.tickInterval)
	defer ticker.Stop()

	g.tick() // initial sample

	for {
		select {
		case <-ctx.Done():
			return
		case <-g.runningCh:
			return
		case <-ticker.C:
			g.tick()
		}
	}
}

func (g *Governor) tick() {
	snap := g.monitor.SampleAndGet()
	g.sampleCount.Add(1)

	g.mu.Lock()
	currentRate := g.admission.CurrentRate()
	additive := g.aimdAdditive
	multiplicative := g.aimdMultiplicative
	minPressure := g.minPressureForIncrease
	g.mu.Unlock()

	var newRate float64
	var reason string

	switch snap.SystemLevel {
	case LevelIdle:
		newRate = currentRate * 2
		reason = "idle: aggressive ramp-up"
	case LevelNormal:
		if snap.CompositePressure < minPressure {
			newRate = currentRate + additive
			reason = "normal: additive increase"
		} else {
			newRate = currentRate
			reason = "normal: holding"
		}
	case LevelOverloaded:
		newRate = currentRate * multiplicative
		reason = "overloaded: multiplicative decrease"
	case LevelCritical:
		newRate = currentRate * 0.25
		reason = "critical: aggressive throttle"
	}

	maxRate := g.admission.maxRate
	minRate := g.admission.minRate
	if newRate > maxRate {
		newRate = maxRate
	}
	if newRate < minRate {
		newRate = minRate
	}
	newRate = math.Round(newRate*100) / 100

	g.admission.SetRate(newRate)

	g.mu.Lock()
	g.lastDecision = reason
	g.mu.Unlock()

	if snap.SystemLevel == LevelOverloaded || snap.SystemLevel == LevelCritical {
		g.logger.Warn("Governor throttling admission",
			"level", snap.SystemLevel,
			"oldRate", currentRate, "newRate", newRate,
			"reason", reason)
	}
}

func (g *Governor) Stats() GovernorStats {
	g.mu.Lock()
	defer g.mu.Unlock()
	return GovernorStats{
		SampleCount:  g.sampleCount.Load(),
		LastDecision: g.lastDecision,
		TickInterval: g.tickInterval,
		Admission:    g.admission.Snapshot(),
		Pressure:     g.monitor.LastSample(),
		Trend:        g.monitor.Trend(),
	}
}

type GovernorStats struct {
	SampleCount   int64            `json:"sampleCount"`
	LastDecision  string           `json:"lastDecision"`
	TickInterval  time.Duration    `json:"tickInterval"`
	Admission     AdmissionStats   `json:"admission"`
	Pressure      PressureSnapshot `json:"pressure"`
	Trend         string           `json:"trend"`
}
