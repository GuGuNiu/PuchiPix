package slot

import (
	"strings"
	"sync"
	"time"

	"backend/internal/infra"
)

// SlotStateChange describes a slot pool state mutation for real-time
// SSE notification. Emitted (via SetStateChangeCallback) outside the
// pool lock so subscribers never block acquisition paths.
type SlotStateChange struct {
	// Event is one of: "acquire", "release", "max_updated",
	// "dag_quota_set", "dag_quota_cleared".
	Event     string
	SlotType  string
	Current   int
	Max       int
	Available int
	// DagID is the task-level quota scope (empty for global-only changes).
	DagID    string
	HolderID string
}

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
// Beyond the global per-type max, SlotPool enforces optional per-DAG
// quotas: a task may declare how many slots of each type it may occupy
// at once (e.g. "download": 2), strictly bounding that task's footprint
// regardless of global capacity. Quotas are set via SetDagQuota.
type SlotPool struct {
	mu               sync.Mutex
	pools            map[string]*slotEntry
	schedulerCallback func(slotType string)
	// dagQuotas maps dagID -> slotType -> quota. A value <= 0 means the
	// task has no quota for that slot type (unlimited within the global
	// max). SetDagQuota merges entries; ClearDagQuota removes a task's
	// entire quota row.
	dagQuotas map[string]map[string]int
	// dagUsage tracks how many slots of each type each DAG currently
	// holds, kept in sync with activeSlots so quota checks are O(1).
	dagUsage map[string]map[string]int
	// stateChangeCallback receives SlotStateChange notifications for
	// real-time SSE streaming of slot occupancy.
	stateChangeCallback func(change SlotStateChange)
	logger              *infra.Logger
}

// NewSlotPool creates an empty pool. Slot types must be registered
// via RegisterType before use.
func NewSlotPool() *SlotPool {
	return &SlotPool{
		pools:     make(map[string]*slotEntry),
		dagQuotas: make(map[string]map[string]int),
		dagUsage:  make(map[string]map[string]int),
		logger:    infra.NewLogger("SlotPool"),
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

// SetStateChangeCallback installs a callback invoked (outside the pool
// lock) on every state mutation: acquire, release, max update, and
// per-DAG quota changes. Used to stream slot occupancy over SSE.
func (p *SlotPool) SetStateChangeCallback(cb func(change SlotStateChange)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stateChangeCallback = cb
}

// emitStateChange fires the state-change callback outside the lock.
func (p *SlotPool) emitStateChange(change SlotStateChange) {
	if p.stateChangeCallback != nil {
		p.stateChangeCallback(change)
	}
}

// dagIDOf extracts the DAG scope from a holder ID ("dagID:nodeID").
// Returns "" when the holder ID carries no DAG prefix (no quota scope).
func dagIDOf(holderID string) string {
	i := strings.IndexByte(holderID, ':')
	if i < 0 {
		return ""
	}
	return holderID[:i]
}

// SetDagQuota establishes (or merges) per-slot-type quotas for a DAG.
// Each value is the maximum number of slots of that type the task may
// hold simultaneously; values <= 0 remove the quota for that type.
// Quotas are enforced on top of the global per-type max.
func (p *SlotPool) SetDagQuota(dagID string, limits map[string]int) {
	if dagID == "" || len(limits) == 0 {
		return
	}
	p.mu.Lock()
	row, exists := p.dagQuotas[dagID]
	if !exists {
		row = make(map[string]int)
		p.dagQuotas[dagID] = row
	}
	for slotType, quota := range limits {
		if quota <= 0 {
			delete(row, slotType)
		} else {
			row[slotType] = quota
		}
	}
	if len(row) == 0 {
		delete(p.dagQuotas, dagID)
	}
	p.mu.Unlock()

	for slotType, quota := range limits {
		if quota <= 0 {
			continue
		}
		p.emitStateChange(SlotStateChange{
			Event:     "dag_quota_set",
			SlotType:  slotType,
			DagID:     dagID,
			Max:       quota,
			Available: p.dagAvailableFor(dagID, slotType),
		})
	}
}

// ClearDagQuota removes a DAG's entire quota row, lifting task-level
// caps so the task falls back to global per-type limits. In-flight
// holders are unaffected (they release normally).
func (p *SlotPool) ClearDagQuota(dagID string) {
	if dagID == "" {
		return
	}
	p.mu.Lock()
	row, exists := p.dagQuotas[dagID]
	if !exists {
		p.mu.Unlock()
		return
	}
	delete(p.dagQuotas, dagID)
	slotTypes := make([]string, 0, len(row))
	for slotType := range row {
		slotTypes = append(slotTypes, slotType)
	}
	p.mu.Unlock()

	for _, slotType := range slotTypes {
		p.emitStateChange(SlotStateChange{
			Event:    "dag_quota_cleared",
			SlotType: slotType,
			DagID:    dagID,
		})
	}
}

// GetDagQuota returns a copy of a DAG's quota row (empty when unset).
func (p *SlotPool) GetDagQuota(dagID string) map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]int, len(p.dagQuotas[dagID]))
	for k, v := range p.dagQuotas[dagID] {
		out[k] = v
	}
	return out
}

// GetDagUsage returns a copy of the slots currently held by a DAG.
func (p *SlotPool) GetDagUsage(dagID string) map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]int, len(p.dagUsage[dagID]))
	for k, v := range p.dagUsage[dagID] {
		out[k] = v
	}
	return out
}

// dagAvailableFor returns how many more slots of a type a DAG may hold
// under its quota (or -1 when no quota applies). Caller holds no lock.
func (p *SlotPool) dagAvailableFor(dagID, slotType string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	quota, ok := p.dagQuotas[dagID][slotType]
	if !ok {
		return -1
	}
	used := p.dagUsage[dagID][slotType]
	return quota - used
}

// quotaAllowsLocked checks the per-DAG quota for an acquisition of
// count slots of the given type. Caller must hold p.mu.
func (p *SlotPool) quotaAllowsLocked(dagID, slotType string, count int) bool {
	if dagID == "" {
		return true
	}
	quota, ok := p.dagQuotas[dagID][slotType]
	if !ok {
		return true // no quota for this type
	}
	used := p.dagUsage[dagID][slotType]
	return used+count <= quota
}

// bumpDagUsageLocked records a DAG's additional held slots. Caller
// must hold p.mu.
func (p *SlotPool) bumpDagUsageLocked(dagID, slotType string, delta int) {
	if dagID == "" {
		return
	}
	row := p.dagUsage[dagID]
	if row == nil {
		if delta <= 0 {
			return
		}
		row = make(map[string]int)
		p.dagUsage[dagID] = row
	}
	row[slotType] += delta
	if row[slotType] <= 0 {
		delete(row, slotType)
	}
	if len(row) == 0 {
		delete(p.dagUsage, dagID)
	}
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
// on success or if the holder already owns a slot. Per-DAG quotas are
// enforced alongside the global max.
func (p *SlotPool) Acquire(slotType, holderID string) bool {
	p.mu.Lock()
	entry, ok := p.pools[slotType]
	if !ok {
		p.mu.Unlock()
		p.logger.Error("Slot type not found", "slotType", slotType)
		return false
	}

	if entry.activeSlots[holderID] {
		p.mu.Unlock()
		return true
	}

	dagID := dagIDOf(holderID)
	if entry.running >= entry.max || !p.quotaAllowsLocked(dagID, slotType, 1) {
		p.mu.Unlock()
		return false
	}

	entry.activeSlots[holderID] = true
	entry.running++
	entry.heldSince[holderID] = time.Now().UnixMilli()
	p.bumpDagUsageLocked(dagID, slotType, 1)
	usage := SlotUsage{SlotType: slotType, Current: entry.running, Max: entry.max, Available: entry.max - entry.running}
	p.mu.Unlock()
	p.emitStateChange(SlotStateChange{
		Event: "acquire", SlotType: slotType, HolderID: holderID, DagID: dagID,
		Current: usage.Current, Max: usage.Max, Available: usage.Available,
	})
	p.logger.Debug("Slot acquired", "slotType", slotType, "holder", holderID, "current", entry.running, "max", entry.max)
	return true
}

// AcquireBatch attempts to acquire multiple slot types atomically.
// If any type is full, no slots are acquired. Per-DAG quotas are
// enforced alongside the global max.
func (p *SlotPool) AcquireBatch(requirements []ResourceRequirement, holderID string) bool {
	p.mu.Lock()

	dagID := dagIDOf(holderID)
	for _, req := range requirements {
		entry, ok := p.pools[req.SlotType]
		if !ok {
			p.mu.Unlock()
			return false
		}
		if entry.running+req.Count > entry.max {
			p.mu.Unlock()
			return false
		}
		if !p.quotaAllowsLocked(dagID, req.SlotType, req.Count) {
			p.mu.Unlock()
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
		p.bumpDagUsageLocked(dagID, req.SlotType, req.Count)
	}
	p.mu.Unlock()

	if len(requirements) > 0 {
		for _, req := range requirements {
			p.emitStateChange(SlotStateChange{
				Event: "acquire", SlotType: req.SlotType, HolderID: holderID, DagID: dagID,
			})
		}
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

	dagID := dagIDOf(holderID)
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
		p.bumpDagUsageLocked(dagID, slotType, -released)
		usage := SlotUsage{SlotType: slotType, Current: entry.running, Max: entry.max, Available: entry.max - entry.running}
		p.mu.Unlock()
		p.logger.Debug("Slot released", "slotType", slotType, "holder", holderID, "released", released)
		p.emitStateChange(SlotStateChange{
			Event: "release", SlotType: slotType, HolderID: holderID, DagID: dagID,
			Current: usage.Current, Max: usage.Max, Available: usage.Available,
		})
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
	releasedByType := map[string]int{}
	callbacks := []string{}
	dagID := dagIDOf(holderID)
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
			releasedByType[slotType] = released
		}
	}
	for slotType, released := range releasedByType {
		p.bumpDagUsageLocked(dagID, slotType, -released)
	}
	p.mu.Unlock()

	for _, slotType := range callbacks {
		if p.schedulerCallback != nil {
			p.schedulerCallback(slotType)
		}
	}
	if len(releasedByType) > 0 {
		p.emitStateChange(SlotStateChange{
			Event: "release", HolderID: holderID, DagID: dagID,
		})
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
	entry, ok := p.pools[slotType]
	if !ok {
		p.mu.Unlock()
		return
	}
	if newMax < entry.definition.Min {
		newMax = entry.definition.Min
	}
	if newMax > entry.definition.Max {
		newMax = entry.definition.Max
	}
	entry.max = newMax
	usage := SlotUsage{SlotType: slotType, Current: entry.running, Max: entry.max, Available: entry.max - entry.running}
	p.mu.Unlock()
	p.logger.Info("Slot max updated", "slotType", slotType, "newMax", newMax)
	p.emitStateChange(SlotStateChange{
		Event: "max_updated", SlotType: slotType,
		Current: usage.Current, Max: usage.Max, Available: usage.Available,
	})
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
	p.dagUsage = make(map[string]map[string]int)
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
