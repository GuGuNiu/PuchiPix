package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestShelfListNoDB verifies that the shelf list endpoint returns
// an empty array when no database is configured.
func TestShelfListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/shelf", nil)
	w := httptest.NewRecorder()
	h.ShelfList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestShelfDetailNoDB verifies that fetching a gallery detail without
// a database returns a 503 error.
func TestShelfDetailNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/shelf/1", nil)
	req.SetPathValue("id", "1")
	w := httptest.NewRecorder()
	h.ShelfDetail(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestSjsBookmarksListNoDB verifies that the SJS bookmarks list
// returns an empty array without a database.
func TestSjsBookmarksListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/shelf/sjs", nil)
	w := httptest.NewRecorder()
	h.SjsBookmarksList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSjsBookmarksCreateNoDB verifies that creating a bookmark without
// a database returns a 503 error.
func TestSjsBookmarksCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/shelf/sjs", strings.NewReader(`{"url":"https://example.com","threadId":"t1"}`))
	w := httptest.NewRecorder()
	h.SjsBookmarksCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPreviewNoGalleryId verifies that the preview endpoint rejects
// requests without a galleryId parameter.
func TestPreviewNoGalleryId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/preview", nil)
	w := httptest.NewRecorder()
	h.Preview(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestPreviewNoDB verifies that the preview endpoint returns empty
// arrays when no database is configured but a galleryId is provided.
func TestPreviewNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/preview?galleryId=1", nil)
	w := httptest.NewRecorder()
	h.Preview(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "images")
}

// TestProtagonistsNoDB verifies that the protagonists endpoint returns
// an empty array without a database.
func TestProtagonistsNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/protagonists", nil)
	w := httptest.NewRecorder()
	h.Protagonists(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestHistoryNoDB verifies that the history endpoint returns an
// empty array without a database.
func TestHistoryNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/history", nil)
	w := httptest.NewRecorder()
	h.History(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSjsBookmarksDeleteMissingUrl verifies that deleting a bookmark
// without a URL parameter returns a 400 error.
func TestSjsBookmarksDeleteMissingUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("DELETE", "/api/shelf/sjs", nil)
	w := httptest.NewRecorder()
	h.SjsBookmarksDelete(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestShelfDetailInvalidId verifies that fetching a shelf detail with
// a non-numeric ID returns 503 because the nil-DB guard fires first.
func TestShelfDetailInvalidId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/shelf/abc", nil)
	req.SetPathValue("id", "abc")
	w := httptest.NewRecorder()
	h.ShelfDetail(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestPreviewInvalidGalleryId verifies that a non-numeric galleryId
// is rejected with 400.
func TestPreviewInvalidGalleryId(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/preview?galleryId=abc", nil)
	w := httptest.NewRecorder()
	h.Preview(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestSjsBookmarksCreateMissingFields verifies that creating a bookmark
// without required fields returns 503 because the nil-DB guard fires first.
func TestSjsBookmarksCreateMissingFields(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/shelf/sjs", strings.NewReader(`{"url":"https://example.com"}`))
	w := httptest.NewRecorder()
	h.SjsBookmarksCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestSjsBookmarksCreateBadJson verifies that malformed JSON returns 503
// because the nil-DB guard fires before JSON decoding.
func TestSjsBookmarksCreateBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/shelf/sjs", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.SjsBookmarksCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}
