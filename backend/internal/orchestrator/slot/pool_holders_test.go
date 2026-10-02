package slot

import (
	"testing"
	"time"
)

func TestGetHoldersByAgeNewestFirst(t *testing.T) {
	p := NewSlotPool()
	p.RegisterType(SlotTypeDefinition{Key: "download", Label: "Download", DefaultMax: 5, Min: 1, Max: 50})

	if !p.Acquire("download", "dagA:n1") {
		t.Fatal("acquire A failed")
	}
	time.Sleep(25 * time.Millisecond)
	if !p.Acquire("download", "dagB:n2") {
		t.Fatal("acquire B failed")
	}

	holders := p.GetHoldersByAge("download")
	if len(holders) != 2 {
		t.Fatalf("holders = %d, want 2", len(holders))
	}
	if holders[0].HolderID != "dagB:n2" {
		t.Fatalf("newest-first order violated: %v ranked before %v", holders[0].HolderID, holders[1].HolderID)
	}
	if holders[1].HolderID != "dagA:n1" {
		t.Fatalf("unexpected holder: %v", holders[1].HolderID)
	}
}
