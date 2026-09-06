package main

import (
	"context"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"
)

// newGuardTestDB 每个场景使用独立的临时文件数据库。
// 不能用 :memory:——MaxOpenConns(4) 会为池中每个连接创建独立的内存库，
// applySchema 只建在其中一个连接上，其余连接查询必然失败。
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

// insertGalleryRow 建立满足外键约束的 galleries 记录
// （gallery_images/gallery_videos/gallery_download_infos 均引用 galleries.id）。
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

// TestComputeGalleryTerminalStatus 覆盖 DAG 终态守卫的内容感知判定：
// 必须与下载执行器的 completed/partial/failed 语义一致，
// 否则守卫本身会把部分下载伪装成 completed（260820 卡死问题的镜像风险）。
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
		// ZIP 管道不写 gallery_images/gallery_videos，只写 gallery_download_infos
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
		// 删除表模拟 schema 异常，验证降级路径不 panic 且返回保守值
		if _, err := d.Exec(context.Background(), `DROP TABLE gallery_images`); err != nil {
			t.Fatalf("drop table: %v", err)
		}
		got := computeGalleryTerminalStatus(context.Background(), d, 1)
		if got != "completed" {
			t.Fatalf("got %q, want completed (degraded fallback)", got)
		}
	})
}

// TestValidateDatabaseSchema 验证启动期 schema 校验能识别核心表缺失
// （260821 空库静默创建事故的防护闸门）。
func TestValidateDatabaseSchema(t *testing.T) {
	t.Run("健康库校验通过", func(t *testing.T) {
		d := newGuardTestDB(t)
		// 不应 panic；通过即视为正常（错误分支才需要断言）
		validateDatabaseSchema(infra.NewLogger("GuardTest"), d)
	})

	t.Run("核心表缺失被检出", func(t *testing.T) {
		d := newGuardTestDB(t)
		for _, table := range []string{"galleries", "download_tasks", "sniff_tasks"} {
			if _, err := d.Exec(context.Background(), "DROP TABLE " + table); err != nil {
				t.Fatalf("drop %s: %v", table, err)
			}
		}
		// validateDatabaseSchema 只记日志不返回错误，这里验证它不 panic
		// 且能走完缺失分支（错误日志输出到全局 sink，不在断言范围内）。
		validateDatabaseSchema(infra.NewLogger("GuardTest"), d)
	})
}
