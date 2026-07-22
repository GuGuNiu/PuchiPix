package slot

import (
	"sync"
	"time"

	"backend/internal/infra"
)

// SlotTypeDefinition declares a slot type's limits and lifecycle.
type SlotTypeDefinition struct {
	Key         string
	Label       string
	DefaultMax  int
	ConfigKey   string
	Min         int
	Max         int
}

// slotEntry holds the runtime state for one slot type.
type slotEntry struct {
	definition SlotTypeDefinition
	max        int
	running    int
	activeSlots map[string]bool
	heldSince  map[string]int64
}

// SlotPool controls concurrency with per-type capacity limits,
// mirroring the TypeScript SlotPool and supporting batch acquisition.
type SlotPool struct {
	mu               sync.Mutex
	pools            map[string]*slotEntry
	schedulerCallback func(slotType string)
	logger           *infra.Logger
}

// NewSlotPool creates an empty pool. Slot types must be registered
// via RegisterType before use.
func NewSlotPool() *SlotPool {
	return &SlotPool{
		pools:  make(map[string]*slotEntry),
		logger: infra.NewLogger("SlotPool"),
	}
}

// RegisterType adds a slot type to the pool with the given max capacity.
func (p *SlotPool) RegisterType(def SlotTypeDefinition) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pools[def.Key] = &slotEntry{
		definition:  def,
		max:         def.DefaultMax,
		activeSlots: make(map[string]bool),
		heldSince:   make(map[string]int64),
	}
	p.logger.Info("Slot type registered", def.Key, "max", def.DefaultMax)
}

// SetSchedulerCallback installs a callback invoked whenever a slot is
// released, allowing the scheduler to re-scan for ready nodes.
func (p *SlotPool) SetSchedulerCallback(cb func(slotType string)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.schedulerCallback = cb
}

// HasAvailable checks whether the slot type has free capacity.
func (p *SlotPool) HasAvailable(slotType string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.pools[slotType]
	if !ok {
		return false
	}
	return entry.running < entry.max
}

// HasHolder checks whether a holder already owns a slot of the given type.
func (p *SlotPool) HasHolder(slotType, holderID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.pools[slotType]
	if !ok {
		return false
	}
	return entry.activeSlots[holderID]
}

// Acquire attempts to acquire a single slot for a holder. Returns true
// on success or if the holder already owns a slot.
func (p *SlotPool) Acquire(slotType, holderID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.pools[slotType]
	if !ok {
		p.logger.Error("Slot type not found", "slotType", slotType)
		return false
	}

	if entry.activeSlots[holderID] {
		return true
	}

	if entry.running >= entry.max {
		return false
	}

	entry.activeSlots[holderID] = true
	entry.running++
	entry.heldSince[holderID] = time.Now().UnixMilli()
	p.logger.Debug("Slot acquired", "slotType", slotType, "holder", holderID, "current", entry.running, "max", entry.max)
	return true
}

// AcquireBatch attempts to acquire multiple slot types atomically.
// If any type is full, no slots are acquired.
func (p *SlotPool) AcquireBatch(requirements []ResourceRequirement, holderID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, req := range requirements {
		entry, ok := p.pools[req.SlotType]
		if !ok {
			return false
		}
		if entry.running+req.Count > entry.max {
			return false
		}
	}

	for _, req := range requirements {
		entry := p.pools[req.SlotType]
		for i := 0; i < req.Count; i++ {
			key := holderID
			if req.Count > 1 {
				key = holderID + "#" + intToStr(i)
			}
			entry.activeSlots[key] = true
			entry.heldSince[key] = time.Now().UnixMilli()
			entry.running++
		}
	}

	if len(requirements) > 0 {
		p.logger.Debug("Batch acquired", "holder", holderID)
	}
	return true
}

// Release frees all slots held by a holder for a specific slot type.
func (p *SlotPool) Release(slotType, holderID string) {
	p.mu.Lock()
	entry, ok := p.pools[slotType]
	if !ok {
		p.mu.Unlock()
		return
	}

	released := 0
	for key := range entry.activeSlots {
		if key == holderID || startsWith(key, holderID+"#") {
			delete(entry.activeSlots, key)
			delete(entry.heldSince, key)
			released++
		}
	}

	if released > 0 {
		entry.running -= released
		if entry.running < 0 {
			entry.running = 0
		}
		p.mu.Unlock()
		p.logger.Debug("Slot released", "slotType", slotType, "holder", holderID, "released", released)
		if p.schedulerCallback != nil {
			p.schedulerCallback(slotType)
		}
	} else {
		p.mu.Unlock()
	}
}

// ReleaseAll frees all slots held by a holder across all slot types.
func (p *SlotPool) ReleaseAll(holderID string) {
	p.mu.Lock()
	callbacks := []string{}
	for slotType, entry := range p.pools {
		released := 0
		for key := range entry.activeSlots {
			if key == holderID || startsWith(key, holderID+"#") {
				delete(entry.activeSlots, key)
				delete(entry.heldSince, key)
				released++
			}
		}
		if released > 0 {
			entry.running -= released
			if entry.running < 0 {
				entry.running = 0
			}
			callbacks = append(callbacks, slotType)
		}
	}
	p.mu.Unlock()

	for _, slotType := range callbacks {
		if p.schedulerCallback != nil {
			p.schedulerCallback(slotType)
		}
	}
}

// GetUsage returns the current usage for a slot type.
func (p *SlotPool) GetUsage(slotType string) *SlotUsage {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.pools[slotType]
	if !ok {
		return nil
	}
	return &SlotUsage{
		SlotType:  slotType,
		Current:  entry.running,
		Max:      entry.max,
		Available: entry.max - entry.running,
	}
}

// GetSnapshot returns usage for all registered slot types.
func (p *SlotPool) GetSnapshot() map[string]SlotUsage {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]SlotUsage, len(p.pools))
	for key, entry := range p.pools {
		out[key] = SlotUsage{
			SlotType:  key,
			Current:  entry.running,
			Max:      entry.max,
			Available: entry.max - entry.running,
		}
	}
	return out
}

// GetStats returns usage statistics for all slot types.
func (p *SlotPool) GetStats() map[string]SlotUsage {
	return p.GetSnapshot()
}

// UpdateMax changes the capacity of a slot type, persisting nothing.
func (p *SlotPool) UpdateMax(slotType string, newMax int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.pools[slotType]
	if !ok {
		return
	}
	if newMax < entry.definition.Min {
		newMax = entry.definition.Min
	}
	if newMax > entry.definition.Max {
		newMax = entry.definition.Max
	}
	entry.max = newMax
	p.logger.Info("Slot max updated", "slotType", slotType, "newMax", newMax)
	if p.schedulerCallback != nil {
		p.schedulerCallback(slotType)
	}
}

// CheckTimeouts releases slots held longer than the timeout, preventing
// slot leaks from crashed goroutines.
func (p *SlotPool) CheckTimeouts(timeoutMs int64) {
	p.mu.Lock()
	now := time.Now().UnixMilli()
	var toRelease []struct {
		slotType string
		holderID string
	}
	for slotType, entry := range p.pools {
		for holderID, since := range entry.heldSince {
			if now-since > timeoutMs {
				toRelease = append(toRelease, struct {
					slotType string
					holderID string
				}{slotType, holderID})
			}
		}
	}
	p.mu.Unlock()

	for _, item := range toRelease {
		p.Release(item.slotType, item.holderID)
	}
	if len(toRelease) > 0 {
		p.logger.Warn("Slot timeout released", "count", len(toRelease))
	}
}

// Reset clears all slot usage, used during startup recovery.
func (p *SlotPool) Reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, entry := range p.pools {
		entry.running = 0
		entry.activeSlots = make(map[string]bool)
		entry.heldSince = make(map[string]int64)
	}
	p.logger.Warn("All slots reset")
}

// GetActiveHolders returns the holder IDs for each slot type, stripping
// batch suffixes for a clean diagnostic view.
func (p *SlotPool) GetActiveHolders() map[string][]string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string][]string, len(p.pools))
	for slotType, entry := range p.pools {
		holders := make(map[string]bool)
		for key := range entry.activeSlots {
			base := key
			for i := 0; i < len(key); i++ {
				if key[i] == '#' {
					base = key[:i]
					break
				}
			}
			holders[base] = true
		}
		list := make([]string, 0, len(holders))
		for h := range holders {
			list = append(list, h)
		}
		out[slotType] = list
	}
	return out
}

// ResourceRequirement mirrors orchestrator.ResourceRequirement to avoid
// a circular import for the AcquireBatch call site in the scheduler.
type ResourceRequirement struct {
	SlotType  string
	Count     int
	HoldUntil string
}

// SlotUsage mirrors orchestrator.SlotUsage for the same reason.
type SlotUsage struct {
	SlotType  string
	Current  int
	Max      int
	Available int
}

func startsWith(s, prefix string) bool {
	if len(s) < len(prefix) {
		return false
	}
	return s[:len(prefix)] == prefix
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}
