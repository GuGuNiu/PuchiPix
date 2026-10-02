package taskstate

import (
	"context"
	"sort"
	"testing"
)

// graphEdges derives the from→to edge set from legalFrom (target → sources).
func graphEdges() map[string][]string {
	edges := make(map[string][]string)
	for to, froms := range legalFrom {
		for _, from := range froms {
			edges[from] = append(edges[from], to)
		}
	}
	for from := range edges {
		sort.Strings(edges[from])
	}
	return edges
}

// TestTransitionTableModelWellFormed: every status referenced anywhere in the
// table is one of the defined constants — a typo would silently create an
// unreachable pseudo-state.
func TestTransitionTableModelWellFormed(t *testing.T) {
	known := map[string]bool{}
	for _, s := range []string{
		StatusPending, StatusScraping, StatusDownloading, StatusMerging,
		StatusTranscoding, StatusProbing, StatusCompleted, StatusFailed,
		StatusCancelled, StatusPaused,
	} {
		known[s] = true
	}
	for to, froms := range legalFrom {
		if !known[to] {
			t.Errorf("target %q is not a defined status", to)
		}
		for _, from := range froms {
			if !known[from] {
				t.Errorf("source %q (for target %q) is not a defined status", from, to)
			}
		}
	}
	for _, s := range ActiveStatuses() {
		if !known[s] {
			t.Errorf("ActiveStatuses entry %q is not a defined status", s)
		}
	}
}

// TestTransitionTableModelReachable: every status is reachable from pending —
// a status that cannot be entered is dead model weight (or, worse, a sign
// that a real pipeline path writes it outside the table).
func TestTransitionTableModelReachable(t *testing.T) {
	edges := graphEdges()
	seen := map[string]bool{StatusPending: true}
	queue := []string{StatusPending}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, next := range edges[cur] {
			if !seen[next] {
				seen[next] = true
				queue = append(queue, next)
			}
		}
	}
	for status := range legalFrom {
		if !seen[status] {
			t.Errorf("status %q is unreachable from pending", status)
		}
	}
}

// TestTransitionTableModelTerminalReachable: every non-terminal status can
// still reach a terminal status — no dead ends where a task could get stuck
// with no way (user action or pipeline step) out.
func TestTransitionTableModelTerminalReachable(t *testing.T) {
	edges := graphEdges()
	terminal := map[string]bool{StatusCompleted: true, StatusFailed: true, StatusCancelled: true}

	var reachesTerminal func(from string, seen map[string]bool) bool
	reachesTerminal = func(from string, seen map[string]bool) bool {
		if terminal[from] {
			return true
		}
		if seen[from] {
			return false
		}
		seen[from] = true
		for _, next := range edges[from] {
			if reachesTerminal(next, seen) {
				return true
			}
		}
		return false
	}

	for status := range legalFrom {
		if terminal[status] {
			continue
		}
		if !reachesTerminal(status, map[string]bool{}) {
			t.Errorf("status %q cannot reach any terminal status (dead end)", status)
		}
	}
}

// TestTransitionModelUserActionCoverage: from every ACTIVE pipeline phase the
// user-action targets (paused / failed / cancelled) and the auto-retry target
// (pending) must be directly reachable. A missing edge here is exactly how a
// pipeline failure or user action deadlocks the row — the auto-retry edges
// from downloading/merging/transcoding → pending were once missing and every
// mid-pipeline failure stranded the task.
func TestTransitionModelUserActionCoverage(t *testing.T) {
	active := []string{StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing}
	required := []string{StatusPaused, StatusFailed, StatusCancelled}
	for _, from := range active {
		for _, to := range required {
			if !CanTransition(from, to) {
				t.Errorf("user action %s → %s is not legal", from, to)
			}
		}
		if from == StatusScraping {
			// The scrape phase is driven by DAG status sync (raw SQL by seq),
			// not by the download manager's auto-retry, so pending is not
			// required here.
			continue
		}
		if !CanTransition(from, StatusPending) {
			t.Errorf("auto-retry %s → pending is not legal", from)
		}
	}
}

// TestTransitionModelCompletedIsSink: completed must have no outgoing edges
// (self-loops are idempotent re-entry, not a transition) — nothing may move a
// finished task back into the pipeline.
func TestTransitionModelCompletedIsSink(t *testing.T) {
	edges := graphEdges()
	for _, to := range edges[StatusCompleted] {
		if to != StatusCompleted {
			t.Errorf("completed must be a sink, has outgoing edge to %q", to)
		}
	}
}

// TestTransitionModelRecoveryCoversActives: crash recovery resets exactly the
// mid-pipeline statuses to paused, and paused must be resumable
// (paused → downloading), otherwise recovery would create unrecoverable rows.
func TestTransitionModelRecoveryCoversActives(t *testing.T) {
	nonTerminal := map[string]bool{}
	for status := range legalFrom {
		nonTerminal[status] = true
	}
	delete(nonTerminal, StatusCompleted)
	delete(nonTerminal, StatusFailed)
	delete(nonTerminal, StatusCancelled)
	// paused is itself the recovery target: it is already recovery-stable.
	delete(nonTerminal, StatusPaused)

	recoverSet := map[string]bool{}
	for _, s := range ActiveStatuses() {
		recoverSet[s] = true
		if !CanTransition(s, StatusPaused) {
			t.Errorf("recovery target: %s → paused must be legal", s)
		}
	}
	// pending is not in the recovery set (it needs no rescue), everything
	// else non-terminal must be.
	if recoverSet[StatusPending] {
		t.Error("pending must not be in the recovery set")
	}
	for status := range nonTerminal {
		if status == StatusPending {
			continue
		}
		if !recoverSet[status] {
			t.Errorf("non-terminal status %q is missing from ActiveStatuses recovery", status)
		}
	}
	if !CanTransition(StatusPaused, StatusDownloading) {
		t.Error("paused must be resumable (paused → downloading)")
	}
}

// TestTransitionEmitsExactlyOneEventPerStep: a full pipeline walk emits one
// task:progress event per transition — the "missed event" class of bugs is
// structurally impossible as long as this holds.
func TestTransitionEmitsExactlyOneEventPerStep(t *testing.T) {
	store, database, bus := newTestStore(t)
	id := insertTask(t, database, StatusPending)

	var events []string
	unsub := bus.On("task:progress", func(payload any) {
		if m, ok := payload.(map[string]any); ok {
			if s, ok := m["status"].(string); ok {
				events = append(events, s)
			}
		}
	})
	defer unsub()

	ctx := context.Background()
	pct := 0.0
	steps := []struct {
		status string
		withP  bool
	}{
		{StatusDownloading, true},
		{StatusMerging, true},
		{StatusTranscoding, true},
		{StatusProbing, true},
		{StatusCompleted, true},
	}
	for i, step := range steps {
		u := Update{Status: step.status}
		if step.withP {
			u.Progress = &pct
		}
		if err := store.Transition(ctx, id, u); err != nil {
			t.Fatalf("step %d (%s): %v", i, step.status, err)
		}
	}
	if len(events) != len(steps) {
		t.Fatalf("emitted %d events for %d transitions: %v", len(events), len(steps), events)
	}
	for i, ev := range events {
		if ev != steps[i].status {
			t.Errorf("event %d = %q, want %q", i, ev, steps[i].status)
		}
	}
}

// TestTransitionIdempotentAppliesProgress: an idempotent re-entry (row
// already in the target status) must not silently drop the caller's progress
// write.
func TestTransitionIdempotentAppliesProgress(t *testing.T) {
	store, database, _ := newTestStore(t)
	id := insertTask(t, database, StatusTranscoding)

	pct := 42.0
	if err := store.Transition(context.Background(), id, Update{
		Status:   StatusTranscoding,
		Progress: &pct,
	}); err != nil {
		t.Fatalf("idempotent transition: %v", err)
	}
	var progress float64
	if err := database.QueryRow(context.Background(),
		"SELECT progress FROM download_tasks WHERE id = ?", id).Scan(&progress); err != nil {
		t.Fatal(err)
	}
	if progress != 42.0 {
		t.Fatalf("progress = %v, want 42 (idempotent path must apply Progress)", progress)
	}
}
