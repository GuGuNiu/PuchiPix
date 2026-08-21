package orchestrator

import "testing"

// TestStatusReporterMapsActiveStates verifies the core fix: only nodes
// that actually entered the scheduling queue (QUEUED/ALLOCATED/RUNNING)
// map to in-progress entity statuses, while scheduler-rejected nodes
// (READY) map back to "pending" — the "全部启动识别/满仓" false-status
// defect is gone.
func TestStatusReporterMapsActiveStates(t *testing.T) {
	r := NewStatusReporter()

	cases := []struct {
		name  string
		def   DagNodeDefinition
		state NodeState
		want  string
		ok    bool
	}{
		{
			name:  "video scrape queued -> scraping",
			def:   DagNodeDefinition{Executor: "video:scrape", Phase: PhaseScrape},
			state: NodeStateQueued,
			want:  "scraping", ok: true,
		},
		{
			name:  "video scrape running -> scraping",
			def:   DagNodeDefinition{Executor: "video:scrape", Phase: PhaseScrape},
			state: NodeStateRunning,
			want:  "scraping", ok: true,
		},
		{
			name:  "gallery scrape allocated -> scraping",
			def:   DagNodeDefinition{Executor: "scrape", Phase: PhaseScrape},
			state: NodeStateAllocated,
			want:  "scraping", ok: true,
		},
		{
			name:  "video download running -> downloading",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStateRunning,
			want:  "downloading", ok: true,
		},
		{
			name:  "gallery download queued -> downloading",
			def:   DagNodeDefinition{Executor: "download", Phase: PhaseDownload},
			state: NodeStateQueued,
			want:  "downloading", ok: true,
		},
		{
			name:  "sniff running -> sniffing",
			def:   DagNodeDefinition{Executor: "sniff", Phase: PhaseScrape},
			state: NodeStateRunning,
			want:  "sniffing", ok: true,
		},
		{
			name:  "rejected node rolled back to ready -> pending",
			def:   DagNodeDefinition{Executor: "video:scrape", Phase: PhaseScrape},
			state: NodeStateReady,
			want:  "pending", ok: true,
		},
		{
			name:  "pending -> pending",
			def:   DagNodeDefinition{Executor: "video:scrape", Phase: PhaseScrape},
			state: NodeStatePending,
			want:  "pending", ok: true,
		},
		{
			name:  "paused -> paused",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStatePaused,
			want:  "paused", ok: true,
		},
		{
			name:  "completed -> completed",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStateCompleted,
			want:  "completed", ok: true,
		},
		{
			name:  "failed -> failed",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStateFailed,
			want:  "failed", ok: true,
		},
		{
			name:  "timeout -> failed",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStateTimeout,
			want:  "failed", ok: true,
		},
		{
			name:  "cancelled -> cancelled",
			def:   DagNodeDefinition{Executor: "video:download", Phase: PhaseDownload},
			state: NodeStateCancelled,
			want:  "cancelled", ok: true,
		},
		{
			name:  "extract running keeps downloading",
			def:   DagNodeDefinition{Executor: "extract", Phase: PhaseFinalize},
			state: NodeStateRunning,
			want:  "downloading", ok: true,
		},
		{
			name:  "verifying is internal, no write",
			def:   DagNodeDefinition{Executor: "verify", Phase: PhaseFinalize},
			state: NodeStateVerifying,
			want:  "", ok: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := r.MapNodeToEntityStatus(tc.def, tc.state)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("MapNodeToEntityStatus(%s) = (%q, %v), want (%q, %v)",
					tc.state, got, ok, tc.want, tc.ok)
			}
		})
	}
}

// TestStatusReporterNoTerminalRegression guards the "completed is written
// by executors" contract: the reporter still maps completed so callers
// can decide, but the server-side sync fn skips it.
func TestStatusReporterCompletedMapping(t *testing.T) {
	r := NewStatusReporter()
	got, ok := r.MapNodeToEntityStatus(
		DagNodeDefinition{Executor: "download", Phase: PhaseDownload},
		NodeStateCompleted)
	if !ok || got != "completed" {
		t.Fatalf("completed should map to completed, got %q ok=%v", got, ok)
	}
}
