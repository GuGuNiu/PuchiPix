package dagclient

import (
	"encoding/json"
	"fmt"
)

// DagClientError classifies API failures so the CLI can apply
// differentiated error handling (network, not-found, server error).
type DagClientError struct {
	Message      string
	StatusCode   int
	Endpoint     string
	ResponseBody any
}

func (e *DagClientError) Error() string {
	return e.Message
}

// IsNetworkError reports whether the failure originated from a network
// condition (connection refused, timeout, DNS) rather than an HTTP
// response.
func (e *DagClientError) IsNetworkError() bool {
	return e.StatusCode == 0
}

// IsNotFound reports whether the server returned 404.
func (e *DagClientError) IsNotFound() bool {
	return e.StatusCode == 404
}

// IsServerError reports whether the server returned a 5xx status.
func (e *DagClientError) IsServerError() bool {
	return e.StatusCode >= 500
}

func newNetworkError(baseURL, endpoint string, err error) *DagClientError {
	return &DagClientError{
		Message:  fmt.Sprintf("cannot connect to %s%s: %s", baseURL, endpoint, err),
		Endpoint: endpoint,
	}
}

func newHTTPError(body []byte, status int, endpoint string) *DagClientError {
	errMsg := extractErrorMessage(body)
	if errMsg == "" {
		errMsg = fmt.Sprintf("HTTP %d", status)
	}
	return &DagClientError{
		Message:      errMsg,
		StatusCode:   status,
		Endpoint:     endpoint,
		ResponseBody: string(body),
	}
}

// extractErrorMessage attempts to pull an "error" field from a JSON
// error body, matching the Go backend's writeError contract.
func extractErrorMessage(body []byte) string {
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return ""
	}
	if s, ok := m["error"].(string); ok {
		return s
	}
	return ""
}
