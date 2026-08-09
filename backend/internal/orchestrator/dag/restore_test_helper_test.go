package dag

import (
	"backend/internal/orchestrator"
)

// RestoreDagForTest restores a DAG from a snapshot and recomputes the
// incremental activation counters, mirroring the server restart path
// used by graph index consistency tests.
func (o *DagOrchestrator) RestoreDagForTest(snap orchestrator.DagSnapshot) error {
	if err := o.restoreDag(snap); err != nil {
		return err
	}
	o.recomputeActivationCounters()
	return nil
}
