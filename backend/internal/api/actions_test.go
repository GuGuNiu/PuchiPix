package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateProxyTargetRejectsPrivateTargets(t *testing.T) {
	cases := []string{
		"http://127.0.0.1/",
		"http://localhost/",
		"http://[::1]/",
		"file:///tmp/test",
	}
	for _, target := range cases {
		if err := validateProxyTarget(target); err == nil {
			t.Fatalf("target %q was accepted", target)
		}
	}
}

func TestBlocklistBatchDeleteReportsActualRows(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	for _, id := range []int{301, 302} {
		if _, err := database.Exec(reqContext(), "INSERT INTO blocklist_rules (id, site_id, field_type, keyword, match_mode, enabled) VALUES (?, 'all', 'title', ?, 'includes', 1)", id, "keyword-"+string(rune('0'+id))); err != nil {
			t.Fatal(err)
		}
	}
	h := &Handlers{DB: database}
	req := httptest.NewRequest(http.MethodDelete, "/api/blocklist?ids=301,302,999", nil)
	response := httptest.NewRecorder()
	h.BlocklistDelete(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"deleted":2`) || !strings.Contains(response.Body.String(), `"missing":1`) {
		t.Fatalf("unexpected batch result: %s", response.Body.String())
	}
}

func reqContext() context.Context {
	return context.Background()
}

func TestSjsShelfCreatePersistsThreadIDAndReportsFailures(t *testing.T) {
	database := newTaskDeleteTestDatabase(t)
	h := &Handlers{DB: database}
	req := httptest.NewRequest(http.MethodPost, "/api/shelf/sjs", strings.NewReader(`{"urls":["https://sjs.example/thread-123-1-2.html","not-a-url"]}`))
	response := httptest.NewRecorder()
	h.SjsShelfCreate(response, req)
	if response.Code != http.StatusMultiStatus {
		t.Fatalf("expected multi-status, got %d: %s", response.Code, response.Body.String())
	}
	var threadID string
	if err := database.QueryRow(req.Context(), "SELECT thread_id FROM sjs_bookmarks ORDER BY id LIMIT 1").Scan(&threadID); err != nil {
		t.Fatal(err)
	}
	if threadID != "123" {
		t.Fatalf("unexpected thread id %q", threadID)
	}
	var count int
	if err := database.QueryRow(req.Context(), "SELECT COUNT(*) FROM sjs_bookmarks").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one bookmark, got %d", count)
	}
}
