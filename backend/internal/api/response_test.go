package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestWriteJSON verifies that writeJSON sets the correct content type
// and encodes the payload, ensuring the API contract is consistent.
func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "value"})

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"key":"value"`)
}

// TestWriteJSONNilData verifies that a nil payload produces an empty
// body without errors, allowing handlers to signal "no content" cleanly.
func TestWriteJSONNilData(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusNoContent, nil)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Empty(t, w.Body.String())
}

// TestWriteError verifies that error responses follow the uniform
// {"error":"message"} envelope expected by the frontend.
func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "something went wrong")

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), `"error":"something went wrong"`)
}

// TestDecodeJSONValid verifies that a well-formed JSON body is
// decoded into the target struct.
func TestDecodeJSONValid(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", strings.NewReader(`{"name":"test"}`))
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.True(t, ok)
	assert.Equal(t, "test", dst.Name)
}

// TestDecodeJSONMissingBody verifies that a missing body returns
// false and writes a 400 error.
func TestDecodeJSONMissingBody(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", nil)
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestDecodeJSONMalformed verifies that malformed JSON returns
// false and writes a 400 error.
func TestDecodeJSONMalformed(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", strings.NewReader(`{invalid`))
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestQueryInt verifies that queryInt parses numeric params and
// falls back to the default for missing or non-numeric values.
func TestQueryInt(t *testing.T) {
	tests := []struct {
		name   string
		url    string
		key    string
		def    int
		expect int
	}{
		{"valid", "/api/test?page=42", "page", 1, 42},
		{"missing", "/api/test", "page", 1, 1},
		{"non-numeric", "/api/test?page=abc", "page", 1, 1},
		{"empty", "/api/test?page=", "page", 10, 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.url, nil)
			result := queryInt(req, tt.key, tt.def)
			assert.Equal(t, tt.expect, result)
		})
	}
}
