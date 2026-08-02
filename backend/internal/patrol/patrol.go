package patrol

import (
	"context"
	"log"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/titleparser"
)

// PatrolReport summarizes the results of a patrol cycle.
type PatrolReport struct {
	ScanType        string
	CandidatesFound int
	AutoIngested    int
	Queued          int
	Promoted        int
	CleanedUp       int
	DurationMs      int64
}

// PatrolScheduler runs periodic variant discovery scans on the gallery
// database.
type PatrolScheduler struct {
	db     *db.Database
	parser *titleparser.Parser
	cfg    titleparser.VariantDiscoveryConfig
	state  PatrolState
	mu     sync.Mutex
	stopCh chan struct{}
	cooldown  time.Duration
	scanBatch int
}

// PatrolState is persisted to the database between patrol cycles.
type PatrolState struct {
	LastScanAt      time.Time
	GalleriesScanned int
	VariantsFound   int
	Promoted        int
}

// NewPatrolScheduler creates a scheduler with the given configuration.
func NewPatrolScheduler(database *db.Database, parser *titleparser.Parser) *PatrolScheduler {
	return &PatrolScheduler{
		db:        database,
		parser:    parser,
		cfg:       titleparser.DefaultVariantConfig(),
		stopCh:    make(chan struct{}),
		cooldown:  1 * time.Hour,
		scanBatch: 500,
	}
}

// Start begins the background patrol loop with the given interval.
// The first scan runs after initialDelay to avoid competing with startup.
func (ps *PatrolScheduler) Start(ctx context.Context, interval time.Duration, initialDelay time.Duration) {
	ps.loadState(ctx)

	go func() {
		select {
		case <-time.After(initialDelay):
			ps.runPatrolCycle(ctx)
		case <-ps.stopCh:
			return
		case <-ctx.Done():
			return
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				ps.runPatrolCycle(ctx)
			case <-ps.stopCh:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	log.Printf("[VariantPatrol] Started �?interval=%v cooldown=%v", interval, ps.cooldown)
}

// Stop gracefully shuts down the patrol scheduler.
func (ps *PatrolScheduler) Stop() {
	close(ps.stopCh)
}

// RunManual triggers a patrol cycle immediately (for admin API use).
func (ps *PatrolScheduler) RunManual(ctx context.Context) *PatrolReport {
	return ps.runPatrolCycle(ctx)
}

func (ps *PatrolScheduler) runPatrolCycle(ctx context.Context) *PatrolReport {
	ps.mu.Lock()
	if time.Since(ps.state.LastScanAt) < ps.cooldown {
		ps.mu.Unlock()
		return &PatrolReport{ScanType: "skipped_cooldown"}
	}
	ps.mu.Unlock()

	start := time.Now()

	incReport := ps.scanIncremental(ctx)
	proReport := ps.promoteQueue(ctx)
	cleanReport := ps.cleanup(ctx)

	ps.mu.Lock()
	ps.state.LastScanAt = time.Now()
	ps.state.GalleriesScanned += incReport.CandidatesFound
	ps.state.VariantsFound += incReport.AutoIngested + incReport.Queued
	ps.state.Promoted += proReport.Promoted
	ps.saveState(ctx)
	ps.mu.Unlock()

	duration := time.Since(start).Milliseconds()

	log.Printf("[VariantPatrol] Cycle complete �?inc=%d auto=%d queued=%d promoted=%d cleaned=%d duration=%dms",
		incReport.CandidatesFound, incReport.AutoIngested, incReport.Queued,
		proReport.Promoted, cleanReport.CleanedUp, duration)

	return &PatrolReport{
		ScanType:        "full_cycle",
		CandidatesFound: incReport.CandidatesFound,
		AutoIngested:    incReport.AutoIngested,
		Queued:          incReport.Queued,
		Promoted:        proReport.Promoted,
		CleanedUp:       cleanReport.CleanedUp,
		DurationMs:      duration,
	}
}

// ── Scan A: Incremental discovery ──

func (ps *PatrolScheduler) scanIncremental(ctx context.Context) *PatrolReport {
	report := &PatrolReport{ScanType: "incremental"}

	rows, err := ps.db.Query(ctx,
		`SELECT g.id, g.title, g.protagonist
		 FROM galleries g
		 WHERE g.protagonist != ''
		   AND g.updated_at > ?
		 ORDER BY g.id
		 LIMIT ?`, ps.state.LastScanAt, ps.scanBatch)
	if err != nil {
		log.Printf("[VariantPatrol] Incremental scan query error: %v", err)
		return report
	}
	defer rows.Close()

	var contexts []titleparser.VariantContext
	for rows.Next() {
		var id int
		var title, protagonist string
		if err := rows.Scan(&id, &title, &protagonist); err != nil {
			continue
		}

		seg := firstSegment(ps.parser, title)
		if seg == "" {
			continue
		}

		contexts = append(contexts, titleparser.VariantContext{
			Title:      title,
			Segment:    seg,
			Protagonist: protagonist,
		})
	}

	scores := titleparser.ScoreCandidates(contexts)
	report.CandidatesFound = len(scores)

	for _, s := range scores {
		// Skip exact matches �?they provide no new information
		if s.Candidate.Type == titleparser.VariantExactMatch {
			continue
		}
		switch s.Action {
		case "auto":
			ps.ingestVariant(ctx, s)
			report.AutoIngested++
		case "review":
			ps.upsertQueue(ctx, s)
			report.Queued++
		}
		ps.logVariant(ctx, s)
	}

	return report
}

// ── Scan B: Queue promotion ──

func (ps *PatrolScheduler) promoteQueue(ctx context.Context) *PatrolReport {
	report := &PatrolReport{ScanType: "promotion"}

	rows, err := ps.db.Query(ctx,
		`SELECT id, model_name, variant, variant_type, score
		 FROM model_variant_queue
		 WHERE status = 'pending'
		 ORDER BY score DESC`)
	if err != nil {
		return report
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var modelName, variant, variantType string
		var oldScore float64
		if err := rows.Scan(&id, &modelName, &variant, &variantType, &oldScore); err != nil {
			continue
		}

		newScore := ps.rescoreVariant(ctx, modelName, variant)
		if newScore >= ps.cfg.AutoThreshold {
			vs := titleparser.VariantScore{
				Candidate: titleparser.VariantCandidate{
					ModelName: modelName,
					Variant:   variant,
					Type:      titleparser.VariantType(variantType),
				},
				Score:  newScore,
				Action: "auto",
			}
			ps.ingestVariant(ctx, vs)
			ps.db.Exec(ctx,
				`UPDATE model_variant_queue SET status='promoted', score=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
				newScore, id)
			report.Promoted++
		}
	}

	return report
}

func (ps *PatrolScheduler) rescoreVariant(ctx context.Context, modelName, variant string) float64 {
	var freq int
	ps.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM galleries
		 WHERE protagonist = ? AND title LIKE '%' || ? || '%'`,
		modelName, variant).Scan(&freq)

	freqNorm := float64(freq) / float64(ps.cfg.MinFrequency)
	if freqNorm > 1.0 {
		freqNorm = 1.0
	}
	return 0.40*freqNorm + 0.30*1.0 + 0.20*1.0 + 0.10*1.0
}

// ── Scan C: Cleanup ──

func (ps *PatrolScheduler) cleanup(ctx context.Context) *PatrolReport {
	report := &PatrolReport{ScanType: "cleanup"}

	// Remove old discard logs
	result, err := ps.db.Exec(ctx,
		`DELETE FROM model_variant_log
		 WHERE action = 'discard' AND created_at < datetime('now', '-30 days')`)
	if err == nil {
		if rows, _ := result.RowsAffected(); rows > 0 {
			report.CleanedUp += int(rows)
		}
	}

	// Expire old pending reviews
	result2, err := ps.db.Exec(ctx,
		`UPDATE model_variant_queue SET status = 'expired'
		 WHERE status = 'pending' AND created_at < datetime('now', '-90 days')`)
	if err == nil {
		if rows, _ := result2.RowsAffected(); rows > 0 {
			report.CleanedUp += int(rows)
		}
	}

	return report
}

// ── Database operations ──

func (ps *PatrolScheduler) ingestVariant(ctx context.Context, vs titleparser.VariantScore) {
	_, err := ps.db.Exec(ctx,
		`UPDATE models
		 SET aliases = CASE
	   WHEN NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = ?)
	   THEN json_insert(aliases, '$[#]', ?)
	   ELSE aliases
		 END
		 WHERE name = ?`,
		vs.Candidate.Variant, vs.Candidate.Variant, vs.Candidate.ModelName)
	if err != nil {
		log.Printf("[VariantPatrol] Ingest error model=%s variant=%s: %v",
			vs.Candidate.ModelName, vs.Candidate.Variant, err)
	}
}

func (ps *PatrolScheduler) upsertQueue(ctx context.Context, vs titleparser.VariantScore) {
	ps.db.Exec(ctx,
		`INSERT INTO model_variant_queue (model_name, variant, variant_type, score, status)
		 VALUES (?, ?, ?, ?, 'pending')
		 ON CONFLICT (model_name, variant) DO UPDATE
		 SET score = ?, updated_at = CURRENT_TIMESTAMP`,
		vs.Candidate.ModelName, vs.Candidate.Variant, string(vs.Candidate.Type), vs.Score)
}

func (ps *PatrolScheduler) logVariant(ctx context.Context, vs titleparser.VariantScore) {
	ps.db.Exec(ctx,
		`INSERT INTO model_variant_log (model_name, variant, variant_type, score, action)
		 VALUES (?, ?, ?, ?, ?)`,
		vs.Candidate.ModelName, vs.Candidate.Variant, string(vs.Candidate.Type), vs.Score, vs.Action)
}

// ── State persistence ──

func (ps *PatrolScheduler) loadState(ctx context.Context) {
	ps.db.QueryRow(ctx,
		`SELECT COALESCE(last_scan_at, datetime('now', '-7 days')),
		        COALESCE(galleries_scanned, 0),
		        COALESCE(variants_found, 0),
		        COALESCE(variants_promoted, 0)
		 FROM model_variant_scan_state ORDER BY id DESC LIMIT 1`).
		Scan(&ps.state.LastScanAt, &ps.state.GalleriesScanned, &ps.state.VariantsFound, &ps.state.Promoted)
}

func (ps *PatrolScheduler) saveState(ctx context.Context) {
	ps.db.Exec(ctx,
		`INSERT INTO model_variant_scan_state (last_scan_at, galleries_scanned, variants_found, variants_promoted)
		 VALUES (?, ?, ?, ?)`,
		ps.state.LastScanAt, ps.state.GalleriesScanned, ps.state.VariantsFound, ps.state.Promoted)
}

// ── Helpers ──

// firstSegment uses the title parser's smartSegment to extract the first
// meaningful segment (the model name position). This avoids false variant
// extractions from naive prefix splitting.
func firstSegment(parser *titleparser.Parser, title string) string {
	result := parser.Parse(title)
	if len(result.Segments) == 0 {
		return title
	}
	return result.Segments[0]
}
