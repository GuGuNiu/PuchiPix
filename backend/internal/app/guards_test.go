package app

import (
	"context"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"
)

// newGuardTestDB gives each scenario its own temp-file database.
// :memory: cannot be used — MaxOpenConns(4) creates a separate in-memory
// database per pooled connection, so applySchema would only build the schema
// on one connection and queries on the others would necessarily fail.
func newGuardTestDB(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "guard_test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("GuardTest"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// insertGalleryRow creates a galleries row satisfying foreign-key constraints
// (gallery_images/gallery_videos/gallery_download_infos all reference galleries.id).
func insertGalleryRow(t *testing.T, d *db.Database, galleryID int) {
	t.Helper()
	_, err := d.Exec(context.Background(),
		`INSERT INTO galleries (id, source_url) VALUES (?, ?)`,
		galleryID, "https://example.com/gallery")
	if err != nil {
		t.Fatalf("insert galleries row: %v", err)
	}
}

func insertGalleryImage(t *testing.T, d *db.Database, galleryID int, status string) {
	t.Helper()
	_, err := d.Exec(context.Background(),
		`INSERT INTO gallery_images (gallery_id, url, file_name, order_index, status) VALUES (?, ?, ?, 0, ?)`,
		galleryID, "https://example.com/img.jpg", "img.jpg", status)
	if err != nil {
		t.Fatalf("insert gallery_images: %v", err)
	}
}

func insertGalleryVideo(t *testing.T, d *db.Database, galleryID int, status string) {
	t.Helper()
	_, err := d.Exec(context.Background(),
		`INSERT INTO gallery_videos (gallery_id, url, file_name, status) VALUES (?, ?, ?, ?)`,
		galleryID, "https://example.com/video.m3u8", "video.mp4", status)
	if err != nil {
		t.Fatalf("insert gallery_videos: %v", err)
	}
}

// TestComputeGalleryTerminalStatus covers the content-aware verdict of the
// DAG terminal-state guard: it must agree with the download executors'
// completed/partial/failed semantics, otherwise the guard itself could
// disguise a partial download as completed (the mirror risk of the 260820 hang bug).
func TestComputeGalleryTerminalStatus(t *testing.T) {
	t.Run("全部图片下载完成→completed", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		insertGalleryImage(t, d, 1, "downloaded")
		insertGalleryImage(t, d, 1, "downloaded")
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "completed" {
			t.Fatalf("got %q, want completed", got)
		}
	})

	t.Run("图片部分下载→partial", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		insertGalleryImage(t, d, 1, "downloaded")
		insertGalleryImage(t, d, 1, "failed")
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "partial" {
			t.Fatalf("got %q, want partial", got)
		}
	})

	t.Run("全无下载→failed", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		insertGalleryImage(t, d, 1, "pending")
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "failed" {
			t.Fatalf("got %q, want failed", got)
		}
	})

	t.Run("图片全完成但视频失败→partial", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		insertGalleryImage(t, d, 1, "downloaded")
		insertGalleryVideo(t, d, 1, "failed")
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "partial" {
			t.Fatalf("got %q, want partial", got)
		}
	})

	t.Run("图片与视频全部完成→completed", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		insertGalleryImage(t, d, 1, "downloaded")
		insertGalleryVideo(t, d, 1, "downloaded")
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "completed" {
			t.Fatalf("got %q, want completed", got)
		}
	})

	t.Run("ZIP 下载路径无文件级记录→completed", func(t *testing.T) {
		d := newGuardTestDB(t)
		insertGalleryRow(t, d, 1)
		// The ZIP pipeline writes only gallery_download_infos, not gallery_images/gallery_videos
		_, err := d.Exec(context.Background(),
			`INSERT INTO gallery_download_infos (gallery_id, actual_size) VALUES (1, 261000000)`)
		if err != nil {
			t.Fatalf("insert gallery_download_infos: %v", err)
		}
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "completed" {
			t.Fatalf("got %q, want completed (ZIP path)", got)
		}
	})

	t.Run("无任何内容记录→failed（拒绝假完成）", func(t *testing.T) {
		d := newGuardTestDB(t)
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "failed" {
			t.Fatalf("got %q, want failed", got)
		}
	})

	t.Run("查询失败时降级为completed（DAG聚合已确认成功）", func(t *testing.T) {
		d := newGuardTestDB(t)
		// Drop a table to simulate a schema anomaly; the fallback must not panic
		// and must return the conservative value
		if _, err := d.Exec(context.Background(), `DROP TABLE gallery_images`); err != nil {
			t.Fatalf("drop table: %v", err)
		}
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "completed" {
			t.Fatalf("got %q, want completed (degraded fallback)", got)
		}
	})
}

// TestValidateDatabaseSchema verifies startup schema validation reports
// missing core tables instead of letting the server serve 404s from an
// empty database.
func TestValidateDatabaseSchema(t *testing.T) {
	t.Run("健康库校验通过", func(t *testing.T) {
		d := newGuardTestDB(t)
		validateDatabaseSchema(infra.NewLogger("GuardTest"), d)
	})

	t.Run("核心表缺失被检出", func(t *testing.T) {
		d := newGuardTestDB(t)
		for _, table := range []string{"galleries", "download_tasks", "sniff_tasks"} {
			if _, err := d.Exec(context.Background(), "DROP TABLE "+table); err != nil {
				t.Fatalf("drop %s: %v", table, err)
			}
		}
		// validateDatabaseSchema only logs and returns no error, so the test
		// asserts the missing-table branch does not panic; error logs go to
		// the global sink and are out of assertion scope.
		validateDatabaseSchema(infra.NewLogger("GuardTest"), d)
	})
}

func TestConfigInt(t *testing.T) {
	cases := []struct {
		value any
		want  int
	}{
		{value: 7, want: 7},
		{value: int64(8), want: 8},
		{value: float64(9), want: 9},
		{value: "10", want: 10},
	}
	for _, tc := range cases {
		if got := configInt(tc.value); got != tc.want {
			t.Fatalf("configInt(%v) = %d, want %d", tc.value, got, tc.want)
		}
	}
}
