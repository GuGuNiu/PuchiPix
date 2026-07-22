package dagclient

import "encoding/json"

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
	DagID      string       `json:"dagId"`
	TaskType   TaskType     `json:"taskType"`
	SourceURL  string       `json:"sourceUrl"`
	CreatedAt  string       `json:"createdAt"`
	NodeCount  int          `json:"nodeCount"`
	Progress   DagProgress  `json:"progress"`
	Nodes      []NodeSummary `json:"nodes"`
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

type DagListResponse struct {
	Dags []DagSummary `json:"dags"`
	Stats DagListStats `json:"stats"`
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

type DagDetailResponse struct {
	DagID      string       `json:"dagId"`
	TaskType   TaskType     `json:"taskType"`
	SourceURL  string       `json:"sourceUrl"`
	ProviderID string       `json:"providerId,omitempty"`
	CreatedAt  string       `json:"createdAt"`
	Definition DagDefinition `json:"definition"`
	Nodes      []NodeDetail `json:"nodes"`
	WorkerDown bool         `json:"workerDown,omitempty"`
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

// SseEvent represents a single Server-Sent Events message parsed from
// the event stream.
type SseEvent struct {
	Type string          `json:"-"`
	Data json.RawMessage `json:"-"`
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
