package dagclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is the HTTP client for the PuchiPix Go backend API, mirroring
// the TypeScript DagClient SDK.
type Client struct {
	baseURL    string
	httpClient *http.Client
	headers    map[string]string
}

// New creates a Client targeting the given host and port.
func New(host, port string) *Client {
	baseURL := fmt.Sprintf("http://%s:%s", host, port)
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		headers: map[string]string{
			"Accept": "application/json",
		},
	}
}

// BaseURL returns the fully qualified base URL the client connects to.
func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) GetAllDags() (*DagListResponse, error) {
	var resp DagListResponse
	if err := c.get("/api/dag", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetDag(dagID string) (*DagDetailResponse, error) {
	var resp DagDetailResponse
	path := fmt.Sprintf("/api/dag/%s", url.PathEscape(dagID))
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetDagEvents(dagID string, limit, fromSeq int) (*DagEventsResponse, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", min(limit, 1000)))
	}
	if fromSeq > 0 {
		params.Set("fromSeq", fmt.Sprintf("%d", fromSeq))
	}
	qs := params.Encode()
	path := fmt.Sprintf("/api/dag/%s/events", url.PathEscape(dagID))
	if qs != "" {
		path += "?" + qs
	}
	var resp DagEventsResponse
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) PauseDag(dagID string) (*DagControlResponse, error) {
	return c.controlDag(dagID, ActionPause, "")
}

func (c *Client) ResumeDag(dagID, nodeID string) (*DagControlResponse, error) {
	return c.controlDag(dagID, ActionResume, nodeID)
}

func (c *Client) RetryDag(dagID, nodeID string) (*DagControlResponse, error) {
	return c.controlDag(dagID, ActionRetry, nodeID)
}

func (c *Client) CancelDag(dagID string) (*DagControlResponse, error) {
	return c.controlDag(dagID, ActionCancel, "")
}

// CreateDag submits a new DAG definition to the backend.
func (c *Client) CreateDag(req DagCreateRequest) (*DagCreateResponse, error) {
	var resp DagCreateResponse
	if err := c.post("/api/dag", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CreateTask submits a new task via POST /api/tasks, mirroring the
// frontend's fetch("/api/tasks", { method: "POST", body: { url } }).
func (c *Client) CreateTask(req TaskCreateRequest) (*TaskCreateResponse, error) {
	var resp TaskCreateResponse
	if err := c.post("/api/tasks", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// AddDependency adds a runtime dependency edge between two nodes in a DAG.
func (c *Client) AddDependency(dagID, parentID, childID string) (*DagLinkResponse, error) {
	body := DagLinkRequest{ParentID: parentID, ChildID: childID}
	var resp DagLinkResponse
	path := fmt.Sprintf("/api/dag/%s/link", url.PathEscape(dagID))
	if err := c.post(path, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// TriggerDag re-activates any pending/ready nodes in a DAG, useful after
// modifying dependencies or recovering from a stuck state.
func (c *Client) TriggerDag(dagID string) (*DagControlResponse, error) {
	var resp DagControlResponse
	path := fmt.Sprintf("/api/dag/%s/trigger", url.PathEscape(dagID))
	if err := c.post(path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// DeleteDag removes a completed, cancelled, or failed DAG from the
// orchestrator's memory. Active DAGs must be cancelled first.
func (c *Client) DeleteDag(dagID string) (*DagDeleteResponse, error) {
	var resp DagDeleteResponse
	path := fmt.Sprintf("/api/dag/%s", url.PathEscape(dagID))
	if err := c.delete(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetSchedulerStats() (*SchedulerStats, error) {
	var resp SchedulerStats
	if err := c.get("/api/dag/scheduler", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetSlotStatus() (*SlotStatusResponse, error) {
	var resp SlotStatusResponse
	if err := c.get("/api/dag/slots", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetWorkerStatus() (*WorkerStatus, error) {
	var resp WorkerStatus
	if err := c.get("/api/worker/status", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) RestartWorker() (*WorkerRestartResponse, error) {
	var resp WorkerRestartResponse
	if err := c.post("/api/worker/restart", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetWorkerLogs(lines int) ([]string, error) {
	path := "/api/worker/logs"
	if lines > 0 {
		path = fmt.Sprintf("%s?lines=%d", path, lines)
	}
	var resp []string
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (c *Client) QueryLogs(filter LogQueryFilter) ([]LogEntry, error) {
	params := url.Values{}
	if filter.Module != "" {
		params.Set("module", filter.Module)
	}
	if filter.DagID != "" {
		params.Set("dagId", filter.DagID)
	}
	if filter.NodeID != "" {
		params.Set("nodeId", filter.NodeID)
	}
	if filter.TraceID != "" {
		params.Set("traceId", filter.TraceID)
	}
	if filter.Level != "" {
		params.Set("level", filter.Level)
	}
	if filter.Limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", filter.Limit))
	}
	qs := params.Encode()
	path := "/api/logs/history"
	if qs != "" {
		path += "?" + qs
	}
	var resp []LogEntry
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// ── Health / System / Stats ──

// GetHealth checks server health and database connectivity.
func (c *Client) GetHealth() (*HealthResponse, error) {
	var resp HealthResponse
	if err := c.get("/api/health", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetSystem returns runtime system information.
func (c *Client) GetSystem() (*SystemResponse, error) {
	var resp SystemResponse
	if err := c.get("/api/system", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetStats returns aggregate dashboard statistics.
func (c *Client) GetStats() (*StatsResponse, error) {
	var resp StatsResponse
	if err := c.get("/api/stats", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ── Sites ──

// GetSites returns the list of supported site providers.
func (c *Client) GetSites() ([]SiteInfo, error) {
	var resp []SiteInfo
	if err := c.get("/api/sites", &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// ── Download Tasks (video) ──

// GetTasks returns a paginated list of download tasks.
func (c *Client) GetTasks(limit, offset int) ([]DownloadTask, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if offset > 0 {
		params.Set("offset", fmt.Sprintf("%d", offset))
	}
	qs := params.Encode()
	path := "/api/tasks"
	if qs != "" {
		path += "?" + qs
	}
	var resp []DownloadTask
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// GetTask returns a single download task by ID.
func (c *Client) GetTask(id int) (*DownloadTask, error) {
	var resp DownloadTask
	path := fmt.Sprintf("/api/tasks/%d", id)
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// TaskAction performs an action (start/pause/resume/cancel/retry) on a task.
func (c *Client) TaskAction(id int, action string) (*TaskActionResponse, error) {
	body := TaskActionRequest{Action: action}
	var resp TaskActionResponse
	path := fmt.Sprintf("/api/tasks/%d", id)
	if err := c.post(path, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// DeleteTask removes a download task by ID.
func (c *Client) DeleteTask(id int) error {
	path := fmt.Sprintf("/api/tasks/%d", id)
	return c.delete(path, nil)
}

// ── Galleries ──

// GetGalleries returns a paginated list of galleries, optionally filtered by status.
func (c *Client) GetGalleries(limit, offset int, status string) ([]GallerySummary, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if offset > 0 {
		params.Set("offset", fmt.Sprintf("%d", offset))
	}
	if status != "" {
		params.Set("status", status)
	}
	qs := params.Encode()
	path := "/api/shelf"
	if qs != "" {
		path += "?" + qs
	}
	var resp []GallerySummary
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// GetGallery returns a single gallery by ID.
func (c *Client) GetGallery(id int) (*GalleryDetail, error) {
	var resp GalleryDetail
	path := fmt.Sprintf("/api/shelf/%d", id)
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GalleryAction performs an action (retry-failed/pause/resume/download) on a gallery.
func (c *Client) GalleryAction(id int, action string) (*GalleryActionResponse, error) {
	body := GalleryActionRequest{Action: action}
	var resp GalleryActionResponse
	path := fmt.Sprintf("/api/shelf/%d", id)
	if err := c.post(path, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// DeleteGallery removes a gallery and its associated images/videos.
func (c *Client) DeleteGallery(id int) error {
	path := fmt.Sprintf("/api/shelf/%d", id)
	return c.delete(path, nil)
}

// GetGalleryFileProgress returns per-file progress for a gallery.
func (c *Client) GetGalleryFileProgress(id int) (*GalleryFileProgressResponse, error) {
	var resp GalleryFileProgressResponse
	path := fmt.Sprintf("/api/shelf/%d/files/progress", id)
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ── Slot Holders / Slot Detail / Slot Update ──

// GetSlotHolders returns active holder IDs for all slot types.
func (c *Client) GetSlotHolders() (*SlotHoldersResponse, error) {
	var resp SlotHoldersResponse
	if err := c.get("/api/slots/holders", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetSlotDetail returns detailed info for a single slot type.
func (c *Client) GetSlotDetail(slotType string) (*SlotDetailResponse, error) {
	var resp SlotDetailResponse
	path := fmt.Sprintf("/api/slots/%s", url.PathEscape(slotType))
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// UpdateSlotMax dynamically adjusts the max concurrency for a slot type.
func (c *Client) UpdateSlotMax(slotType string, max int) (*SlotUpdateResponse, error) {
	body := SlotUpdateRequest{Max: max}
	var resp SlotUpdateResponse
	path := fmt.Sprintf("/api/slots/%s", url.PathEscape(slotType))
	if err := c.put(path, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetStreamURL returns the SSE endpoint URL for real-time DAG events.
func (c *Client) GetStreamURL() string {
	return c.baseURL + "/api/dag/stream"
}

// GetLogStreamURL returns the SSE endpoint URL for real-time log entries,
// with optional query filters appended.
func (c *Client) GetLogStreamURL(filter LogQueryFilter) string {
	base := c.baseURL + "/api/logs"
	params := url.Values{}
	if filter.Module != "" {
		params.Set("module", filter.Module)
	}
	if filter.DagID != "" {
		params.Set("dagId", filter.DagID)
	}
	if filter.NodeID != "" {
		params.Set("nodeId", filter.NodeID)
	}
	if filter.TraceID != "" {
		params.Set("traceId", filter.TraceID)
	}
	if filter.Level != "" {
		params.Set("level", filter.Level)
	}
	if filter.Limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", filter.Limit))
	}
	qs := params.Encode()
	if qs != "" {
		return base + "?" + qs
	}
	return base
}

func (c *Client) controlDag(dagID string, action DagControlAction, nodeID string) (*DagControlResponse, error) {
	body := map[string]string{
		"action": string(action),
	}
	if nodeID != "" {
		body["nodeId"] = nodeID
	}
	path := fmt.Sprintf("/api/dag/%s/control", url.PathEscape(dagID))
	var resp DagControlResponse
	if err := c.post(path, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) get(path string, target any) error {
	return c.request(http.MethodGet, path, nil, target)
}

func (c *Client) post(path string, body any, target any) error {
	return c.request(http.MethodPost, path, body, target)
}

func (c *Client) delete(path string, target any) error {
	return c.request(http.MethodDelete, path, nil, target)
}

func (c *Client) put(path string, body any, target any) error {
	return c.request(http.MethodPut, path, body, target)
}

func (c *Client) request(method, path string, body any, target any) error {
	fullURL := c.baseURL + path

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return newNetworkError(c.baseURL, path, err)
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return newNetworkError(c.baseURL, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return newNetworkError(c.baseURL, path, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newHTTPError(respBody, resp.StatusCode, path)
	}

	if len(respBody) == 0 {
		return nil
	}

	if err := json.Unmarshal(respBody, target); err != nil {
		return &DagClientError{
			Message:    fmt.Sprintf("response parse error: %s", truncateStr(string(respBody), 200)),
			StatusCode: resp.StatusCode,
			Endpoint:   path,
		}
	}
	return nil
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
