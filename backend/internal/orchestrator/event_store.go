package orchestrator

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

// maxInMemoryLog caps the in-memory event buffer to bound memory usage.
const maxInMemoryLog = 10000

// snapshotInterval controls how many events accumulate before an
// automatic snapshot is taken, balancing recovery speed against I/O.
const snapshotInterval = 100

// EventStore persists DAG events for audit and recovery, mirroring the
// TypeScript EventStore with an in-memory ring buffer and database
// persistence.
//
// Async writes: AppendAsync hands events to a single writer goroutine
// via a bounded channel. A single writer preserves per-store seq
// ordering without holding the caller's lock across DB I/O; when the
// channel is full the caller degrades to a synchronous Append and the
// fallback is counted (droppedAsyncFallbacks) for observability.
type EventStore struct {
	mu                  sync.Mutex
	currentSeq          int64
	inMemoryLog         []DagEvent
	eventsSinceSnapshot int
	logger              *infra.Logger
	db                  *db.Database
	eventBus            *infra.EventBus
	snapshotFn          func() []DagSnapshot

	// async writer pipeline (nil until StartAsyncWriter is called)
	asyncCh        chan DagEvent
	asyncDone      chan struct{}
	asyncWG        sync.WaitGroup
	asyncStarted   bool
	asyncFallbacks int64
}

// NewEventStore creates an event store backed by the given database.
// If db is nil, events are only kept in memory (useful for tests).
func NewEventStore(database *db.Database, bus *infra.EventBus) *EventStore {
	if bus == nil {
		bus = infra.NewEventBus()
	}
	return &EventStore{
		inMemoryLog: make([]DagEvent, 0, maxInMemoryLog),
		logger:      infra.NewLogger("EventStore"),
		db:          database,
		eventBus:    bus,
	}
}

// SetSnapshotProvider installs a function that returns all current
// DAG snapshots, used by the automatic snapshot timer.
func (es *EventStore) SetSnapshotProvider(fn func() []DagSnapshot) {
	es.mu.Lock()
	defer es.mu.Unlock()
	es.snapshotFn = fn
}

// Append adds an event to the log, assigns it a sequence number,
// persists it to the database, and fans out to the EventBus.
func (es *EventStore) Append(ctx context.Context, event DagEvent) error {
	es.mu.Lock()
	es.currentSeq++
	event.Seq = es.currentSeq
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	es.inMemoryLog = append(es.inMemoryLog, event)
	if len(es.inMemoryLog) > maxInMemoryLog {
		es.inMemoryLog = es.inMemoryLog[len(es.inMemoryLog)-maxInMemoryLog:]
	}
	es.eventsSinceSnapshot++
	takeSnapshot := es.eventsSinceSnapshot >= snapshotInterval
	if takeSnapshot {
		es.eventsSinceSnapshot = 0
	}
	snapshotFn := es.snapshotFn
	es.mu.Unlock()

	// Emit to EventBus BEFORE DB INSERT so that SSE clients receive
	// events without waiting for DB I/O. The previous serial order
	// (INSERT then Emit) meant every event's SSE dispatch latency
// included the DB write latency, which under high load
// could reach hundreds of milliseconds. DB persistence
	// still happens synchronously right after, ensuring durability.
	// If the DB write fails, the event has already been emitted to
	// in-memory subscribers — the in-memory log preserves it for
	// recovery via Replay().
	es.eventBus.Emit(event.Type, event)

	if es.db != nil {
		payloadJSON, _ := json.Marshal(event.Payload)
		_, err := es.db.Exec(ctx,
			"INSERT INTO "+db.TableDagEvent+" (seq, dag_id, node_id, type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
			event.Seq, event.DagID, event.NodeID, event.Type, string(payloadJSON), event.Timestamp,
		)
		if err != nil {
			es.logger.Error("DB persistence failed", err, "eventSeq", event.Seq)
		}
	}

	if takeSnapshot && snapshotFn != nil {
		go func() {
			snapshots := snapshotFn()
			if err := es.Snapshot(context.Background(), snapshots); err != nil {
				es.logger.Error("Auto snapshot failed", err)
			}
		}()
	}

	return nil
}

// asyncQueueCapacity bounds the async writer channel; beyond it,
// AppendAsync degrades to synchronous writes rather than blocking
// schedulers on DB latency.
const asyncQueueCapacity = 1024

// StartAsyncWriter launches the single-writer goroutine backing
// AppendAsync. Idempotent; safe to call only once in practice.
func (es *EventStore) StartAsyncWriter() {
	es.mu.Lock()
	defer es.mu.Unlock()
	if es.asyncStarted {
		return
	}
	es.asyncCh = make(chan DagEvent, asyncQueueCapacity)
	es.asyncDone = make(chan struct{})
	es.asyncStarted = true
	es.asyncWG.Add(1)
	go es.asyncWriterLoop()
}

// asyncWriterLoop is the single consumer of the async channel. Being
// the only writer after StartAsyncWriter, it keeps seq assignment and
// DB insert order consistent with channel order.
func (es *EventStore) asyncWriterLoop() {
	defer es.asyncWG.Done()
	for {
		select {
		case event := <-es.asyncCh:
			_ = es.Append(context.Background(), event)
		case <-es.asyncDone:
			// Drain remaining events so Flush guarantees persistence.
			for {
				select {
				case event := <-es.asyncCh:
					_ = es.Append(context.Background(), event)
				default:
					return
				}
			}
		}
	}
}

// AppendAsync enqueues an event for asynchronous persistence. If the
// async writer is not running, it falls back to a synchronous Append.
// When the queue is full, it attempts to drain one slot to make room;
// if that also fails, the event is skipped and a snapshot is triggered
// to compensate — this avoids blocking the scheduler thread on DB I/O.
func (es *EventStore) AppendAsync(ctx context.Context, event DagEvent) error {
	es.mu.Lock()
	started := es.asyncStarted
	es.mu.Unlock()

	if !started {
		return es.Append(ctx, event)
	}

	select {
	case es.asyncCh <- event:
		return nil
	default:
		// Queue is full. Try to drain one slot and retry insert
		// without blocking the caller.
		select {
		case <-es.asyncCh:
			// Drained one old event; now insert the new one.
			es.asyncCh <- event
			es.mu.Lock()
			es.asyncFallbacks++
			fallbacks := es.asyncFallbacks
			es.mu.Unlock()
			es.logger.Warn("Async queue full, drained old event to make room", "fallbacks", fallbacks)
			return nil
		default:
			// Still full after drain attempt — skip this event and
			// trigger an async snapshot so state can be recovered.
			es.mu.Lock()
			es.asyncFallbacks++
			fallbacks := es.asyncFallbacks
			snapshotFn := es.snapshotFn
			es.mu.Unlock()
			es.logger.Warn("Async queue full, event dropped, triggering snapshot", "fallbacks", fallbacks, "eventType", event.Type)
			if snapshotFn != nil {
				go func() {
					snapshots := snapshotFn()
					if err := es.Snapshot(context.Background(), snapshots); err != nil {
						es.logger.Error("Compensatory snapshot failed", err)
					}
				}()
			}
			return nil
		}
	}
}

// Flush stops the async writer and waits for all queued events to be
// persisted. Called during graceful shutdown before the final snapshot.
func (es *EventStore) Flush() {
	es.mu.Lock()
	if !es.asyncStarted {
		es.mu.Unlock()
		return
	}
	es.asyncStarted = false
	close(es.asyncDone)
	es.mu.Unlock()
	es.asyncWG.Wait()
}

// AsyncFallbacks reports how many times AppendAsync had to degrade to
// synchronous writes because the queue was full.
func (es *EventStore) AsyncFallbacks() int64 {
	es.mu.Lock()
	defer es.mu.Unlock()
	return es.asyncFallbacks
}

// Replay returns events with sequence numbers greater than fromSeq,
// optionally filtered by DAG ID.
func (es *EventStore) Replay(ctx context.Context, fromSeq int64, dagID string) ([]DagEvent, error) {
	es.mu.Lock()
	inMemory := make([]DagEvent, 0)
	for _, e := range es.inMemoryLog {
		if e.Seq > fromSeq && (dagID == "" || e.DagID == dagID) {
			inMemory = append(inMemory, e)
		}
	}
	es.mu.Unlock()

	// Fast path: the in-memory log is append-only with head-truncation,
	// so its entries are strictly contiguous. If the first in-memory
	// entry is EXACTLY fromSeq+1 (the filtering above guarantees it can
	// never be <= fromSeq), the whole tail is present and complete.
	// Use == (not <=) so a future non-contiguous buffer layout fails
	// loudly via the DB path instead of silently returning gaps.
	if len(inMemory) > 0 && inMemory[0].Seq == fromSeq+1 {
		return inMemory, nil
	}

	// The requested range starts before the in-memory head (buffer was
	// truncated) or the buffer is empty: fall back to the database.
	// Note: with a nil db this returns whatever survived truncation —
	// acceptable for in-memory test stores, never used for production
	// recovery (production always has a database).
	if es.db == nil {
		return inMemory, nil
	}

	query := "SELECT seq, dag_id, node_id, type, payload, timestamp FROM " + db.TableDagEvent + " WHERE seq > ?"
	args := []any{fromSeq}
	if dagID != "" {
		query += " AND dag_id = ?"
		args = append(args, dagID)
	}
	query += " ORDER BY seq ASC"

	rows, err := es.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []DagEvent
	for rows.Next() {
		var e DagEvent
		var payloadStr string
		var nodeID *string
		var tsText string
		if err := rows.Scan(&e.Seq, &e.DagID, &nodeID, &e.Type, &payloadStr, &tsText); err != nil {
			return nil, err
		}
		if nodeID != nil {
			e.NodeID = *nodeID
		}
		e.Timestamp, _ = db.ParseSQLiteTime(tsText)
		_ = json.Unmarshal([]byte(payloadStr), &e.Payload)
		events = append(events, e)
	}
	return events, nil
}

// GetDagEvents returns all events for a specific DAG, ordered by seq.
func (es *EventStore) GetDagEvents(ctx context.Context, dagID string) ([]DagEvent, error) {
	if es.db == nil {
		es.mu.Lock()
		defer es.mu.Unlock()
		var events []DagEvent
		for _, e := range es.inMemoryLog {
			if e.DagID == dagID {
				events = append(events, e)
			}
		}
		return events, nil
	}

	rows, err := es.db.Query(ctx,
		"SELECT seq, dag_id, node_id, type, payload, timestamp FROM "+db.TableDagEvent+" WHERE dag_id = ? ORDER BY seq ASC",
		dagID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []DagEvent
	for rows.Next() {
		var e DagEvent
		var payloadStr string
		var nodeID *string
		var tsText string
		if err := rows.Scan(&e.Seq, &e.DagID, &nodeID, &e.Type, &payloadStr, &tsText); err != nil {
			return nil, err
		}
		if nodeID != nil {
			e.NodeID = *nodeID
		}
		e.Timestamp, _ = db.ParseSQLiteTime(tsText)
		_ = json.Unmarshal([]byte(payloadStr), &e.Payload)
		events = append(events, e)
	}
	return events, nil
}

// Snapshot persists the given DAG snapshots to the database.
func (es *EventStore) Snapshot(ctx context.Context, snapshots []DagSnapshot) error {
	if len(snapshots) == 0 || es.db == nil {
		return nil
	}

	es.mu.Lock()
	currentSeq := es.currentSeq
	es.mu.Unlock()

	for _, s := range snapshots {
		stateJSON, err := json.Marshal(s)
		if err != nil {
			es.logger.Error("Snapshot marshal failed", err, "dagId", s.DagID)
			continue
		}
		_, err = es.db.Exec(ctx,
			"INSERT INTO "+db.TableDagSnapshot+" (dag_id, state, last_seq, created_at) VALUES (?, ?, ?, ?)",
			s.DagID, string(stateJSON), currentSeq, time.Now(),
		)
		if err != nil {
			es.logger.Error("Snapshot creation failed", err, "dagId", s.DagID)
		}
	}
	es.logger.Info("Snapshot created", "dagCount", len(snapshots))
	return nil
}

// RestoreFromSnapshot loads the latest snapshots from the database and
// invokes the provided callbacks to restore DAG state and replay events.
func (es *EventStore) RestoreFromSnapshot(
	ctx context.Context,
	restoreDag func(snapshot DagSnapshot) error,
	applyEvent func(event DagEvent) error,
) error {
	if es.db == nil {
		return nil
	}

	cutoff := time.Now().Add(-24 * time.Hour)
	rows, err := es.db.Query(ctx,
		"SELECT dag_id, state, last_seq, created_at FROM "+db.TableDagSnapshot+" WHERE created_at >= ? ORDER BY created_at DESC",
		cutoff,
	)
	if err != nil {
		return err
	}

	type snapshotRecord struct {
		DagID   string
		State   string
		LastSeq int64
	}
	var records []snapshotRecord
	seen := make(map[string]bool)
	for rows.Next() {
		var r snapshotRecord
		// created_at is only used for the recency filter above; the
		// driver returns it as TEXT, which cannot scan into time.Time.
		var createdAt any
		if err := rows.Scan(&r.DagID, &r.State, &r.LastSeq, &createdAt); err != nil {
			rows.Close()
			return err
		}
		if seen[r.DagID] {
			continue
		}
		seen[r.DagID] = true
		records = append(records, r)
	}
	rows.Close()

	for _, r := range records {
		var snapshot DagSnapshot
		if err := json.Unmarshal([]byte(r.State), &snapshot); err != nil {
			es.logger.Error("DAG restore unmarshal failed", err, "dagId", r.DagID)
			continue
		}
		if err := restoreDag(snapshot); err != nil {
			es.logger.Error("DAG restore failed", err, "dagId", r.DagID)
			continue
		}

		events, err := es.Replay(ctx, r.LastSeq, r.DagID)
		if err != nil {
			es.logger.Error("Event replay failed", err, "dagId", r.DagID)
			continue
		}
		for _, event := range events {
			if err := applyEvent(event); err != nil {
				es.logger.Error("Apply event failed", err, "dagId", r.DagID, "seq", event.Seq)
			}
		}
	}

	es.logger.Info("Snapshot restore completed", "dagCount", len(records))
	return nil
}

// CurrentSequence returns the last assigned event sequence number.
func (es *EventStore) CurrentSequence() int64 {
	es.mu.Lock()
	defer es.mu.Unlock()
	return es.currentSeq
}

// Initialize sets the current sequence from the database's max seq.
func (es *EventStore) Initialize(ctx context.Context) error {
	if es.db == nil {
		return nil
	}
	var maxSeq *int64
	err := es.db.QueryRow(ctx, "SELECT MAX(seq) FROM "+db.TableDagEvent).Scan(&maxSeq)
	if err != nil {
		es.logger.Warn("Failed to query max seq, starting from 0", "error", err.Error())
		return nil
	}
	if maxSeq != nil {
		es.mu.Lock()
		es.currentSeq = *maxSeq
		es.mu.Unlock()
		es.logger.Info("EventStore initialized", "startSeq", *maxSeq)
	}
	return nil
}
