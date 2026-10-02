package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"

	"backend/internal/db"
	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/taskprogress"
)

func newTaskDeleteTestDatabase(t *testing.T) *db.Database {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "task-delete.db"), infra.NewLogger("TaskDeleteTest"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestTaskDeleteRemovesConfiguredCacheAndDatabaseBeforeResponse(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	root := t.TempDir()
	managerConfig := video.DefaultManagerConfig()
	managerConfig.DownloadPath = filepath.Join(root, "videos")
	managerConfig.SegmentsPath = filepath.Join(root, "segments")
	manager := video.NewDownloadManager(database, nil, managerConfig)
	tracker := taskprogress.NewVideoProgressTracker(taskprogress.DefaultVideoRetryStrategy())
	tracker.RegisterSegments(42, 2)

	const taskID = 42
	filePath := filepath.Join(managerConfig.DownloadPath, "task.mp4")
	segmentsPath := manager.TaskSegmentsDir(taskID)
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatalf("create video directory: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("video"), 0644); err != nil {
		t.Fatalf("create video file: %v", err)
	}
	if err := os.MkdirAll(segmentsPath, 0755); err != nil {
		t.Fatalf("create segment directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(segmentsPath, "segment.ts"), []byte("segment"), 0644); err != nil {
		t.Fatalf("create segment file: %v", err)
	}

	ctx := context.Background()
	if _, err := database.Exec(ctx,
		"INSERT INTO download_tasks (id, url, file_path) VALUES (?, ?, ?)", taskID, "https://example.com/video", filePath); err != nil {
		t.Fatalf("insert download task: %v", err)
	}
	if _, err := database.Exec(ctx,
		"INSERT INTO video_infos (task_id, title) VALUES (?, ?)", taskID, "video"); err != nil {
		t.Fatalf("insert video info: %v", err)
	}

	eventBus := infra.NewEventBus()
	h := &Handlers{DB: database, DownloadMgr: manager, VideoTracker: tracker, DataDir: root, EventBus: eventBus}
	req := httptest.NewRequest(http.MethodDelete, "/api/tasks/42", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("id", "42")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()

	h.TaskDelete(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	for _, path := range []string{filePath, segmentsPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected cache path %q to be deleted, stat error: %v", path, err)
		}
	}
	var taskCount, infoCount int
	if err := database.QueryRow(ctx, "SELECT COUNT(*) FROM download_tasks WHERE id = ?", taskID).Scan(&taskCount); err != nil {
		t.Fatalf("query deleted task: %v", err)
	}
	if err := database.QueryRow(ctx, "SELECT COUNT(*) FROM video_infos WHERE task_id = ?", taskID).Scan(&infoCount); err != nil {
		t.Fatalf("query deleted video info: %v", err)
	}
	if taskCount != 0 || infoCount != 0 {
		t.Fatalf("expected database records to be deleted, task=%d info=%d", taskCount, infoCount)
	}
	if payload, ok := eventBus.GetLastEvent("task:deleted").(map[string]any); !ok || payload["taskId"] != taskID || payload["taskType"] != "video" {
		t.Fatalf("expected task:deleted event, got %#v", eventBus.GetLastEvent("task:deleted"))
	}
	if summary := tracker.GetSummary(taskID); summary.TotalSegments != 0 {
		t.Fatalf("expected tracker state to be cleared, got %+v", summary)
	}
}

func taskDeleteRequest(h *Handlers, id int) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/api/tasks/"+strconv.Itoa(id), nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("id", strconv.Itoa(id))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()
	h.TaskDelete(response, req)
	return response
}

func TestTaskDeleteKeepsSharedOutputUntilLastReference(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	root := t.TempDir()
	managerConfig := video.DefaultManagerConfig()
	managerConfig.DownloadPath = filepath.Join(root, "videos")
	managerConfig.SegmentsPath = filepath.Join(root, "segments")
	manager := video.NewDownloadManager(database, nil, managerConfig)
	filePath := filepath.Join(managerConfig.DownloadPath, "shared.mp4")
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("shared"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{101, 102} {
		if _, err := database.Exec(context.Background(),
			"INSERT INTO download_tasks (id, url, file_path) VALUES (?, ?, ?)", id, "https://example.com/video", filePath); err != nil {
			t.Fatal(err)
		}
	}
	h := &Handlers{DB: database, DownloadMgr: manager, DataDir: root}
	if response := taskDeleteRequest(h, 101); response.Code != http.StatusOK {
		t.Fatalf("first delete status: %d %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("shared output was removed too early: %v", err)
	}
	if response := taskDeleteRequest(h, 102); response.Code != http.StatusOK {
		t.Fatalf("second delete status: %d %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("shared output still exists: %v", err)
	}
}

func TestGalleryDeleteRemovesFilesAndChildRows(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	root := t.TempDir()
	savePath := filepath.Join(root, "galleries", "gallery_501")
	imagePath := filepath.Join(savePath, "image.jpg")
	zipPath := filepath.Join(savePath, "gallery_501.zip")
	if err := os.MkdirAll(savePath, 0755); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{imagePath, zipPath} {
		if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	if _, err := database.Exec(ctx, "INSERT INTO galleries (id, source_url, save_path) VALUES (501, 'https://example.com/gallery', ?)", savePath); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(ctx, "INSERT INTO gallery_images (gallery_id, url, local_path) VALUES (501, 'https://example.com/image', ?)", imagePath); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(ctx, "INSERT INTO gallery_download_infos (gallery_id, local_path) VALUES (501, ?)", zipPath); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(ctx, "INSERT INTO gallery_file_progress (gallery_id, file_index, local_path) VALUES (501, 0, ?)", imagePath); err != nil {
		t.Fatal(err)
	}
	h := &Handlers{DB: database, DataDir: root}
	req := httptest.NewRequest(http.MethodDelete, "/api/shelf/501", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("id", "501")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()
	h.ShelfDelete(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	for _, path := range []string{savePath, imagePath, zipPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected %q to be deleted, got %v", path, err)
		}
	}
	for _, table := range []string{"gallery_images", "gallery_download_infos", "gallery_file_progress"} {
		var count int
		if err := database.QueryRow(ctx, "SELECT COUNT(*) FROM "+table+" WHERE gallery_id = 501").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected %s rows to be deleted, got %d", table, count)
		}
	}
}

func TestTaskDeleteRejectsOutputOutsideDataDir(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.mp4")
	if err := os.WriteFile(outside, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(context.Background(),
		"INSERT INTO download_tasks (id, url, file_path) VALUES (?, ?, ?)", 201, "https://example.com/video", outside); err != nil {
		t.Fatal(err)
	}
	managerConfig := video.DefaultManagerConfig()
	managerConfig.DownloadPath = filepath.Join(root, "videos")
	managerConfig.SegmentsPath = filepath.Join(root, "segments")
	h := &Handlers{DB: database, DownloadMgr: video.NewDownloadManager(database, nil, managerConfig), DataDir: root}
	response := taskDeleteRequest(h, 201)
	if response.Code != http.StatusConflict {
		t.Fatalf("expected conflict, got %d: %s", response.Code, response.Body.String())
	}
	var count int
	if err := database.QueryRow(context.Background(), "SELECT COUNT(*) FROM download_tasks WHERE id = 201").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected task to remain, got %d", count)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("outside file was changed: %v", err)
	}
}
