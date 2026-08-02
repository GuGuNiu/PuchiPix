package dagclient

import (
	"encoding/json"
	"fmt"
)

// NodeState mirrors the orchestrator NodeState string type so the CLI
// can parse DAG node states without importing the backend package.
type NodeState string

const (
	NodeStatePending      NodeState = "pending"
	NodeStateReady        NodeState = "ready"
	NodeStateQueued       NodeState = "queued"
	NodeStateAllocated    NodeState = "allocated"
	NodeStateRunning      NodeState = "running"
	NodeStatePaused       NodeState = "paused"
	NodeStateVerifying    NodeState = "verifying"
	NodeStateResumeVerify NodeState = "resume_verify"
	NodeStateCompleted    NodeState = "completed"
	NodeStateFailed       NodeState = "failed"
	NodeStateCancelled    NodeState = "cancelled"
	NodeStateTimeout      NodeState = "timeout"
	NodeStateNeedsRetry   NodeState = "needs_retry"
)

type TaskType string

const (
	TaskTypeGallery TaskType = "gallery"
	TaskTypeVideo   TaskType = "video"
	TaskTypeSniff   TaskType = "sniff"
)

type TaskPhase string

const (
	PhaseCreate   TaskPhase = "create"
	PhaseScrape   TaskPhase = "scrape"
	PhaseDownload TaskPhase = "download"
	PhaseFinalize TaskPhase = "finalize"
)

type DagControlAction string

const (
	ActionPause   DagControlAction = "pause"
	ActionResume  DagControlAction = "resume"
	ActionRetry   DagControlAction = "retry"
	ActionCancel  DagControlAction = "cancel"
	ActionCreate  DagControlAction = "create"
	ActionLink    DagControlAction = "link"
	ActionTrigger DagControlAction = "trigger"
	ActionDelete  DagControlAction = "delete"
)

type NodeError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type NodeExecutionResult struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *NodeError      `json:"error,omitempty"`
}

type ResourceRequirement struct {
	SlotType  string `json:"slotType"`
	Count     int    `json:"count"`
	HoldUntil string `json:"holdUntil"`
}

type DagProgress struct {
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
	Running   int `json:"running"`
	Paused    int `json:"paused"`
	Queued    int `json:"queued"`
}

type NodeSummary struct {
	NodeID    string            `json:"nodeId"`
	State     NodeState         `json:"state"`
	Error     *NodeError        `json:"error"`
	HasResult bool              `json:"hasResult"`
	HistCount int               `json:"historyCount"`
	LastTrans *LastTransition  `json:"lastTransition"`
}

type LastTransition struct {
	From        NodeState `json:"from"`
	To          NodeState `json:"to"`
	Reason      string    `json:"reason"`
	TriggeredBy string    `json:"triggeredBy"`
	Timestamp   string    `json:"timestamp"`
}

type DagSummary struct {
	DagID      string        `json:"dagId"`
	TaskType   TaskType      `json:"taskType"`
	State      string        `json:"state"`     // API returns aggregate state directly
	SourceURL  string        `json:"sourceUrl"`
	CreatedAt  string        `json:"createdAt"`
	NodeCount  int           `json:"nodeCount"`
	Progress   DagProgress   `json:"progress,omitempty"`
	Nodes      []NodeSummary `json:"nodes,omitempty"`
}

type DagStats struct {
	TotalDags  int `json:"totalDags"`
	ActiveDags int `json:"activeDags"`
	TotalNodes int `json:"totalNodes"`
}

type SchedulerStats struct {
	QueueSize  int            `json:"queueSize"`
	ByPriority map[string]int `json:"byPriority"`
	ByTaskType map[string]int `json:"byTaskType"`
	Strategy   string         `json:"strategy"`
}

type SlotUsage struct {
	SlotType  string `json:"slotType"`
	Current   int    `json:"current"`
	Max       int    `json:"max"`
	Available int    `json:"available"`
}

// DagListResponse handles the /api/dag endpoint which may return either
// a JSON array (legacy) or an object with dags+stats (newer clients).
// We unmarshal into a flexible structure and normalize in the caller.
type DagListResponse struct {
	Dags  []DagSummary    `json:"dags"`
	Stats *DagListStats   `json:"stats"`
	// Raw captures the response if it's a plain array.
	Raw   []DagSummary    `json:"-"`
}

// UnmarshalJSON implements custom unmarshaling to handle both array and
// object response formats from the backend.
func (d *DagListResponse) UnmarshalJSON(data []byte) error {
	// Try object format first.
	type aux struct {
		Dags  []DagSummary   `json:"dags"`
		Stats *DagListStats  `json:"stats"`
	}
	var a aux
	if err := json.Unmarshal(data, &a); err == nil && (len(a.Dags) > 0 || a.Stats != nil) {
		d.Dags = a.Dags
		d.Stats = a.Stats
		return nil
	}
	// Fallback: plain array.
	var arr []DagSummary
	if err := json.Unmarshal(data, &arr); err == nil {
		d.Dags = arr
		d.Stats = nil
		return nil
	}
	return fmt.Errorf("DagListResponse: cannot unmarshal %s", string(data))
}

type DagListStats struct {
	DagStats
	Scheduler SchedulerStats        `json:"scheduler"`
	Slots     map[string]SlotUsage  `json:"slots"`
}

type DagNodeDefinition struct {
	ID                   string                `json:"id"`
	Phase                TaskPhase             `json:"phase"`
	Executor             string                `json:"executor"`
	Priority             int                   `json:"priority"`
	Dependencies         []string              `json:"dependencies"`
	ResourceRequirements []ResourceRequirement `json:"resourceRequirements"`
	Timeout              int                   `json:"timeout,omitempty"`
	MaxRetries           int                   `json:"maxRetries,omitempty"`
}

type StateTransitionRecord struct {
	From        NodeState   `json:"from"`
	To          NodeState   `json:"to"`
	Timestamp   string      `json:"timestamp"`
	Reason      string      `json:"reason"`
	TriggeredBy string      `json:"triggeredBy"`
	Error       *NodeError  `json:"error,omitempty"`
}

type NodeDetail struct {
	NodeID  string                  `json:"nodeId"`
	State   NodeState               `json:"state"`
	Error   *NodeError              `json:"error"`
	Result  *NodeExecutionResult    `json:"result"`
	History []StateTransitionRecord `json:"history"`
}

type DagDefinition struct {
	NodeCount int                  `json:"nodeCount"`
	Nodes     []DagNodeDefinition  `json:"nodes"`
}

// DagDetailResponse matches GET /api/dag/{id}.
// The backend returns a simplified shape:
//
//	{"id": "...", "state": "...", "nodes": [{"nodeId":..., "state":..., "phase":...}]}
//
// dagId, taskType, sourceUrl etc. are optional in the response. The CLI
// derives display fields from what's present.
type DagDetailResponse struct {
	DagID      string         `json:"id"`       // API uses "id" not "dagId"
	State      string         `json:"state"`    // Aggregate state (optional)
	TaskType   TaskType       `json:"taskType"`
	SourceURL  string         `json:"sourceUrl"`
	ProviderID string         `json:"providerId,omitempty"`
	CreatedAt  string         `json:"createdAt"`
	Definition DagDefinition  `json:"definition,omitempty"`
	Nodes      []SimplifiedNodeDetail `json:"nodes"`
	WorkerDown bool           `json:"workerDown,omitempty"`
}

// SimplifiedNodeDetail matches the lightweight node info from DagDetail.
type SimplifiedNodeDetail struct {
	NodeID    string    `json:"nodeId"`
	State     NodeState `json:"state"`
	Phase     TaskPhase `json:"phase"`
	Error     *NodeError `json:"error,omitempty"`
}

type DagControlResponse struct {
	DagID    string             `json:"dagId"`
	Action   DagControlAction   `json:"action"`
	Snapshot *DagDetailResponse  `json:"snapshot"`
}

type DagEvent struct {
	Seq       int64           `json:"seq"`
	Type      string          `json:"type"`
	DagID     string          `json:"dagId"`
	NodeID    string          `json:"nodeId,omitempty"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

type DagEventsResponse struct {
	DagID       string     `json:"dagId"`
	Events      []DagEvent `json:"events"`
	TotalEvents int        `json:"totalEvents"`
	CurrentSeq  int        `json:"currentSeq"`
}

type SlotStats struct {
	TotalSlots      int     `json:"totalSlots"`
	UsedSlots       int     `json:"usedSlots"`
	AvailableSlots  int     `json:"availableSlots"`
	UtilizationRate float64 `json:"utilizationRate"`
}

type DownloadConcurrency struct {
	TsSegmentConcurrent    int `json:"tsSegmentConcurrent"`
	GalleryImageConcurrent  int `json:"galleryImageConcurrent"`
}

type SlotStatusResponse struct {
	Snapshot            map[string]SlotUsage `json:"snapshot"`
	Stats               SlotStats            `json:"stats"`
	DownloadConcurrency DownloadConcurrency  `json:"downloadConcurrency"`
}

// LogEntry matches the Go backend StructuredLogEntry JSON output. The
// Context field is decoded as a generic map because the backend LogContext
// struct lacks JSON tags, producing PascalCase keys (TraceID, DagID, etc.)
// that differ from the TypeScript camelCase contract.
type LogEntry struct {
	Timestamp  string          `json:"timestamp"`
	Level      string          `json:"level"`
	LevelValue int             `json:"levelValue"`
	Module     string          `json:"module"`
	Message    string          `json:"message"`
	Context    map[string]any  `json:"context"`
	Data       json.RawMessage `json:"data,omitempty"`
}

// TraceID extracts the trace identifier from the context map, handling
// both camelCase and PascalCase key variants.
func (e LogEntry) TraceID() string {
	return ctxString(e.Context, "traceId", "TraceID")
}

// DagID extracts the DAG identifier from the context map.
func (e LogEntry) DagID() string {
	return ctxString(e.Context, "dagId", "DagID")
}

// NodeID extracts the node identifier from the context map.
func (e LogEntry) NodeID() string {
	return ctxString(e.Context, "nodeId", "NodeID")
}

// TaskTypeStr extracts the task type from the context map.
func (e LogEntry) TaskTypeStr() string {
	return ctxString(e.Context, "taskType", "TaskType")
}

// PhaseStr extracts the phase from the context map.
func (e LogEntry) PhaseStr() string {
	return ctxString(e.Context, "phase", "Phase")
}

func ctxString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

type WorkerStatus struct {
	Status       string `json:"status"`
	PID          *int   `json:"pid"`
	Uptime       *int64 `json:"uptime"`
	RestartCount int    `json:"restartCount"`
	LastExitCode *int   `json:"lastExitCode"`
}

type WorkerRestartResponse struct {
	OldPID  int   `json:"oldPid"`
	NewPID  int   `json:"newPid"`
	ReadyMs int64 `json:"readyMs"`
}

// DagCreateRequest is the payload for creating a new DAG via the API.
type DagCreateRequest struct {
	TaskType   string `json:"taskType"`
	SourceURL  string `json:"sourceUrl,omitempty"`
	ProviderID string `json:"providerId,omitempty"`
	GalleryID  int    `json:"galleryId,omitempty"`
	TaskID     int    `json:"taskId,omitempty"`
}

// DagCreateResponse is the response for a DAG creation request.
type DagCreateResponse struct {
	DagID    string `json:"dagId"`
	TaskType string `json:"taskType"`
	Status   string `json:"status"`
}

// TaskCreateRequest matches the POST /api/tasks payload.
type TaskCreateRequest struct {
	URL      string `json:"url"`
	Format   string `json:"format,omitempty"`
	Seq      string `json:"seq,omitempty"`
	Priority int    `json:"priority,omitempty"`
}

// TaskCreateResponse matches the POST /api/tasks response body.
// Handles both video task format (ID, DisplayID, Status, SiteID) and
// gallery task format (type, galleryId, seq, status, dagId).
// JSON tags accept both PascalCase (TS frontend contract) and lowercase
// (Go map literal) field names via custom unmarshaling.
type TaskCreateResponse struct {
	ID        int    `json:"ID"`        // Video task ID
	GalleryID int    `json:"galleryId"` // Gallery task ID (alternative)
	DisplayID string `json:"DisplayID"`
	Seq       string `json:"seq"`       // Gallery task Seq (alternative)
	Status    string `json:"status"`    // lowercase matches Go map literal response
	SiteID    string `json:"siteId"`    // lowercase matches Go map literal
	TaskType  string `json:"type"`      // "gallery" / "video" / "sniff"
	DagID     string `json:"dagId"`     // Associated DAG ID
}

// GalleryIDOrID returns the gallery ID for gallery tasks, or ID for video tasks.
func (t *TaskCreateResponse) GalleryIDOrID() int {
	if t.GalleryID != 0 {
		return t.GalleryID
	}
	return t.ID
}

// EffectiveSeq returns the effective sequence ID (seq or DisplayID).
func (t *TaskCreateResponse) EffectiveSeq() string {
	if t.Seq != "" {
		return t.Seq
	}
	return t.DisplayID
}

// DagLinkRequest is the payload for adding a dependency edge.
type DagLinkRequest struct {
	ParentID string `json:"parentId"`
	ChildID  string `json:"childId"`
}

// DagLinkResponse confirms a dependency was added.
type DagLinkResponse struct {
	DagID    string `json:"dagId"`
	ParentID string `json:"parentId"`
	ChildID  string `json:"childId"`
	Status   string `json:"status"`
}

// DagDeleteResponse confirms a DAG was removed.
type DagDeleteResponse struct {
	DagID  string `json:"dagId"`
	Status string `json:"status"`
}

// SseEvent represents a single Server-Sent Events message parsed from
// the event stream.
type SseEvent struct {
	Type string          `json:"-"`
	Data json.RawMessage `json:"-"`
}

// ── Health / System / Stats ──

// HealthResponse matches GET /api/health output.
type HealthResponse struct {
	Status   string `json:"status"`
	Time     string `json:"time"`
	Database string `json:"database"`
}

// SystemResponse matches GET /api/system output.
type SystemResponse struct {
	Version    string `json:"version"`
	GoVersion  string `json:"goVersion"`
	Goroutines int    `json:"goroutines"`
	MemAlloc   uint64 `json:"memAlloc"`
	MemSys     uint64 `json:"memSys"`
	Uptime     string `json:"uptime"`
	CPUCores   int    `json:"cpuCores"`
}

// StatsResponse matches GET /api/stats output. Fields are loosely
// typed because the backend assembles this map dynamically.
type StatsResponse struct {
	Galleries         int            `json:"galleries"`
	Tasks             int            `json:"tasks"`
	DownloadHistory   int            `json:"downloadHistory"`
	CurrentSpeedStr   string         `json:"current_speed_str"`
	DiskIOStr         string         `json:"disk_io_str"`
	SlotUsage         map[string]any `json:"slotUsage,omitempty"`
	SchedulerQueueSize int           `json:"schedulerQueueSize,omitempty"`
	SchedulerByPriority map[string]int `json:"schedulerByPriority,omitempty"`
	DagTotal          int            `json:"dagTotal,omitempty"`
	DagActive         int            `json:"dagActive,omitempty"`
}

// ── Sites ──

// SiteInfo represents a supported site provider entry from
// GET /api/sites.
type SiteInfo struct {
	SiteID      string   `json:"siteId"`
	Name        string   `json:"name"`
	Domains     []string `json:"domains"`
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
}

// ── Download Tasks (video) ──

// DownloadTask matches the backend db.DownloadTask JSON output.
// JSON tags use PascalCase to match the backend contract.
type DownloadTask struct {
	ID        int     `json:"ID"`
	URL       string  `json:"URL"`
	M3U8URL   string  `json:"M3U8URL"`
	Status    string  `json:"Status"`
	Progress  float64 `json:"Progress"`
	FilePath  string  `json:"FilePath"`
	Format    string  `json:"Format"`
	Priority  int     `json:"Priority"`
	ErrorMsg  string  `json:"ErrorMsg"`
	SiteID    string  `json:"SiteID"`
	DisplayID *string `json:"DisplayID"`
	CreatedAt string  `json:"CreatedAt"`
	UpdatedAt string  `json:"UpdatedAt"`
}

// TaskActionRequest is the body for POST /api/tasks/{id}.
type TaskActionRequest struct {
	Action string `json:"action"`
}

// TaskActionResponse is the response for POST /api/tasks/{id}.
type TaskActionResponse struct {
	ID     int    `json:"id"`
	DagID  string `json:"dagId,omitempty"`
	Status string `json:"status"`
}

// ── Galleries ──

// GallerySummary is a compact gallery representation for list views.
// The backend returns full Gallery structs; we only need key fields
// for the CLI table output. Since the API returns full Gallery JSON,
// all fields are present — we just use a subset for display.
type GallerySummary struct {
	ID             int     `json:"ID"`
	DisplayID      *string `json:"DisplayID"`
	SourceURL      string  `json:"SourceURL"`
	SiteID         string  `json:"SiteID"`
	Title          string  `json:"Title"`
	Protagonist    string  `json:"Protagonist"`
	Status         string  `json:"Status"`
	ImageCount     int     `json:"ImageCount"`
	VideoCount     int     `json:"VideoCount"`
	TotalSize      int64   `json:"TotalSize"`
	DownloadedSize int64   `json:"DownloadedSize"`
	ErrorMsg       string  `json:"ErrorMsg"`
	CreatedAt      string  `json:"CreatedAt"`
}

// GalleryDetail matches the full db.Gallery JSON output.
type GalleryDetail struct {
	GallerySummary
	ScrapedDomain       string  `json:"ScrapedDomain"`
	Description         string  `json:"Description"`
	Category            string  `json:"Category"`
	Tags                string  `json:"Tags"`
	CoverURL            string  `json:"CoverURL"`
	PageCount           int     `json:"PageCount"`
	DownloadMethod      string  `json:"DownloadMethod"`
	ExpectedImageCount  int     `json:"ExpectedImageCount"`
	ExpectedVideoCount  int     `json:"ExpectedVideoCount"`
	ContentVerified     bool    `json:"ContentVerified"`
	SavePath            string  `json:"SavePath"`
	GameCharacters      *string `json:"GameCharacters"`
	PublishTime         *string `json:"PublishTime"`
	ScrapedAt           *string `json:"ScrapedAt"`
	CompletedAt         *string `json:"CompletedAt"`
	UpdatedAt           string  `json:"UpdatedAt"`
}

// GalleryActionRequest is the body for POST /api/shelf/{id}.
type GalleryActionRequest struct {
	Action    string `json:"action"`
	ManualURL string `json:"manualUrl,omitempty"`
}

// GalleryActionResponse is the response for POST /api/shelf/{id}.
type GalleryActionResponse struct {
	ID     int    `json:"id"`
	Action string `json:"action"`
	DagID  string `json:"dagId,omitempty"`
	Status string `json:"status"`
}

// GalleryFileProgressResponse matches GET /api/shelf/{id}/files/progress.
type GalleryFileProgressResponse struct {
	GalleryID int           `json:"galleryId"`
	Summary   map[string]any `json:"summary"`
	Failed    []any          `json:"failed"`
}

// ── Slot Holders / Slot Update ──

// SlotHoldersResponse matches GET /api/slots/holders.
type SlotHoldersResponse struct {
	Holders map[string][]string `json:"holders"`
}

// SlotUpdateRequest is the body for PUT /api/slots/{type}.
type SlotUpdateRequest struct {
	Max int `json:"max"`
}

// SlotUpdateResponse matches the PUT /api/slots/{type} response.
type SlotUpdateResponse struct {
	SlotType  string `json:"slotType"`
	Current   int    `json:"current"`
	Max       int    `json:"max"`
	Available int    `json:"available"`
}

// SlotDetailResponse matches GET /api/slots/{type}.
type SlotDetailResponse struct {
	SlotType       string   `json:"slotType"`
	Current        int      `json:"current"`
	Max            int      `json:"max"`
	Available      int      `json:"available"`
	Utilization    float64  `json:"utilization"`
	ActiveHolders  []string `json:"activeHolders"`
	HolderCount    int      `json:"holderCount"`
	SchedulerQueue int      `json:"schedulerQueue"`
}

// LogQueryFilter narrows a log history or SSE stream query.
type LogQueryFilter struct {
	Module  string
	DagID   string
	NodeID  string
	TraceID string
	Level   string
	Limit   int
}
