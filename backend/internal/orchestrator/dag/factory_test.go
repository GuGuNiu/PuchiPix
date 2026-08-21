package dag

import (
	"testing"

	"backend/internal/orchestrator"
)

// TestNewVideoPipelineTwoStage verifies the core fix: the video pipeline
// is now a two-node DAG where M3U8 identification (video:scrape) acquires
// the *scraping* slot and download (video:download) acquires the
// *download* slot. This makes video identification concurrency bounded
// by maxScrapingTasks — previously identification ran inside the
// download executor, unconstrained by the scraping slot, which is why
// every batch-created task appeared to be "identifying" at once.
func TestNewVideoPipelineTwoStage(t *testing.T) {
	f := NewDagFactory()
	def := f.NewVideoPipeline(42)

	if def.TaskType != orchestrator.TaskTypeVideo {
		t.Fatalf("task type = %s, want video", def.TaskType)
	}
	if len(def.Nodes) != 2 {
		t.Fatalf("node count = %d, want 2 (vsc -> vdl)", len(def.Nodes))
	}

	var vsc, vdl *orchestrator.DagNodeDefinition
	for i := range def.Nodes {
		n := &def.Nodes[i]
		if n.ID == "vsc-42" {
			vsc = n
		}
		if n.ID == "vdl-42" {
			vdl = n
		}
	}
	if vsc == nil || vdl == nil {
		t.Fatalf("missing nodes: vsc=%v vdl=%v", vsc, vdl)
	}

	// Identification node: scraping slot, scrape phase, video:scrape executor.
	if vsc.Executor != "video:scrape" {
		t.Errorf("vsc executor = %s, want video:scrape", vsc.Executor)
	}
	if vsc.Phase != orchestrator.PhaseScrape {
		t.Errorf("vsc phase = %s, want scrape", vsc.Phase)
	}
	if len(vsc.ResourceRequirements) != 1 || vsc.ResourceRequirements[0].SlotType != "scraping" {
		t.Errorf("vsc must require 1 scraping slot, got %+v", vsc.ResourceRequirements)
	}
	if len(vsc.Dependencies) != 0 {
		t.Errorf("vsc must have no dependencies, got %v", vsc.Dependencies)
	}
	if tid, ok := vsc.Config["taskId"]; !ok || tid != 42 {
		t.Errorf("vsc must carry taskId=42, got %v", vsc.Config["taskId"])
	}

	// Download node: download slot, depends on vsc.
	if vdl.Executor != "video:download" {
		t.Errorf("vdl executor = %s, want video:download", vdl.Executor)
	}
	if vdl.Phase != orchestrator.PhaseDownload {
		t.Errorf("vdl phase = %s, want download", vdl.Phase)
	}
	if len(vdl.ResourceRequirements) != 1 || vdl.ResourceRequirements[0].SlotType != "download" {
		t.Errorf("vdl must require 1 download slot, got %+v", vdl.ResourceRequirements)
	}
	if len(vdl.Dependencies) != 1 || vdl.Dependencies[0] != "vsc-42" {
		t.Errorf("vdl must depend on vsc-42, got %v", vdl.Dependencies)
	}
}
