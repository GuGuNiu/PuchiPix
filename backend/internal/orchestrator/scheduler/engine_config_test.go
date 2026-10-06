package scheduler

import (
	"testing"
	"time"

	"backend/internal/orchestrator/slot"
)

// Locks in the runtime-tunable scheduling params: defaults must match the
// hardcoded values, setters must validate ranges, and updates must be
// visible through GetSchedulerConfig without any lock coordination.
func newTestEngine() *SchedulerEngine {
	return NewSchedulerEngine(slot.NewSlotPool())
}

func TestSchedulerConfigDefaults(t *testing.T) {
	cfg := newTestEngine().GetSchedulerConfig()

	if cfg.StarvationThreshold != 30*time.Minute {
		t.Fatalf("default starvation threshold = %v, want 30m", cfg.StarvationThreshold)
	}
	if cfg.StarvationLotteryRate != 0.1 {
		t.Fatalf("default lottery rate = %v, want 0.1", cfg.StarvationLotteryRate)
	}
	if cfg.MaxScheduleIterations != 256 {
		t.Fatalf("default max iterations = %d, want 256", cfg.MaxScheduleIterations)
	}
}

func TestSetStarvationThresholdValidation(t *testing.T) {
	s := newTestEngine()

	for _, invalid := range []time.Duration{0, -time.Minute, 25 * time.Hour} {
		if s.SetStarvationThreshold(invalid) {
			t.Fatalf("threshold %v must be rejected", invalid)
		}
	}
	if !s.SetStarvationThreshold(time.Hour) {
		t.Fatal("1h threshold must be accepted")
	}
	if got := s.GetSchedulerConfig().StarvationThreshold; got != time.Hour {
		t.Fatalf("threshold = %v, want 1h", got)
	}
}

func TestSetStarvationLotteryRateValidation(t *testing.T) {
	s := newTestEngine()

	for _, invalid := range []float64{-0.1, 1.01, 2} {
		if s.SetStarvationLotteryRate(invalid) {
			t.Fatalf("rate %v must be rejected", invalid)
		}
	}
	if !s.SetStarvationLotteryRate(0.5) {
		t.Fatal("rate 0.5 must be accepted")
	}
	if got := s.GetSchedulerConfig().StarvationLotteryRate; got != 0.5 {
		t.Fatalf("rate = %v, want 0.5", got)
	}
}

func TestSetMaxScheduleIterationsValidation(t *testing.T) {
	s := newTestEngine()

	if s.SetMaxScheduleIterations(0) || s.SetMaxScheduleIterations(-1) {
		t.Fatal("non-positive iteration caps must be rejected")
	}
	if !s.SetMaxScheduleIterations(64) {
		t.Fatal("cap 64 must be accepted")
	}
	if got := s.GetSchedulerConfig().MaxScheduleIterations; got != 64 {
		t.Fatalf("cap = %d, want 64", got)
	}
}

// The default lottery closure must read the atomic rate so hot updates
// change the actual promotion probability without replacing the
// (test-injectable) closure.
func TestLotteryClosureFollowsRateUpdates(t *testing.T) {
	s := newTestEngine()

	// Rate 0 means the lottery never fires.
	s.SetStarvationLotteryRate(0)
	for i := 0; i < 200; i++ {
		if s.lotteryFunc() {
			t.Fatal("lottery fired with rate 0")
		}
	}

	// Rate 1 means the lottery always fires.
	s.SetStarvationLotteryRate(1)
	for i := 0; i < 200; i++ {
		if !s.lotteryFunc() {
			t.Fatal("lottery did not fire with rate 1")
		}
	}
}
