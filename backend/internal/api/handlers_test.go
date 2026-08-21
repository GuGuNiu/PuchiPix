package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/api"
	"backend/internal/infra"
)

func newTestServer() *httptest.Server {
	infra.InitGlobalConfig("DEBUG", true)
	eventBus := infra.NewEventBus()
	h := api.New(nil, eventBus)
	router := api.NewRouter(h)
	return httptest.NewServer(router)
}

func TestHealthEndpoint(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatalf("GET /api/health failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("status field = %v, want \"ok\"", body["status"])
	}
}

func TestSystemEndpoint(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/system")
	if err != nil {
		t.Fatalf("GET /api/system failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["goVersion"] == nil {
		t.Error("goVersion field is missing")
	}
	if body["goroutines"] == nil {
		t.Error("goroutines field is missing")
	}
}

func TestNotFoundEndpoint(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/nonexistent")
	if err != nil {
		t.Fatalf("GET /api/nonexistent failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["error"] == "" {
		t.Error("error field is empty")
	}
}

func TestMethodNotAllowed(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/health", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /api/health failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}

func TestI18nLocaleSwitching(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	tests := []struct {
		locale   string
		nonEmpty bool
	}{
		{"zh-CN", true},
		{"en-US", true},
		{"ja-JP", true},
		{"ko-KR", true},
		{"xx-XX", true},
	}

	for _, tt := range tests {
		t.Run("locale_"+tt.locale, func(t *testing.T) {
			req, _ := http.NewRequest("GET", srv.URL+"/api/nonexistent", nil)
			req.Header.Set("x-locale", tt.locale)

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()

			var body map[string]string
			json.NewDecoder(resp.Body).Decode(&body)

			if tt.nonEmpty && body["error"] == "" {
				t.Errorf("locale %s: error message is empty", tt.locale)
			}
		})
	}
}

// TestI18nZhVsEn verifies that zh-CN and en-US produce different error
// messages for the same endpoint.
func TestI18nZhVsEn(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	getError := func(locale string) string {
		req, _ := http.NewRequest("GET", srv.URL+"/api/nonexistent", nil)
		req.Header.Set("x-locale", locale)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		defer resp.Body.Close()
		var body map[string]string
		json.NewDecoder(resp.Body).Decode(&body)
		return body["error"]
	}

	zhMsg := getError("zh-CN")
	enMsg := getError("en-US")

	if zhMsg == enMsg {
		t.Errorf("zh-CN and en-US returned the same message: %q", zhMsg)
	}
}

// TestSSELogStream verifies that the /api/logs SSE endpoint returns a
// text/event-stream content type.
func TestSSELogStream(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/logs")
	if err != nil {
		t.Fatalf("GET /api/logs failed: %v", err)
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
}

// TestSSEDagStream verifies that the /api/dag/stream SSE endpoint returns
// a text/event-stream content type.
func TestSSEDagStream(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/dag/stream")
	if err != nil {
		t.Fatalf("GET /api/dag/stream failed: %v", err)
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
}

// TestDagListNilDB verifies that the DAG list endpoint returns an empty
// array (not a crash) when the database is unavailable.
func TestDagListNilDB(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/dag")
	if err != nil {
		t.Fatalf("GET /api/dag failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d, want 200 or 500", resp.StatusCode)
	}

	if resp.StatusCode == http.StatusOK {
		var arr []any
		if err := json.Unmarshal(body, &arr); err != nil {
			t.Errorf("expected JSON array, got: %s", string(body))
		}
	}
}

// TestAccountsCRUDNilDB verifies that account CRUD endpoints return
// appropriate error responses when the database is unavailable.
func TestAccountsCRUDNilDB(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"list nil db", "GET", "/api/accounts", "", http.StatusOK},
		{"create nil db", "POST", "/api/accounts", `{"siteId":"test","username":"user"}`, http.StatusServiceUnavailable},
		{"create bad json nil db", "POST", "/api/accounts", `{invalid}`, http.StatusServiceUnavailable},
		{"create missing body nil db", "POST", "/api/accounts", "", http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body io.Reader
			if tt.body != "" {
				body = strings.NewReader(tt.body)
			}
			req, _ := http.NewRequest(tt.method, srv.URL+tt.path, body)
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.want {
				body, _ := io.ReadAll(resp.Body)
				t.Errorf("status = %d, want %d (body: %s)", resp.StatusCode, tt.want, string(body))
			}
		})
	}
}

// TestCORSEnabled verifies that CORS headers are present in responses.
func TestCORSEnabled(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	req, _ := http.NewRequest("OPTIONS", srv.URL+"/api/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "GET")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS request failed: %v", err)
	}
	defer resp.Body.Close()

	origin := resp.Header.Get("Access-Control-Allow-Origin")
	if origin == "" {
		t.Error("CORS Access-Control-Allow-Origin header is missing")
	}
}

// TestEndpointRegistration verifies that all major API endpoint groups
// are registered and accessible (not returning 404 for valid paths).
func TestEndpointRegistration(t *testing.T) {
	srv := newTestServer()
	defer srv.Close()

	endpoints := []struct {
		method string
		path   string
	}{
		{"GET", "/api/health"},
		{"GET", "/api/system"},
		{"GET", "/api/stats"},
		{"GET", "/api/sites"},
		{"GET", "/api/logs/history"},
		{"GET", "/api/dag"},
		{"GET", "/api/tasks"},
		{"GET", "/api/shelf"},
		{"GET", "/api/accounts"},
		{"GET", "/api/persons"},
		{"GET", "/api/blocklist"},
		{"GET", "/api/config"},
		{"GET", "/api/preferences"},
		{"GET", "/api/task-settings"},
		{"GET", "/api/search"},
		{"GET", "/api/history"},
		{"GET", "/api/protagonists"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+"_"+ep.path, func(t *testing.T) {
			req, _ := http.NewRequest(ep.method, srv.URL+ep.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode == http.StatusNotFound {
				t.Errorf("%s %s returned 404 ??endpoint not registered", ep.method, ep.path)
			}
		})
	}
}
