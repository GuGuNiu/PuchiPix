package dagclient

import (
	"encoding/json"
	"testing"
)

func TestDebugParseModern(t *testing.T) {
	raw := `{"byPriority":{},"byTaskType":{},"queueSize":0,"schedulerStrategy":"priority-fair","slots":[{"available":3,"current":0,"max":3,"slotType":"scraping","status":"normal","utilization":0}]}`
	var modern apiSlotListResponse
	if err := json.Unmarshal([]byte(raw), &modern); err != nil {
		t.Fatalf("unmarshal modern: %v", err)
	}
	t.Logf("modern.Slots len=%d first=%+v", len(modern.Slots), modern.Slots)
	var r SlotStatusResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatalf("unmarshal resp: %v", err)
	}
	t.Logf("resp.Snapshot len=%d", len(r.Snapshot))
}
