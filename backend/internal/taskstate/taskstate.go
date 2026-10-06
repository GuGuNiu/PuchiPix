// Package taskstate is the single transition authority for the video task
// entity status (download_tasks.status). Every pipeline status write goes
// through Store.Transition so that:
//
//   - transitions are validated against one explicit table instead of being
//     scattered across raw SQL statements,
//   - writes are atomic conditional updates (WHERE status IN legal-from-set),
//     so a concurrent pause/cancel always wins over pipeline progression,
//   - each status change emits exactly one task:progress event, closing the
//     "missed event" gaps that previously needed guard-rail healing.
package taskstate

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// Video task entity statuses (download_tasks.status). "probing" is a real
// persisted status: it covers the duration/resolution probe window between
// "transcode finished" and "completed", replacing the old
// status=='transcoding' && progress>=100 convention.
const (
	StatusPending     = "pending"
	StatusScraping    = "scraping"
	StatusDownloading = "downloading"
	StatusMerging     = "merging"
	StatusTranscoding = "transcoding"
	StatusProbing     = "probing"
	StatusCompleted   = "completed"
	StatusFailed      = "failed"
	StatusCancelled   = "cancelled"
	StatusPaused      = "paused"
)

// ProgressTerminal is the terminal phase-progress value. Live transcode
// events are clamped below it by the ffmpeg parser; exactly 100 marks the
// end of a phase.
const ProgressTerminal = 100

// legalFrom maps every target status to the set of source statuses a
// transition may start from. The pipeline writes move down the happy path
// pending → downloading → merging → transcoding → probing → completed, and
// the branches cover user actions (pause/cancel/retry), auto-retry, and
// crash recovery.
var legalFrom = map[string][]string{
	// Pending is reachable from the active pipeline phases: the download
	// manager's auto-retry writes pending after a mid-pipeline failure
	// (downloading/merging/transcoding) to put the task back in the queue.
	StatusPending:     {StatusPending, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing, StatusFailed, StatusCancelled, StatusPaused},
	StatusScraping:    {StatusPending, StatusScraping},
	StatusDownloading: {StatusPending, StatusScraping, StatusDownloading, StatusPaused, StatusMerging},
	StatusMerging:     {StatusDownloading, StatusMerging},
	StatusTranscoding: {StatusDownloading, StatusMerging, StatusTranscoding},
	StatusProbing:     {StatusTranscoding, StatusProbing},
	StatusCompleted:   {StatusPending, StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing, StatusPaused, StatusFailed, StatusCompleted},
	StatusFailed:      {StatusPending, StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing, StatusPaused, StatusFailed},
	StatusCancelled:   {StatusPending, StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing, StatusPaused, StatusFailed, StatusCancelled},
	StatusPaused:      {StatusPending, StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing, StatusPaused},
}

// CanTransition reports whether from→to is a legal video entity transition.
// Equal states count as legal (idempotent re-apply).
func CanTransition(from, to string) bool {
	for _, src := range legalFrom[to] {
		if src == from {
			return true
		}
	}
	return false
}

// ActiveStatuses lists the mid-pipeline statuses a crashed process can leave
// behind; recovery resets them to paused.
func ActiveStatuses() []string {
	return []string{StatusScraping, StatusDownloading, StatusMerging, StatusTranscoding, StatusProbing}
}

// ConflictError reports that the row moved to a different status between the
// caller's read and the conditional update — another writer (pause/cancel
// from the API, DAG status sync) owns the row now.
type ConflictError struct {
	TaskID   int
	Current  string
	Expected []string
	Target   string
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("task %d transition to %q blocked: row is %q (legal from %s)",
		e.TaskID, e.Target, e.Current, strings.Join(e.Expected, ","))
}

// Update describes one transition: the target status plus optional extra
// column writes applied in the same statement.
type Update struct {
	Status string
	// Progress, when set, is written to the progress column in the same
	// update and included in the emitted event payload.
	Progress *float64
	// Set holds extra column writes (file_path, format, completed_segments,
	// error_msg...). Column names must be whitelisted in updateColumns.
	Set map[string]any
}

// updateColumns whitelists every column a Transition may write, so column
// names can be interpolated into SQL safely (values are parameterized).
var updateColumns = map[string]bool{
	"progress":           true,
	"error_msg":          true,
	"file_path":          true,
	"format":             true,
	"file_size":          true,
	"completed_segments": true,
	"total_segments":     true,
}

// Store is the transition authority. It is safe for concurrent use.
type Store struct {
	db  *db.Database
	bus *infra.EventBus
	log *infra.Logger

	mu    sync.Mutex
	marks map[int]progressMark
}

// progressMark throttles phase-progress persistence (merging/transcoding
// percentages): one DB write per task per interval unless the percentage
// jumped or reached the terminal value.
type progressMark struct {
	at time.Time
	pc float64
}

const (
	progressMinInterval = 2 * time.Second
	progressMinJump     = 5.0
)

func NewStore(database *db.Database, bus *infra.EventBus) *Store {
	return &Store{
		db:    database,
		bus:   bus,
		log:   infra.NewLogger("TaskState"),
		marks: make(map[int]progressMark),
	}
}

// Current returns the row's current status. The returned error wraps
// sql.ErrNoRows when the row is gone.
func (s *Store) Current(ctx context.Context, taskID int) (string, error) {
	var status string
	err := s.db.QueryRow(ctx, "SELECT status FROM download_tasks WHERE id = ?", taskID).Scan(&status)
	if err != nil {
		return "", err
	}
	return status, nil
}

// Transition applies u atomically: UPDATE ... WHERE id = ? AND status IN
// (legal-from-set). On success it emits exactly one task:progress event
// carrying the new status. If the row already holds the target status the
// extra Set columns are still applied (idempotent). If the row moved to a
// different status concurrently, a *ConflictError is returned and nothing is
// written — the concurrent writer (user pause/cancel) wins.
func (s *Store) Transition(ctx context.Context, taskID int, u Update) error {
	if legalFrom[u.Status] == nil {
		return fmt.Errorf("task %d: unknown target status %q", taskID, u.Status)
	}

	n, err := s.execTransition(ctx, taskID, u)
	if err != nil {
		return err
	}
	if n == 0 {
		current, readErr := s.Current(ctx, taskID)
		if readErr != nil {
			// Row deleted mid-pipeline: nothing to transition.
			return nil
		}
		if current != u.Status {
			return &ConflictError{TaskID: taskID, Current: current, Expected: legalFrom[u.Status], Target: u.Status}
		}
		// Idempotent: already in the target state; apply Progress and the
		// extra columns only (an idempotent re-entry must not silently drop
		// the caller's progress write).
		set := u.Set
		if u.Progress != nil {
			merged := make(map[string]any, len(u.Set)+1)
			for k, v := range u.Set {
				merged[k] = v
			}
			merged["progress"] = *u.Progress
			set = merged
		}
		if len(set) > 0 {
			if _, err := s.execSet(ctx, taskID, set); err != nil {
				return err
			}
		}
	}

	s.emit(taskID, u)
	return nil
}

// SetPhaseProgress persists phase-scoped progress (merging / transcoding
// percentages). Persistence is throttled to one write per
// progressMinInterval per task (or a >=progressMinJump percentage jump), so
// a page refresh or REST poll reads a fresh phase percentage from the DB
// instead of the stale 0 the row used to hold for the whole phase. The
// terminal 100 is always persisted immediately. SSE emission stays with the
// caller's regular progress callback, which the SSE layer throttles.
func (s *Store) SetPhaseProgress(taskID int, status string, pct float64) {
	if status != StatusMerging && status != StatusTranscoding {
		return
	}

	s.mu.Lock()
	mark := s.marks[taskID]
	now := time.Now()
	shouldPersist := pct >= ProgressTerminal ||
		(pct > mark.pc && now.Sub(mark.at) >= progressMinInterval) ||
		(pct-mark.pc >= progressMinJump)
	if shouldPersist {
		s.marks[taskID] = progressMark{at: now, pc: pct}
	}
	s.mu.Unlock()

	if !shouldPersist || s.db == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.db.Exec(ctx,
		"UPDATE download_tasks SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?",
		pct, taskID, status); err != nil && s.log != nil {
		s.log.Warn("Failed to persist phase progress",
			infra.LogContext{Extra: map[string]any{"taskId": taskID, "status": status, "error": err.Error()}})
	}
}

// RecoverStale resets video tasks left mid-pipeline by a crash or hard kill
// to paused so the user can resume them. Graceful shutdown writes 'cancelled'
// before this ever runs, so anything still active here is genuinely orphaned.
// Returns the number of reset rows.
func (s *Store) RecoverStale(ctx context.Context) (int64, error) {
	states := ActiveStatuses()
	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(states)), ", ")
	args := make([]any, 0, len(states))
	for _, st := range states {
		args = append(args, st)
	}
	res, err := s.db.Exec(ctx,
		`UPDATE download_tasks SET status = '`+StatusPaused+`', error_msg = 'reset after server restart', updated_at = CURRENT_TIMESTAMP
		 WHERE status IN (`+placeholders+`)`,
		args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// execTransition runs the conditional UPDATE and returns RowsAffected.
func (s *Store) execTransition(ctx context.Context, taskID int, u Update) (int64, error) {
	setClauses := []string{"status = ?", "updated_at = CURRENT_TIMESTAMP"}
	args := make([]any, 0, 8)
	args = append(args, u.Status)
	if u.Progress != nil {
		setClauses = append(setClauses, "progress = ?")
		args = append(args, *u.Progress)
	}
	for col, val := range u.Set {
		if !updateColumns[col] {
			return 0, fmt.Errorf("task %d: column %q is not whitelisted for transition updates", taskID, col)
		}
		setClauses = append(setClauses, col+" = ?")
		args = append(args, val)
	}
	// Placeholder order mirrors the SQL: SET columns, then the WHERE id
	// comparison, then the legal-from IN list.
	args = append(args, taskID)
	froms := legalFrom[u.Status]
	for _, src := range froms {
		args = append(args, src)
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(froms)), ", ")
	res, err := s.db.Exec(ctx,
		"UPDATE download_tasks SET "+strings.Join(setClauses, ", ")+
			" WHERE id = ? AND status IN ("+placeholders+")", args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// execSet applies extra column writes without touching the status.
func (s *Store) execSet(ctx context.Context, taskID int, set map[string]any) (int64, error) {
	if len(set) == 0 {
		return 0, nil
	}
	cols := make([]string, 0, len(set))
	args := make([]any, 0, len(set)+1)
	for col, val := range set {
		if !updateColumns[col] {
			return 0, fmt.Errorf("task %d: column %q is not whitelisted for transition updates", taskID, col)
		}
		cols = append(cols, col+" = ?")
		args = append(args, val)
	}
	args = append(args, taskID)
	res, err := s.db.Exec(ctx,
		"UPDATE download_tasks SET "+strings.Join(cols, ", ")+", updated_at = CURRENT_TIMESTAMP WHERE id = ?", args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// emit broadcasts the transition. The payload mirrors manager.emitProgress's
// shape so SSE consumers need no special-casing.
func (s *Store) emit(taskID int, u Update) {
	if s.bus == nil {
		return
	}
	payload := map[string]any{
		"taskId":   taskID,
		"taskType": "video",
		"status":   u.Status,
	}
	if u.Progress != nil {
		payload["progress"] = *u.Progress
	}
	s.bus.Emit("task:progress", payload)
}
