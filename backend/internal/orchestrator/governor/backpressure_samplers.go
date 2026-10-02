package governor

import (
	"sync"

	"backend/internal/downloader"
	"backend/internal/orchestrator/scheduler"
	"backend/internal/orchestrator/slot"
)

// DomainLoadSource is the slice of the per-domain admission gate the monitor
// needs. Declaring it here keeps this package independent of how the stealth
// package chooses to expose its load.
type DomainLoadSource interface {
	Load() float64
}

// BackpressureLayers holds the monitor plus the adapters that feed it, so the
// caller can start and stop sampling as one unit.
type BackpressureLayers struct {
	monitor *BackpressureMonitor
	stopCh  chan struct{}
	once    sync.Once
}

// RegisterBackpressureLayers wires the flow controller, slot pool, scheduler,
// process-wide download valve and per-domain admission gate into a monitor.
// The monitor observes only; sampling never gates, which keeps it free of side
// effects on the hot path.
func RegisterBackpressureLayers(
	monitor *BackpressureMonitor,
	admission *AdmissionController,
	pressure *PressureMonitor,
	sp *slot.SlotPool,
	se *scheduler.SchedulerEngine,
	domainAdmission DomainLoadSource,
) *BackpressureLayers {
	l := &BackpressureLayers{
		monitor: monitor,
		stopCh:  make(chan struct{}),
	}
	if monitor == nil {
		return l
	}
	monitor.Register(&admissionSampler{admission: admission})
	monitor.Register(&slotPoolSampler{pool: sp})
	monitor.Register(&schedulerQueueSampler{engine: se, pressure: pressure})
	monitor.Register(globalDownloadSampler{})
	if domainAdmission != nil {
		monitor.Register(&domainPoolSampler{source: domainAdmission})
	}
	return l
}

// Start begins periodic sampling. The caller closes the returned channel, or
// calls Stop, to end sampling.
func (l *BackpressureLayers) Start() <-chan struct{} {
	return l.stopCh
}

// Stop ends sampling. Repeated calls after the first are no-ops.
func (l *BackpressureLayers) Stop() {
	l.once.Do(func() { close(l.stopCh) })
}

// Monitor exposes the underlying monitor, which may be nil.
func (l *BackpressureLayers) Monitor() *BackpressureMonitor {
	return l.monitor
}

type admissionSampler struct {
	admission *AdmissionController
}

func (a *admissionSampler) Layer() BackpressureLayer { return LayerAPIGate }

func (a *admissionSampler) Sample() LayerStatus {
	if a.admission == nil {
		return LayerStatus{Layer: LayerAPIGate, Healthy: true, Trend: "stable"}
	}
	stats := a.admission.Snapshot()
	load := 0.0
	if stats.Capacity > 0 {
		load = stats.Tokens / float64(stats.Capacity)
	}
	return LayerStatus{
		Layer:    LayerAPIGate,
		Load:     clamp01(load),
		Current:  int(stats.Tokens),
		Capacity: stats.Capacity,
		QueueLen: int(stats.PendingWaiters),
		Healthy:  true,
		Trend:    "stable",
	}
}

type slotPoolSampler struct {
	pool *slot.SlotPool
}

func (s *slotPoolSampler) Layer() BackpressureLayer { return LayerSlotPool }

func (s *slotPoolSampler) Sample() LayerStatus {
	if s.pool == nil {
		return LayerStatus{Layer: LayerSlotPool, Healthy: true, Trend: "stable"}
	}
	snapshot := s.pool.GetSnapshot()
	worst := 0.0
	total, capacity := 0, 0
	for _, usage := range snapshot {
		total += usage.Current
		capacity += usage.Max
		if usage.Max > 0 {
			ratio := float64(usage.Current) / float64(usage.Max)
			if ratio > worst {
				worst = ratio
			}
		}
	}
	return LayerStatus{
		Layer:    LayerSlotPool,
		Load:     clamp01(worst),
		Current:  total,
		Capacity: capacity,
		Healthy:  worst < 0.95,
		Trend:    "stable",
	}
}

type schedulerQueueSampler struct {
	engine   *scheduler.SchedulerEngine
	pressure *PressureMonitor
}

func (s *schedulerQueueSampler) Layer() BackpressureLayer { return LayerScheduler }

func (s *schedulerQueueSampler) Sample() LayerStatus {
	if s.engine == nil {
		return LayerStatus{Layer: LayerScheduler, Healthy: true, Trend: "stable"}
	}
	queued, capacity := 0, 0
	for _, slotType := range []string{"scraping", "download", "sniff"} {
		queued += s.engine.QueueDepth(slotType)
		if c := s.engine.QueueCapacity(slotType); c > capacity {
			capacity = c
		}
	}
	load := 0.0
	if capacity > 0 {
		load = float64(queued) / float64(capacity)
	}
	status := LayerStatus{
		Layer:    LayerScheduler,
		Load:     clamp01(load),
		Current:  queued,
		Capacity: capacity,
		Healthy:  true,
		Trend:    "stable",
	}
	if s.pressure != nil {
		if trend := s.pressure.Trend(); trend != "" {
			status.Trend = trend
		}
	}
	return status
}

// globalDownloadSampler reports the process-wide download valve.
type globalDownloadSampler struct{}

func (globalDownloadSampler) Layer() BackpressureLayer { return LayerGlobalDownload }

func (globalDownloadSampler) Sample() LayerStatus {
	inUse, max := downloader.CurrentLoad()
	load := 0.0
	if max > 0 {
		load = float64(inUse) / float64(max)
	}
	return LayerStatus{
		Layer:    LayerGlobalDownload,
		Load:     clamp01(load),
		Current:  inUse,
		Capacity: max,
		Healthy:  load < 0.95,
		Trend:    "stable",
	}
}

// domainPoolSampler reports per-domain admission saturation, the domain-scoped
// counterpart to the slot pool reading.
type domainPoolSampler struct {
	source DomainLoadSource
}

func (d *domainPoolSampler) Layer() BackpressureLayer { return LayerDomainPool }

func (d *domainPoolSampler) Sample() LayerStatus {
	if d.source == nil {
		return LayerStatus{Layer: LayerDomainPool, Healthy: true, Trend: "stable"}
	}
	load := clamp01(d.source.Load())
	return LayerStatus{
		Layer:   LayerDomainPool,
		Load:    load,
		Healthy: load < 0.95,
		Trend:   "stable",
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

var (
	_ LayerSampler = (*admissionSampler)(nil)
	_ LayerSampler = (*slotPoolSampler)(nil)
	_ LayerSampler = (*schedulerQueueSampler)(nil)
	_ LayerSampler = globalDownloadSampler{}
	_ LayerSampler = (*domainPoolSampler)(nil)
)
