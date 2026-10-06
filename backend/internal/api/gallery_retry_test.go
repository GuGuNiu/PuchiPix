package api

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"
)

func newRetryTestDB(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "retry_test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("RetryTest"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func insertRetryGallery(t *testing.T, d *db.Database, galleryID int, imageCount, videoCount int) {
	t.Helper()
	if _, err := d.Exec(context.Background(),
		`INSERT INTO galleries (id, source_url, site_id, image_count, video_count)
		 VALUES (?, 'https://example.com/g', 'aimeizizi', ?, ?)`,
		galleryID, imageCount, videoCount); err != nil {
		t.Fatalf("insert galleries row: %v", err)
	}
}

func insertImageWithIndex(t *testing.T, d *db.Database, galleryID, orderIndex int, status string) {
	t.Helper()
	if _, err := d.Exec(context.Background(),
		`INSERT INTO gallery_images (gallery_id, url, file_name, order_index, status)
		 VALUES (?, ?, ?, ?, ?)`,
		galleryID, "https://example.com/img.jpg", "img.jpg", orderIndex, status); err != nil {
		t.Fatalf("insert gallery_images row (order %d): %v", orderIndex, err)
	}
}

func imageStatusByIndex(t *testing.T, d *db.Database, galleryID, orderIndex int) string {
	t.Helper()
	var status string
	if err := d.QueryRow(context.Background(),
		`SELECT status FROM gallery_images WHERE gallery_id = ? AND order_index = ?`,
		galleryID, orderIndex).Scan(&status); err != nil {
		t.Fatalf("query image status (order %d): %v", orderIndex, err)
	}
	return status
}

// TestResetGalleryFilesForRetry verifies the exact-index reset contract:
// failed rows within the indices flip to pending, downloaded rows are
// preserved, and rows outside the indices are untouched. This is the
// write that makes file-level retry visible to the download executor,
// which only loads rows with status='pending'.
func TestResetGalleryFilesForRetry(t *testing.T) {
	ctx := context.Background()
	database := newRetryTestDB(t)
	insertRetryGallery(t, database, 1, 3, 0)
	insertImageWithIndex(t, database, 1, 0, "failed")
	insertImageWithIndex(t, database, 1, 1, "downloaded")
	insertImageWithIndex(t, database, 1, 2, "failed")

	h := &Handlers{DB: database}

	reset, err := h.resetGalleryFilesForRetry(ctx, 1, []int{0, 1, 2})
	if err != nil {
		t.Fatalf("resetGalleryFilesForRetry: %v", err)
	}
	if reset != 2 {
		t.Fatalf("expected 2 resets (indices 0,2 failed), got %d", reset)
	}
	if s := imageStatusByIndex(t, database, 1, 0); s != "pending" {
		t.Fatalf("index 0 should be pending, got %q", s)
	}
	if s := imageStatusByIndex(t, database, 1, 2); s != "pending" {
		t.Fatalf("index 2 should be pending, got %q", s)
	}
	if s := imageStatusByIndex(t, database, 1, 1); s != "downloaded" {
		t.Fatalf("downloaded index 1 must be preserved, got %q", s)
	}

	// Empty index list is a no-op.
	if n, err := h.resetGalleryFilesForRetry(ctx, 1, nil); err != nil || n != 0 {
		t.Fatalf("empty indices: got (%d, %v), want (0, nil)", n, err)
	}
}

// TestResubmitGalleryResume_NotFound verifies the 404 mapping: a missing
// gallery surfaces as retrySubmitError with StatusNotFound, not a raw
// SQL error.
func TestResubmitGalleryResume_NotFound(t *testing.T) {
	ctx := context.Background()
	database := newRetryTestDB(t)
	h := &Handlers{DB: database}

	_, err := h.resubmitGalleryResume(ctx, 999)
	if err == nil {
		t.Fatal("expected error for missing gallery")
	}
	rse, ok := err.(*retrySubmitError)
	if !ok {
		t.Fatalf("expected *retrySubmitError, got %T: %v", err, err)
	}
	if rse.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rse.status)
	}
}
