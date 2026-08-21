package dagclient

import (
	"encoding/json"
	"fmt"
)

type DagClientError struct {
	Message      string
	StatusCode   int
	Endpoint     string
	ResponseBody any
}

func (e *DagClientError) Error() string {
	return e.Message
}

func (e *DagClientError) IsNetworkError() bool {
	return e.StatusCode == 0
}

func (e *DagClientError) IsNotFound() bool {
	return e.StatusCode == 404
}

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
