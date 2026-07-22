package orchestrator

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"backend/internal/infra"
)

// OuoOrchestrator handles OUO short-link resolution, mirroring the
// TypeScript OUOOrchestrator that resolves ouo.io relay URLs to
// their direct download targets.
type OuoOrchestrator struct {
	logger *infra.Logger
	client *http.Client
}

// NewOuoOrchestrator creates an OUO resolver with a configured HTTP client.
func NewOuoOrchestrator() *OuoOrchestrator {
	return &OuoOrchestrator{
		logger: infra.NewLogger("OuoOrchestrator"),
		client: &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		},
	}
}

// Resolve resolves an OUO short link to its direct download URL by
// following the redirect chain and extracting the final URL.
func (o *OuoOrchestrator) Resolve(ctx context.Context, ouoURL string) (string, error) {
	if ouoURL == "" {
		return "", fmt.Errorf("empty OUO URL")
	}

	if !strings.Contains(ouoURL, "ouo.io") && !strings.Contains(ouoURL, "ouo.press") {
		o.logger.Info("URL is not an OUO link, returning as-is", "url", ouoURL)
		return ouoURL, nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", ouoURL, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request OUO link: %w", err)
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()
	if finalURL == ouoURL {
		o.logger.Warn("OUO resolution returned same URL, might need manual bypass", "url", ouoURL)
	}
	o.logger.Info("OUO link resolved", "original", ouoURL, "resolved", finalURL)
	return finalURL, nil
}

// ResolveBatch resolves multiple OUO links concurrently using
// goroutines, returning a map of input URL to resolved URL or error.
func (o *OuoOrchestrator) ResolveBatch(ctx context.Context, urls []string) map[string]result {
	var mu sync.Mutex
	results := make(map[string]result, len(urls))
	var wg sync.WaitGroup

	for _, url := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			resolved, err := o.Resolve(ctx, u)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				results[u] = result{Error: err}
			} else {
				results[u] = result{Value: resolved}
			}
		}(url)
	}

	wg.Wait()
	return results
}

// result is a simple value-or-error container for batch operations.
type result struct {
	Value string
	Error error
}
