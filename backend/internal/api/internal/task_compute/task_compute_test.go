package task_compute

import (
	"math"
	"testing"
)

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestComputeDisplayProgressVideoIsMonotonicAcrossPhases(t *testing.T) {
	cases := []struct {
		status string
		pct    float64
		want   float64
	}{
		{"downloading", 0, 0},
		{"downloading", 50, 45},
		{"downloading", 100, 90},
		{"merging", 0, 90},
		{"merging", 100, 95},
		{"transcoding", 0, 95},
		{"transcoding", 50, 97},
		{"transcoding", 99.9, 98.996},
		{"probing", 100, 99},
		{"completed", 100, 100},
	}
	for _, c := range cases {
		if got := ComputeDisplayProgress("video", c.status, c.pct); !almostEqual(got, c.want) {
			t.Errorf("video %s %.1f%%: got %.3f, want %.3f", c.status, c.pct, got, c.want)
		}
	}
}

func TestComputeDisplayProgressPhaseBoundaryNeverRegresses(t *testing.T) {
	prev := 0.0
	for _, c := range []struct {
		status string
		pct    float64
	}{
		{"downloading", 100},
		{"merging", 0},
		{"merging", 100},
		{"transcoding", 0},
		{"transcoding", 100},
		{"probing", 100},
		{"completed", 100},
	} {
		got := ComputeDisplayProgress("video", c.status, c.pct)
		if got < prev {
			t.Fatalf("regression at %s(%.0f%%): %.3f < %.3f", c.status, c.pct, got, prev)
		}
		prev = got
	}
}

func TestComputeDisplayProgressPassThrough(t *testing.T) {
	if got := ComputeDisplayProgress("gallery", "downloading", 42.5); got != 42.5 {
		t.Errorf("gallery must pass through raw value, got %v", got)
	}
	if got := ComputeDisplayProgress("video", "paused", 60); got != 60 {
		t.Errorf("paused must pass through raw value (phase unknown), got %v", got)
	}
	if got := ComputeDisplayProgress("video", "failed", 30); got != 30 {
		t.Errorf("failed must pass through raw value, got %v", got)
	}
	if got := ComputeDisplayProgress("video", "downloading", 120); got != 90 {
		t.Errorf("out-of-range phase value must clamp, got %v", got)
	}
}

func TestRewriteProgressPayload(t *testing.T) {
	out := RewriteProgressPayload(map[string]any{
		"taskId":   3,
		"taskType": "video",
		"status":   "transcoding",
		"progress": 40.0,
		"speed":    "12.0 seg/s",
	})
	if got := out["progress"].(float64); !almostEqual(got, 96.6) {
		t.Errorf("progress = %v, want composite 96.6", got)
	}
	if got := out["phaseProgress"].(float64); got != 40.0 {
		t.Errorf("phaseProgress = %v, want raw 40", got)
	}
	if out["speed"] != "12.0 seg/s" {
		t.Errorf("other fields must be preserved, got %v", out["speed"])
	}

	// Missing taskType defaults to video.
	out = RewriteProgressPayload(map[string]any{"status": "downloading", "progress": 50.0})
	if got := out["progress"].(float64); !almostEqual(got, 45) {
		t.Errorf("default taskType: progress = %v, want 45", got)
	}

	// No numeric progress: pass through untouched.
	in := map[string]any{"taskId": 1, "status": "downloading"}
	if out := RewriteProgressPayload(in); len(out) != 2 {
		t.Errorf("payload without progress must pass through, got %v", out)
	}

	// Gallery keeps raw values.
	out = RewriteProgressPayload(map[string]any{"taskType": "gallery", "status": "downloading", "progress": 42.5})
	if got := out["progress"].(float64); got != 42.5 {
		t.Errorf("gallery progress must stay raw, got %v", got)
	}
}

func TestEnrichTaskMapRewritesProgressKeepsPhase(t *testing.T) {
	task := EnrichTaskMap(map[string]any{
		"TaskType": "video",
		"ID":       9,
		"Status":   "transcoding",
		"Progress": 40.0,
	})
	if got := task["Progress"].(float64); !almostEqual(got, 96.6) {
		t.Errorf("Progress = %v, want composite 96.6", got)
	}
	if got := task["PhaseProgress"].(float64); got != 40.0 {
		t.Errorf("PhaseProgress = %v, want raw 40", got)
	}
	// The legacy probe-window fallback works on the RAW value: a row stuck
	// at transcoding with progress=100 shows the probing stage.
	task = EnrichTaskMap(map[string]any{
		"TaskType": "video",
		"ID":       10,
		"Status":   "transcoding",
		"Progress": 100.0,
	})
	if got := task["ProgressStage"]; got != "tasks.progressStageProbing" {
		t.Errorf("ProgressStage = %v, want probing fallback", got)
	}
	if got := task["Progress"].(float64); !almostEqual(got, 99) {
		t.Errorf("Progress = %v, want 99 for transcoding@100", got)
	}
	// A real probing row is labelled directly.
	task = EnrichTaskMap(map[string]any{
		"TaskType": "video",
		"ID":       11,
		"Status":   "probing",
		"Progress": 100.0,
	})
	if got := task["ProgressStage"]; got != "tasks.progressStageProbing" {
		t.Errorf("ProgressStage = %v, want probing", got)
	}
}
