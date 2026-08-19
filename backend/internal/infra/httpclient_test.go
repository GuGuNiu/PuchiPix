package infra

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewHTTPClientDefaultTimeout verifies that a zero-or-negative
// timeout falls back to the default, preventing a client with no
// timeout from hanging indefinitely on a dead server.
func TestNewHTTPClientDefaultTimeout(t *testing.T) {
	c := NewHTTPClient(0)
	assert.Equal(t, DefaultHTTPTimeout, c.Timeout)

	c2 := NewHTTPClient(-1)
	assert.Equal(t, DefaultHTTPTimeout, c2.Timeout)
}

// TestNewHTTPClientCustomTimeout verifies that a positive timeout
// is respected, allowing callers to tune latency for fast endpoints.
func TestNewHTTPClientCustomTimeout(t *testing.T) {
	c := NewHTTPClient(5 * time.Second)
	assert.Equal(t, 5*time.Second, c.Timeout)
}

// TestHTTPClientGET verifies end-to-end request execution through a
// test server, ensuring the client sends and receives correctly.
func TestHTTPClientGET(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GET", r.Method)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello"))
	}))
	defer server.Close()

	c := NewHTTPClient(5 * time.Second)
	resp, err := c.Get(server.URL)
	require.NoError(t, err)
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, "hello", string(body))
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// TestHTTPClientRedirectLimit verifies that the client follows up to
// 10 redirects but stops beyond that, preventing infinite loops.
func TestHTTPClientRedirectLimit(t *testing.T) {
	redirectCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectCount++
		if redirectCount <= 15 {
			http.Redirect(w, r, r.URL.Path, http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewHTTPClient(5 * time.Second)
	resp, err := c.Get(server.URL)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.NotEqual(t, http.StatusOK, resp.StatusCode, "should not reach the final handler after >10 redirects")
}

// TestHTTPClientTimeoutEnforced verifies that the client timeout
// actually fires when the server is slow to respond.
func TestHTTPClientTimeoutEnforced(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewHTTPClient(100 * time.Millisecond)
	_, err := c.Get(server.URL)
	assert.Error(t, err)
}
