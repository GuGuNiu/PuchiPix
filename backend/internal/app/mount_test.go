package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMountAssetsRoutesAPIPathsToBackend(t *testing.T) {
	apiRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"servedBy":"api"}`))
	})
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html>servedBy=assets</html>`))
	})

	h := mountAssets(apiRouter, assets)

	for _, path := range []string{"/api", "/api/", "/api/health", "/api/tasks/stream"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if !strings.Contains(rec.Body.String(), `"servedBy":"api"`) {
			t.Fatalf("path %s did not reach the API router (got %q)", path, rec.Body.String())
		}
	}
}

func TestMountAssetsRoutesEverythingElseToAssets(t *testing.T) {
	apiRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"servedBy":"api"}`))
	})
	assets := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html>servedBy=assets</html>`))
	})

	h := mountAssets(apiRouter, assets)

	for _, path := range []string{"/", "/index.html", "/assets/index-abc.js", "/shelf/1"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if !strings.Contains(rec.Body.String(), "servedBy=assets") {
			t.Fatalf("path %s did not reach the assets handler (got %q)", path, rec.Body.String())
		}
	}
}