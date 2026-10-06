package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

type unifiedMetadataTask struct {
	TaskType string   `json:"TaskType"`
	Tags     []string `json:"Tags"`
	Actors   []string `json:"Actors"`
}

func newUnifiedMetadataTestDatabase(t *testing.T) *db.Database {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "metadata.db"), infra.NewLogger("MetadataTest"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func assertUnifiedMetadataTasks(t *testing.T, tasks []unifiedMetadataTask) {
	t.Helper()
	if len(tasks) != 2 {
		t.Fatalf("task count = %d, want 2: %#v", len(tasks), tasks)
	}
	byType := make(map[string]unifiedMetadataTask, len(tasks))
	for _, task := range tasks {
		byType[task.TaskType] = task
	}
	if got := byType["gallery"].Tags; !reflect.DeepEqual(got, []string{"红色", "兔女郎"}) {
		t.Fatalf("gallery tags = %#v", got)
	}
	if got := byType["gallery"].Actors; !reflect.DeepEqual(got, []string{"南条彩"}) {
		t.Fatalf("gallery actors = %#v", got)
	}
	if got := byType["video"].Tags; !reflect.DeepEqual(got, []string{"剧情", "多人"}) {
		t.Fatalf("video tags = %#v", got)
	}
	if got := byType["video"].Actors; !reflect.DeepEqual(got, []string{"Aya Nanjo", "Alice"}) {
		t.Fatalf("video actors = %#v", got)
	}
}

func TestUnifiedTaskEndpointsReturnGalleryAndVideoMetadata(t *testing.T) {
	database := newUnifiedMetadataTestDatabase(t)
	ctx := context.Background()
	if _, err := database.Exec(ctx,
		`INSERT INTO download_tasks (id, url, seq) VALUES (1, 'https://example.com/video', 'V0001')`); err != nil {
		t.Fatalf("insert video task: %v", err)
	}
	if _, err := database.Exec(ctx,
		`INSERT INTO video_infos (task_id, title, tags, actors) VALUES (1, 'video', ?, ?)`,
		`["剧情","多人"]`, `["Aya Nanjo","Alice"]`); err != nil {
		t.Fatalf("insert video info: %v", err)
	}
	if _, err := database.Exec(ctx,
		`INSERT INTO galleries (id, source_url, seq, title, protagonist, tags) VALUES (1, 'https://example.com/gallery', 'G0001', 'gallery', '南条彩', ?)`,
		`["红色","兔女郎"]`); err != nil {
		t.Fatalf("insert gallery: %v", err)
	}

	handler := &Handlers{DB: database}

	t.Run("all", func(t *testing.T) {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/tasks/all", nil)
		handler.TaskListUnified(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", response.Code, response.Body.String())
		}
		var tasks []unifiedMetadataTask
		if err := json.Unmarshal(response.Body.Bytes(), &tasks); err != nil {
			t.Fatalf("decode tasks: %v", err)
		}
		assertUnifiedMetadataTasks(t, tasks)
	})

	t.Run("page", func(t *testing.T) {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/tasks/page?page=1&pageSize=100", nil)
		handler.TaskPage(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Tasks []unifiedMetadataTask `json:"tasks"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode page: %v", err)
		}
		assertUnifiedMetadataTasks(t, payload.Tasks)
	})

	t.Run("shelf", func(t *testing.T) {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/shelf", nil)
		handler.ShelfList(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", response.Code, response.Body.String())
		}
		var galleries []struct {
			Tags []string `json:"Tags"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &galleries); err != nil {
			t.Fatalf("decode shelf: %v", err)
		}
		if len(galleries) != 1 || !reflect.DeepEqual(galleries[0].Tags, []string{"红色", "兔女郎"}) {
			t.Fatalf("shelf tags = %#v", galleries)
		}
	})
}

func TestTaskStreamInitialSnapshotIncludesMetadata(t *testing.T) {
	database := newUnifiedMetadataTestDatabase(t)
	ctx := context.Background()
	if _, err := database.Exec(ctx,
		`INSERT INTO download_tasks (id, url, seq) VALUES (1, 'https://example.com/video', 'V0001')`); err != nil {
		t.Fatalf("insert video task: %v", err)
	}
	if _, err := database.Exec(ctx,
		`INSERT INTO video_infos (task_id, title, tags, actors) VALUES (1, 'video', ?, ?)`,
		`["剧情","多人"]`, `["Aya Nanjo","Alice"]`); err != nil {
		t.Fatalf("insert video info: %v", err)
	}
	if _, err := database.Exec(ctx,
		`INSERT INTO galleries (id, source_url, seq, title, protagonist, tags) VALUES (1, 'https://example.com/gallery', 'G0001', 'gallery', '南条彩', ?)`,
		`["红色","兔女郎"]`); err != nil {
		t.Fatalf("insert gallery: %v", err)
	}

	handler := &Handlers{DB: database}
	server := httptest.NewServer(http.HandlerFunc(handler.TaskStreamSSE))
	defer server.Close()

	requestCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("create stream request: %v", err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer response.Body.Close()

	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "event: initial" {
			continue
		}
		if !scanner.Scan() {
			t.Fatalf("missing initial data: %v", scanner.Err())
		}
		data := strings.TrimPrefix(scanner.Text(), "data: ")
		var payload struct {
			Tasks []unifiedMetadataTask `json:"tasks"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			t.Fatalf("decode initial event: %v", err)
		}
		assertUnifiedMetadataTasks(t, payload.Tasks)
		cancel()
		return
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read stream: %v", err)
	}
	t.Fatal("initial SSE event not received")
}
