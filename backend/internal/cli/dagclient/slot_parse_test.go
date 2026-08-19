package dagclient

import (
	"encoding/json"
	"testing"
)

func TestSlotStatusUnmarshalModern(t *testing.T) {
	raw := `{"byPriority":{},"byTaskType":{},"queueSize":0,"schedulerStrategy":"priority-fair","slots":[{"available":3,"current":0,"max":3,"slotType":"scraping","status":"normal","utilization":0},{"available":3,"current":2,"max":5,"slotType":"download","status":"normal","utilization":40}]}`
	var r SlotStatusResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(r.Snapshot) != 2 {
		t.Fatalf("expected 2 slots in snapshot, got %d: %+v", len(r.Snapshot), r.Snapshot)
	}
}
