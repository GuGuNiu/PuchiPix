package taskprogress

import (
	"sync"
	"testing"
)

// Wiring SetOnProgress must deliver a fresh summary after every file status
// change — this is the SSE push path for gallery progress (previously the
// hook existed but was never installed, leaving progress poll-only).
func TestSetOnProgressReceivesSummaries(t *testing.T) {
	e := NewEngine(nil)

	var mu sync.Mutex
	var summaries []GalleryProgressSummary
	e.SetOnProgress(func(galleryID int, summary GalleryProgressSummary) {
		mu.Lock()
		defer mu.Unlock()
		summaries = append(summaries, summary)
	})

	e.RegisterFiles(42, []FileProgress{
		{FileIndex: 0, FileURL: "https://x/0.jpg"},
		{FileIndex: 1, FileURL: "https://x/1.jpg"},
	})

	e.UpdateFileStatus(42, 0, FileCompleted, "/tmp/0.jpg", 100, "")
	e.UpdateFileStatus(42, 1, FileFailed, "", 0, "boom")

	mu.Lock()
	defer mu.Unlock()
	if len(summaries) != 2 {
		t.Fatalf("received %d summaries, want 2", len(summaries))
	}
	last := summaries[len(summaries)-1]
	if last.GalleryID != 42 || last.CompletedFiles != 1 || last.FailedFiles != 1 || last.TotalFiles != 2 {
		t.Fatalf("last summary = %+v, want 1 completed / 1 failed of 2", last)
	}
}

// Without a callback the engine must stay pull-only and not panic.
func TestEngineWithoutOnProgressStaysPullOnly(t *testing.T) {
	e := NewEngine(nil)
	e.RegisterFiles(7, []FileProgress{{FileIndex: 0, FileURL: "https://x/0.jpg"}})
	e.UpdateFileStatus(7, 0, FileCompleted, "/tmp/0.jpg", 100, "")

	summary := e.GetSummary(7)
	if summary.CompletedFiles != 1 {
		t.Fatalf("summary = %+v, want 1 completed", summary)
	}
}
