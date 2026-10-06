package infra

import (
	"errors"
	"testing"
)

// log() used to keep only data[0], silently dropping every structured field
// past the first. Multi-arg calls must be normalized into a complete key-value
// map.
func TestNormalizeLogArgsKeepsAllFields(t *testing.T) {
	out := normalizeLogArgs([]any{
		"slotType", "download",
		"queued", 12,
		"nodeId", "n-7",
	})

	if len(out) != 3 {
		t.Fatalf("expected 3 fields, got %d: %v", len(out), out)
	}
	if out["slotType"] != "download" || out["queued"] != 12 || out["nodeId"] != "n-7" {
		t.Fatalf("field values lost: %v", out)
	}
}

func TestNormalizeLogArgsErrorStringified(t *testing.T) {
	out := normalizeLogArgs([]any{"error", errors.New("boom")})

	got, ok := out["error"].(string)
	if !ok || got != "boom" {
		t.Fatalf("error should serialize as its message, got %v", out["error"])
	}
}

func TestNormalizeLogArgsOddTrailingArgNotDropped(t *testing.T) {
	out := normalizeLogArgs([]any{"key", "value", 42})

	if out["key"] != "value" {
		t.Fatalf("pair value lost: %v", out)
	}
	if got, ok := out["arg2"].(int); !ok || got != 42 {
		t.Fatalf("odd trailing arg must fall back to argN, got %v", out["arg2"])
	}
}
