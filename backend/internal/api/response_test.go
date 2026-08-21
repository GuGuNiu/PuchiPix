package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "value"})

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"key":"value"`)
}

func TestWriteJSONNilData(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusNoContent, nil)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Empty(t, w.Body.String())
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "something went wrong")

	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), `"error":"something went wrong"`)
}

func TestDecodeJSONValid(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", strings.NewReader(`{"name":"test"}`))
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.True(t, ok)
	assert.Equal(t, "test", dst.Name)
}

func TestDecodeJSONMissingBody(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", nil)
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestDecodeJSONMalformed(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/test", strings.NewReader(`{invalid`))
	w := httptest.NewRecorder()

	var dst struct{ Name string }
	ok := decodeJSON(w, req, &dst)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

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
