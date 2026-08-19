package slot

import (
	"context"
	"testing"
	"time"
)

func newTestPool(t *testing.T) *SlotPool {
	t.Helper()
	p := NewSlotPool()
	p.RegisterType(SlotTypeDefinition{Key: "scraping", Label: "Scraping", DefaultMax: 3, Min: 1, Max: 5})
	p.RegisterType(SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 5, Min: 1, Max: 10})
	return p
}

func TestAcquireRelease(t *testing.T) {
	p := newTestPool(t)

	// scraping DefaultMax=3: three concurrent holders fit, fourth fails.
	if !p.Acquire("scraping", "dag-1:n1") {
		t.Fatal("expected acquire to succeed")
	}
	if !p.Acquire("scraping", "dag-1:n2") {
		t.Fatal("expected acquire to succeed")
	}
	if !p.Acquire("scraping", "dag-1:n3") {
		t.Fatal("expected acquire to succeed")
	}
	if p.Acquire("scraping", "dag-1:n4") {
		t.Fatal("expected acquire to fail at max")
	}

	usage := p.GetUsage("scraping")
	if usage.Current != 3 || usage.Max != 3 || usage.Available != 0 {
		t.Fatalf("unexpected usage: %+v", usage)
	}

	p.ReleaseAll("dag-1:n1")
	usage = p.GetUsage("scraping")
	if usage.Current != 2 {
		t.Fatalf("expected 2 after release, got %d", usage.Current)
	}
}

func TestAcquireBatchAtomic(t *testing.T) {
	p := newTestPool(t)

	reqs := []ResourceRequirement{
		{SlotType: "scraping", Count: 2},
		{SlotType: "download", Count: 1},
	}
	if !p.AcquireBatch(reqs, "dag-1:n1") {
		t.Fatal("expected batch acquire to succeed")
	}
	// Count==1 entries are keyed by holderID directly; Count>1 entries
	// carry "#i" suffixes, visible via GetActiveHolders.
	if !p.HasHolder("download", "dag-1:n1") {
		t.Fatal("expected holder to own the download slot")
	}
	holders := p.GetActiveHolders()["scraping"]
	found := false
	for _, h := range holders {
		if h == "dag-1:n1" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected holder to appear in scraping active holders")
	}

	// Second batch must fail atomically: download at max for dag-1 quota
	// would be fine, but scraping global max (3) is exceeded.
	bad := []ResourceRequirement{
		{SlotType: "scraping", Count: 2},
		{SlotType: "download", Count: 1},
	}
	if p.AcquireBatch(bad, "dag-1:n2") {
		t.Fatal("expected batch to fail when one type is exhausted")
	}
	// Nothing from the failed batch should have been acquired.
	if p.HasHolder("download", "dag-1:n2") {
		t.Fatal("failed batch must not leave partial acquisitions")
	}

	p.ReleaseAll("dag-1:n1")
}

func TestDagQuotaStrictlyBoundsConcurrency(t *testing.T) {
	p := newTestPool(t)

	// Task declares: at most 2 download slots at once.
	p.SetDagQuota("dag-1", map[string]int{"download": 2})

	// Two parallel download nodes fit under the quota.
	if !p.Acquire("download", "dag-1:n1") {
		t.Fatal("expected first download under quota")
	}
	if !p.Acquire("download", "dag-1:n2") {
		t.Fatal("expected second download under quota")
	}
	// Third exceeds the task quota even though the global max is 5.
	if p.Acquire("download", "dag-1:n3") {
		t.Fatal("expected third download to be rejected by dag quota")
	}
	// Other DAGs are unaffected by dag-1's quota.
	if !p.Acquire("download", "dag-2:n1") {
		t.Fatal("expected other DAG download to succeed")
	}

	if got := p.GetDagUsage("dag-1")["download"]; got != 2 {
		t.Fatalf("expected dag-1 usage 2, got %d", got)
	}

	// Release one slot, then the next dag-1 node may proceed.
	p.ReleaseAll("dag-1:n1")
	if !p.Acquire("download", "dag-1:n3") {
		t.Fatal("expected acquire after release under quota")
	}

	// Clearing the quota lifts the cap (global max still applies).
	p.ClearDagQuota("dag-1")
	if _, ok := p.GetDagQuota("dag-1")["download"]; ok {
		t.Fatal("expected quota row to be cleared")
	}
	if !p.Acquire("download", "dag-1:n4") {
		t.Fatal("expected acquire after quota cleared")
	}
}

func TestDagQuotaBatch(t *testing.T) {
	p := newTestPool(t)
	p.SetDagQuota("dag-1", map[string]int{"scraping": 2})

	reqs := []ResourceRequirement{{SlotType: "scraping", Count: 2}}
	if !p.AcquireBatch(reqs, "dag-1:n1") {
		t.Fatal("expected batch of 2 under quota 2")
	}
	// Quota exhausted: any further scrape for this DAG fails.
	if p.Acquire("scraping", "dag-1:n2") {
		t.Fatal("expected acquire beyond quota to fail")
	}
}

func TestStateChangeCallback(t *testing.T) {
	p := newTestPool(t)

	var events []SlotStateChange
	p.SetStateChangeCallback(func(c SlotStateChange) {
		events = append(events, c)
	})

	p.Acquire("scraping", "dag-1:n1")
	p.UpdateMax("scraping", 5)
	p.ReleaseAll("dag-1:n1")
	p.SetDagQuota("dag-1", map[string]int{"download": 1})
	p.ClearDagQuota("dag-1")

	if len(events) != 5 {
		t.Fatalf("expected 5 state events, got %d: %+v", len(events), events)
	}
	if events[0].Event != "acquire" || events[0].SlotType != "scraping" || events[0].DagID != "dag-1" {
		t.Fatalf("unexpected acquire event: %+v", events[0])
	}
	if events[1].Event != "max_updated" || events[1].Max != 5 {
		t.Fatalf("unexpected max event: %+v", events[1])
	}
	if events[2].Event != "release" {
		t.Fatalf("unexpected release event: %+v", events[2])
	}
	if events[3].Event != "dag_quota_set" || events[3].DagID != "dag-1" || events[3].Max != 1 {
		t.Fatalf("unexpected quota set event: %+v", events[3])
	}
	if events[4].Event != "dag_quota_cleared" {
		t.Fatalf("unexpected quota clear event: %+v", events[4])
	}
}

func TestUpdateMaxClamped(t *testing.T) {
	p := newTestPool(t)
	p.UpdateMax("scraping", 100) // above Max=5
	if u := p.GetUsage("scraping"); u.Max != 5 {
		t.Fatalf("expected max clamped to 5, got %d", u.Max)
	}
	p.UpdateMax("scraping", 0) // below Min=1
	if u := p.GetUsage("scraping"); u.Max != 1 {
		t.Fatalf("expected max clamped to 1, got %d", u.Max)
	}
}

func TestResetClearsDagUsage(t *testing.T) {
	p := newTestPool(t)
	p.SetDagQuota("dag-1", map[string]int{"download": 2})
	p.Acquire("download", "dag-1:n1")
	p.Reset()
	if got := p.GetDagUsage("dag-1")["download"]; got != 0 {
		t.Fatalf("expected dag usage cleared after reset, got %d", got)
	}
	if u := p.GetUsage("download"); u.Current != 0 {
		t.Fatalf("expected current 0 after reset, got %d", u.Current)
	}
}

func TestCheckTimeoutsReleasesStale(t *testing.T) {
	p := newTestPool(t)
	p.Acquire("scraping", "dag-1:n1")
	p.CheckTimeouts(-1) // everything older than -1ms is stale
	if u := p.GetUsage("scraping"); u.Current != 0 {
		t.Fatalf("expected stale slot released, got current %d", u.Current)
	}
}

// TestReleaseSelfHealsCounter verifies the P-SLOT-01 guard: when the
// running counter drifts from len(activeSlots), Release re-syncs it and
// warns instead of silently leaving ghost slots.
func TestReleaseSelfHealsCounter(t *testing.T) {
	p := newTestPool(t)
	p.Acquire("scraping", "dag-1:n1")
	p.Acquire("scraping", "dag-1:n2")

	// Simulate the 08-03 ghost-slot state: counter claims 3 while the
	// activeSlots map holds a single entry (running=3 vs holder count=1).
	entry := p.pools["scraping"]
	entry.running = 3
	delete(entry.activeSlots, "dag-1:n2")

	p.ReleaseAll("dag-1:n1")

	usage := p.GetUsage("scraping")
	if usage.Current != 0 {
		t.Fatalf("expected self-healed current 0 after releasing last holder, got %d", usage.Current)
	}
}

// TestReleaseAllSelfHealsMultiType verifies the guard across multiple
// slot types in one ReleaseAll sweep.
func TestReleaseAllSelfHealsMultiType(t *testing.T) {
	p := newTestPool(t)
	p.Acquire("scraping", "dag-1:n1")
	p.Acquire("download", "dag-1:n1")

	// Drift both counters upward to simulate ghost slots.
	p.pools["scraping"].running = 2 // actual 1
	p.pools["download"].running = 3 // actual 1

	p.ReleaseAll("dag-1:n1")

	if u := p.GetUsage("scraping"); u.Current != 0 {
		t.Fatalf("scraping not self-healed, current=%d", u.Current)
	}
	if u := p.GetUsage("download"); u.Current != 0 {
		t.Fatalf("download not self-healed, current=%d", u.Current)
	}
}

// TestHealInconsistenciesSweep verifies the periodic health-check sweep
// re-syncs a drifted counter even when no release happens.
func TestHealInconsistenciesSweep(t *testing.T) {
	p := newTestPool(t)
	p.Acquire("scraping", "dag-1:n1")

	// Desync the counter directly (no release involved): running=5,
	// activeSlots=1 -> the sweep must fix it.
	p.pools["scraping"].running = 5

	fixed := p.healInconsistencies()
	if fixed != 1 {
		t.Fatalf("expected 1 fixed slot type, got %d", fixed)
	}
	if u := p.GetUsage("scraping"); u.Current != 1 {
		t.Fatalf("expected current 1 after sweep, got %d", u.Current)
	}
	// Second sweep is a no-op.
	if fixed := p.healInconsistencies(); fixed != 0 {
		t.Fatalf("expected 0 fixed on second sweep, got %d", fixed)
	}
}

// TestStartHealthCheckCancel verifies the periodic health check exits on
// context cancellation without touching holders when timeout is disabled.
func TestStartHealthCheckCancel(t *testing.T) {
	p := newTestPool(t)
	p.Acquire("scraping", "dag-1:n1")

	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		p.StartHealthCheck(ctx, 10*time.Millisecond, -1) // fast tick, timeout disabled
		close(done)
	}()
	// Give the ticker a couple of cycles, then cancel and wait exit.
	time.Sleep(60 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("StartHealthCheck did not exit after cancel")
	}
	if u := p.GetUsage("scraping"); u.Current != 1 {
		t.Fatalf("holder should remain when timeout disabled, got current %d", u.Current)
	}
}
