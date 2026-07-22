package dagclient

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// SseHandler is called for each parsed SSE event.
type SseHandler func(event SseEvent)

// SseErrorHandler is called when the stream encounters an error.
type SseErrorHandler func(err error)

// SSEClient subscribes to a Server-Sent Events endpoint and dispatches
// parsed events to a handler, mirroring the TypeScript SseClient.
type SSEClient struct {
	url       string
	onEvent   SseHandler
	onError   SseErrorHandler
	httpClient *http.Client
	cancel    context.CancelFunc
}

// NewSSEClient creates an SSE client for the given URL with the
// provided event and error handlers.
func NewSSEClient(url string, onEvent SseHandler, onError SseErrorHandler) *SSEClient {
	return &SSEClient{
		url:        url,
		onEvent:    onEvent,
		onError:    onError,
		httpClient: &http.Client{},
	}
}

// Connect opens the SSE connection and blocks until the stream ends
// or Close is called. Parsed events are dispatched to the handler.
func (c *SSEClient) Connect() error {
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if c.onError != nil {
			c.onError(err)
		}
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("SSE connection failed: HTTP %d", resp.StatusCode)
		if c.onError != nil {
			c.onError(err)
		}
		return err
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	var eventType, dataLines strings.Builder
	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			if eventType.Len() > 0 {
				c.dispatchEvent(eventType.String(), dataLines.String())
				eventType.Reset()
				dataLines.Reset()
			}
			continue
		}

		if strings.HasPrefix(line, "event: ") {
			eventType.WriteString(strings.TrimPrefix(line, "event: "))
		} else if strings.HasPrefix(line, "data: ") {
			if dataLines.Len() > 0 {
				dataLines.WriteString("\n")
			}
			dataLines.WriteString(strings.TrimPrefix(line, "data: "))
		} else if line == "event:" {
			eventType.Reset()
		}
	}

	if err := scanner.Err(); err != nil && c.onError != nil {
		c.onError(err)
	}
	return nil
}

func (c *SSEClient) dispatchEvent(eventType, dataStr string) {
	if eventType == "keepalive" || dataStr == "" {
		return
	}
	c.onEvent(SseEvent{
		Type: eventType,
		Data: []byte(dataStr),
	})
}

// Close terminates the SSE connection.
func (c *SSEClient) Close() {
	if c.cancel != nil {
		c.cancel()
	}
}

// SetTimeout configures the HTTP client timeout for the SSE connection.
func (c *SSEClient) SetTimeout(d time.Duration) {
	c.httpClient.Timeout = d
}
