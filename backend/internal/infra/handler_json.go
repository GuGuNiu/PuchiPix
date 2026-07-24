package infra

import (
	"encoding/json"
	"fmt"
	"os"
)

// JSONHandler outputs newline-delimited JSON (NDJSON) to stdout.
// Matches the existing formatJSON() output for backward compatibility.
type JSONHandler struct {
	name     string
	minLevel LogLevel
}

// NewJSONHandler creates a JSONHandler that outputs NDJSON to stdout.
func NewJSONHandler(minLevel LogLevel) *JSONHandler {
	return &JSONHandler{
		name:     "JSONHandler",
		minLevel: minLevel,
	}
}

func (h *JSONHandler) Name() string             { return h.name }
func (h *JSONHandler) Enabled(level LogLevel) bool { return level >= h.minLevel }

func (h *JSONHandler) Handle(entry StructuredLogEntry) error {
	record := map[string]any{
		"timestamp": entry.Timestamp,
		"level":     entry.Level,
		"module":    entry.Module,
		"message":   entry.Message,
	}
	if entry.Context.TraceID != "" {
		record["traceId"] = entry.Context.TraceID
	}
	if entry.Context.DagID != "" {
		record["dagId"] = entry.Context.DagID
	}
	if entry.Context.NodeID != "" {
		record["nodeId"] = entry.Context.NodeID
	}
	if entry.Context.TaskType != "" {
		record["taskType"] = entry.Context.TaskType
	}
	if entry.Context.Phase != "" {
		record["phase"] = entry.Context.Phase
	}
	for k, v := range entry.Context.Extra {
		if v != nil {
			record[k] = v
		}
	}
	if entry.Data != nil {
		if err, ok := entry.Data.(error); ok {
			record["error"] = map[string]string{
				"name":    fmt.Sprintf("%T", err),
				"message": err.Error(),
			}
		} else {
			record["data"] = entry.Data
		}
	}

	b, _ := json.Marshal(record)
	fmt.Fprintln(os.Stdout, string(b))
	return nil
}

func (h *JSONHandler) Flush() error { return nil }
