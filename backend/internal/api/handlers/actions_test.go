package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/infra"
)

// TestScrapeNoUrl verifies that the scrape endpoint rejects requests
// without a URL, preventing ambiguity in downstream processing.
func TestScrapeNoUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/scrape", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.Scrape(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestScrapeNotImplemented verifies that a valid scrape request returns
// 501 until the Provider layer is integrated.
func TestScrapeNotImplemented(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/scrape", strings.NewReader(`{"url":"https://example.com"}`))
	w := httptest.NewRecorder()
	h.Scrape(w, req)

	assert.Equal(t, http.StatusNotImplemented, w.Code)
}

// TestScrapeBadJson verifies that malformed JSON is rejected with 400.
func TestScrapeBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/scrape", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.Scrape(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestSniffListNoDB verifies that the sniff list endpoint returns an
// empty array when no database is configured.
func TestSniffListNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/sniff", nil)
	w := httptest.NewRecorder()
	h.SniffList(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSniffCreateNoDB verifies that creating a sniff task without a
// database returns a 503 error.
func TestSniffCreateNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/sniff", strings.NewReader(`{"url":"https://example.com"}`))
	w := httptest.NewRecorder()
	h.SniffCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestSniffCreateMissingUrl verifies that creating a sniff task without
// a URL returns 503 because the nil-DB guard fires before field validation.
func TestSniffCreateMissingUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/sniff", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.SniffCreate(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestSearchNoKeywords verifies that search without keywords returns 400.
func TestSearchNoKeywords(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/search", nil)
	w := httptest.NewRecorder()
	h.Search(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestSearchNoDB verifies that search with keywords but no DB returns
// an empty array, keeping the UI functional in degraded mode.
func TestSearchNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/search?keywords=test", nil)
	w := httptest.NewRecorder()
	h.Search(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSearchViaJsonBody verifies that keywords can be passed via JSON
// body when not present in query parameters.
func TestSearchViaJsonBody(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/search", strings.NewReader(`{"keywords":"test"}`))
	w := httptest.NewRecorder()
	h.Search(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSearchBatchEmpty verifies that batch search with an empty keywords
// array is rejected with 400.
func TestSearchBatchEmpty(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/search/batch", strings.NewReader(`{"keywords":[]}`))
	w := httptest.NewRecorder()
	h.SearchBatch(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestSearchBatchNotImplemented verifies that batch search without
// a database returns an empty array (degraded mode).
func TestSearchBatchNotImplemented(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/search/batch", strings.NewReader(`{"keywords":["a","b"]}`))
	w := httptest.NewRecorder()
	h.SearchBatch(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

// TestSearchBatchBadJson verifies that malformed JSON is rejected.
func TestSearchBatchBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/search/batch", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.SearchBatch(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestOuoNotImplemented verifies that the OUO endpoint returns
// 503 when the OUO orchestrator is not injected.
func TestOuoNotImplemented(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/ouo", strings.NewReader(`{"url":"https://example.com"}`))
	w := httptest.NewRecorder()
	h.Ouo(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestProxyMissingUrl verifies that proxy without a URL is rejected.
func TestProxyMissingUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestProxyBadJson verifies that malformed JSON is rejected.
func TestProxyBadJson(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(`{invalid}`))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestProxyInvalidUrl verifies that an unparseable URL returns 400.
func TestProxyInvalidUrl(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(`{"url":"://bad"}`))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestProxySuccess verifies that a valid proxy request forwards the
// response from the target server.
func TestProxySuccess(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("proxied content"))
	}))
	defer target.Close()

	h := New(nil, infra.NewEventBus())
	body := `{"url":"` + target.URL + `"}`
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "proxied content", w.Body.String())
}

// TestProxyWithMethodAndBody verifies that the proxy respects custom
// HTTP methods and request bodies.
func TestProxyWithMethodAndBody(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()

	h := New(nil, infra.NewEventBus())
	body := `{"url":"` + target.URL + `","method":"POST","body":"{\"test\":1}"}`
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
}

// TestProxyDefaultMethod verifies that the proxy defaults to GET when
// no method is specified.
func TestProxyDefaultMethod(t *testing.T) {
	var receivedMethod string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	h := New(nil, infra.NewEventBus())
	body := `{"url":"` + target.URL + `"}`
	req := httptest.NewRequest("POST", "/api/proxy", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Proxy(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "GET", receivedMethod)
}

// TestSjsNotImplemented verifies that the SJS endpoint returns
// 501 when the SiteRegistry is not injected.
func TestSjsNotImplemented(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("POST", "/api/sjs", strings.NewReader(`{"action":"checkin"}`))
	w := httptest.NewRecorder()
	h.Sjs(w, req)

	assert.Equal(t, http.StatusNotImplemented, w.Code)
}

// TestCharacterDBMissingName verifies that a character query without
// a name parameter is rejected with 400.
func TestCharacterDBMissingName(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/character-db", nil)
	w := httptest.NewRecorder()
	h.CharacterDB(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestCharacterDBNoDB verifies that a character query with a name but
// no database returns an empty array.
func TestCharacterDBNoDB(t *testing.T) {
	h := New(nil, infra.NewEventBus())
	req := httptest.NewRequest("GET", "/api/character-db?name=test", nil)
	w := httptest.NewRecorder()
	h.CharacterDB(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}
