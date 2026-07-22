package executors_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/orchestrator/executors"
)

// TestRegistryRegisterAndGet verifies that the executor registry stores
// executors by key and retrieves them correctly, enabling the scheduler
// to route node execution to the right handler.
func TestRegistryRegisterAndGet(t *testing.T) {
	r := executors.NewRegistry()

	scrape := executors.NewScrapeExecutor(nil)
	r.Register(scrape)

	got := r.Get("scrape")
	require.NotNil(t, got)
	assert.Equal(t, "scrape", got.Key())
}

// TestRegistryGetNotFound verifies that retrieving a non-existent
// executor returns nil, allowing callers to check before dispatching.
func TestRegistryGetNotFound(t *testing.T) {
	r := executors.NewRegistry()
	assert.Nil(t, r.Get("nonexistent"))
}

// TestScrapeExecutorKey verifies the executor's routing key matches the
// expected value for DAG node dispatch.
func TestScrapeExecutorKey(t *testing.T) {
	e := executors.NewScrapeExecutor(nil)
	assert.Equal(t, "scrape", e.Key())
}

// TestScrapeExecutorNoURL verifies that executing a scrape node without
// a URL in its config returns an error, preventing wasted HTTP requests
// with empty targets.
func TestScrapeExecutorNoURL(t *testing.T) {
	e := executors.NewScrapeExecutor(nil)
	_, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no url")
}

// TestScrapeExecutorNoProviderFn verifies that a scrape executor without
// a provider function simulates success, allowing DAG dry-runs in test
// environments.
func TestScrapeExecutorNoProviderFn(t *testing.T) {
	e := executors.NewScrapeExecutor(nil)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{"url": "https://example.com"},
	})
	require.NoError(t, err)
	assert.True(t, success)
}

// TestScrapeExecutorWithProvider verifies that the scrape executor
// delegates to the provider function and returns success when the
// provider returns data.
func TestScrapeExecutorWithProvider(t *testing.T) {
	called := false
	providerFn := func(ctx context.Context, url string) (map[string]any, error) {
		called = true
		assert.Equal(t, "https://example.com/gallery/1", url)
		return map[string]any{"title": "Test Gallery"}, nil
	}

	e := executors.NewScrapeExecutor(providerFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{"url": "https://example.com/gallery/1"},
	})
	require.NoError(t, err)
	assert.True(t, success)
	assert.True(t, called, "provider function should be called")
}

// TestScrapeExecutorProviderError verifies that a provider function
// error propagates as a failed execution, triggering retry logic.
func TestScrapeExecutorProviderError(t *testing.T) {
	providerFn := func(ctx context.Context, url string) (map[string]any, error) {
		return nil, errors.New("HTTP 503: service unavailable")
	}

	e := executors.NewScrapeExecutor(providerFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{"url": "https://example.com"},
	})
	assert.False(t, success)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "503")
}

// TestDownloadExecutorKey verifies the executor's routing key.
func TestDownloadExecutorKey(t *testing.T) {
	e := executors.NewDownloadExecutor(nil)
	assert.Equal(t, "download", e.Key())
}

// TestDownloadExecutorNoFn verifies that a download executor without a
// download function simulates success, allowing DAG dry-runs.
func TestDownloadExecutorNoFn(t *testing.T) {
	e := executors.NewDownloadExecutor(nil)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{
			"url":      "https://example.com/file.zip",
			"savePath": "/tmp/downloads",
		},
	})
	require.NoError(t, err)
	assert.True(t, success)
}

// TestDownloadExecutorWithFn verifies that the download executor
// delegates to the provided function with the correct parameters.
func TestDownloadExecutorWithFn(t *testing.T) {
	var receivedURL, receivedPath string
	var receivedDomains []string

	dlFn := func(ctx context.Context, url, savePath string, domains []string) error {
		receivedURL = url
		receivedPath = savePath
		receivedDomains = domains
		return nil
	}

	e := executors.NewDownloadExecutor(dlFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{
			"url":             "https://primary.example.com/file.zip",
			"savePath":        "/tmp/downloads",
			"fallbackDomains": []any{"fallback1.example.com", "fallback2.example.com"},
		},
	})
	require.NoError(t, err)
	assert.True(t, success)
	assert.Equal(t, "https://primary.example.com/file.zip", receivedURL)
	assert.Equal(t, "/tmp/downloads", receivedPath)
	assert.Equal(t, []string{"fallback1.example.com", "fallback2.example.com"}, receivedDomains)
}

// TestDownloadExecutorFnError verifies that a download function error
// propagates as a failed execution.
func TestDownloadExecutorFnError(t *testing.T) {
	dlFn := func(ctx context.Context, url, savePath string, domains []string) error {
		return errors.New("connection refused")
	}

	e := executors.NewDownloadExecutor(dlFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{"url": "https://example.com", "savePath": "/tmp"},
	})
	assert.False(t, success)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "connection refused")
}

// TestVerifyExecutorKey verifies the executor's routing key.
func TestVerifyExecutorKey(t *testing.T) {
	e := executors.NewVerifyExecutor(nil)
	assert.Equal(t, "verify", e.Key())
}

// TestVerifyExecutorNoFn verifies that a verify executor without a
// verify function simulates success.
func TestVerifyExecutorNoFn(t *testing.T) {
	e := executors.NewVerifyExecutor(nil)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
	})
	require.NoError(t, err)
	assert.True(t, success)
}

// TestVerifyExecutorPassed verifies that a "passed" status returns
// success without error.
func TestVerifyExecutorPassed(t *testing.T) {
	verifyFn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
		return "passed", 0, "all files verified"
	}

	e := executors.NewVerifyExecutor(verifyFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
	})
	require.NoError(t, err)
	assert.True(t, success)
}

// TestVerifyExecutorNeedsRetry verifies that a "needs_retry" status
// returns an error containing the reason, triggering the retry path
// in the DAG orchestrator.
func TestVerifyExecutorNeedsRetry(t *testing.T) {
	verifyFn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
		return "needs_retry", 0, "3 images missing"
	}

	e := executors.NewVerifyExecutor(verifyFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
	})
	assert.False(t, success)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "needs_retry")
	assert.Contains(t, err.Error(), "3 images missing")
}

// TestVerifyExecutorFailed verifies that a "failed" status returns an
// error, marking the node as permanently failed.
func TestVerifyExecutorFailed(t *testing.T) {
	verifyFn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
		return "failed", 0, "file checksum mismatch"
	}

	e := executors.NewVerifyExecutor(verifyFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
	})
	assert.False(t, success)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "verification failed")
	assert.Contains(t, err.Error(), "checksum mismatch")
}

// TestExtractExecutorKey verifies the executor's routing key.
func TestExtractExecutorKey(t *testing.T) {
	e := executors.NewExtractExecutor(nil)
	assert.Equal(t, "extract", e.Key())
}

// TestExtractExecutorNoFn verifies that an extract executor without an
// extract function simulates success.
func TestExtractExecutorNoFn(t *testing.T) {
	e := executors.NewExtractExecutor(nil)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{
			"archivePath": "/tmp/archive.zip",
			"destPath":    "/tmp/extracted",
		},
	})
	require.NoError(t, err)
	assert.True(t, success)
}

// TestExtractExecutorWithFn verifies that the extract executor delegates
// to the provided function with the correct parameters.
func TestExtractExecutorWithFn(t *testing.T) {
	var receivedArchive, receivedDest, receivedPassword string

	extractFn := func(ctx context.Context, archivePath, destPath, password string) error {
		receivedArchive = archivePath
		receivedDest = destPath
		receivedPassword = password
		return nil
	}

	e := executors.NewExtractExecutor(extractFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{
			"archivePath": "/tmp/archive.zip",
			"destPath":    "/tmp/extracted",
			"password":    "secret123",
		},
	})
	require.NoError(t, err)
	assert.True(t, success)
	assert.Equal(t, "/tmp/archive.zip", receivedArchive)
	assert.Equal(t, "/tmp/extracted", receivedDest)
	assert.Equal(t, "secret123", receivedPassword)
}

// TestExtractExecutorFnError verifies that an extract function error
// propagates as a failed execution.
func TestExtractExecutorFnError(t *testing.T) {
	extractFn := func(ctx context.Context, archivePath, destPath, password string) error {
		return errors.New("corrupt archive")
	}

	e := executors.NewExtractExecutor(extractFn)
	success, err := e.Execute(context.Background(), executors.ExecutorNode{
		NodeID: "node-1",
		Config: map[string]any{"archivePath": "/tmp/bad.zip", "destPath": "/tmp/out"},
	})
	assert.False(t, success)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "corrupt archive")
}

// TestReplaceDomainNoScheme verifies that ReplaceDomain returns the
// original URL unchanged when it has no scheme, preventing malformed
// output for non-URL inputs.
func TestReplaceDomainNoScheme(t *testing.T) {
	result := executors.ReplaceDomain("not-a-url", "fallback.example.com")
	assert.Equal(t, "not-a-url", result)
}

// TestReplaceDomainNoPath verifies that ReplaceDomain works correctly
// for URLs without a path component, replacing only the domain.
func TestReplaceDomainNoPath(t *testing.T) {
	result := executors.ReplaceDomain("https://primary.example.com", "fallback.example.com")
	assert.Equal(t, "https://fallback.example.com", result)
}

// TestReplaceDomainWithPath verifies that ReplaceDomain preserves the
// path and query string when swapping domains.
func TestReplaceDomainWithPath(t *testing.T) {
	result := executors.ReplaceDomain("https://primary.example.com/path/to/file.zip?query=1", "fallback.example.com")
	assert.Equal(t, "https://fallback.example.com/path/to/file.zip?query=1", result)
}

// TestDownloadWithDomainFallbackNilTryFn verifies that a nil try function
// returns an error rather than panicking.
func TestDownloadWithDomainFallbackNilTryFn(t *testing.T) {
	err := executors.DownloadWithDomainFallback(context.Background(), "https://example.com", []string{"fb.com"}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no try function")
}

// TestDownloadWithDomainFallbackAllFail verifies that when all domains
// fail, the last error is returned, enabling the caller to log the
// specific failure reason.
func TestDownloadWithDomainFallbackAllFail(t *testing.T) {
	tryFn := func(ctx context.Context, url string) error {
		return errors.New("503 service unavailable")
	}

	err := executors.DownloadWithDomainFallback(context.Background(),
		"https://primary.example.com/file.zip",
		[]string{"fallback.example.com"},
		tryFn,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "503")
}

// TestDownloadWithDomainFallbackNoFallbacks verifies that when no
// fallback domains are provided and the primary fails, the primary's
// error is returned.
func TestDownloadWithDomainFallbackNoFallbacks(t *testing.T) {
	callCount := 0
	tryFn := func(ctx context.Context, url string) error {
		callCount++
		return errors.New("connection timeout")
	}

	err := executors.DownloadWithDomainFallback(context.Background(),
		"https://primary.example.com/file.zip",
		nil,
		tryFn,
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timeout")
	assert.Equal(t, 1, callCount, "only the primary URL should be tried")
}

// TestDownloadWithDomainFallbackFirstSucceeds verifies that when the
// primary URL succeeds, no fallback domains are tried.
func TestDownloadWithDomainFallbackFirstSucceeds(t *testing.T) {
	callCount := 0
	tryFn := func(ctx context.Context, url string) error {
		callCount++
		return nil
	}

	err := executors.DownloadWithDomainFallback(context.Background(),
		"https://primary.example.com/file.zip",
		[]string{"fallback.example.com"},
		tryFn,
	)
	require.NoError(t, err)
	assert.Equal(t, 1, callCount, "only the primary URL should be tried")
}
