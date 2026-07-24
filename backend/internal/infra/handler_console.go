package infra

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// ConsoleHandler outputs human-readable colored log lines to stdout/stderr.
// Format matches the existing formatDev() output for backward compatibility.
type ConsoleHandler struct {
	name     string
	minLevel LogLevel
}

// NewConsoleHandler creates a ConsoleHandler that outputs to console.
func NewConsoleHandler(minLevel LogLevel) *ConsoleHandler {
	return &ConsoleHandler{
		name:     "ConsoleHandler",
		minLevel: minLevel,
	}
}

func (h *ConsoleHandler) Name() string             { return h.name }
func (h *ConsoleHandler) Enabled(level LogLevel) bool { return level >= h.minLevel }

func (h *ConsoleHandler) Handle(entry StructuredLogEntry) error {
	output := h.format(entry)

	switch {
	case entry.LevelValue >= LevelError:
		fmt.Fprintln(os.Stderr, output)
	case entry.LevelValue >= LevelWarn:
		fmt.Fprintln(os.Stderr, output)
	default:
		fmt.Fprintln(os.Stdout, output)
	}
	return nil
}

func (h *ConsoleHandler) Flush() error { return nil }

func (h *ConsoleHandler) format(entry StructuredLogEntry) string {
	ts := formatTimestamp(time.Now())
	levelStr := fmt.Sprintf("%s%s%s", levelColors[entry.LevelValue], levelLabels[entry.LevelValue], ansiReset)
	moduleStr := fmt.Sprintf("%s[%s]%s", ansiCyan, entry.Module, ansiReset)

	var ctxParts []string
	if entry.Context.TraceID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%strace=%s%s", ansiMagenta, entry.Context.TraceID, ansiReset))
	}
	if entry.Context.DagID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%sdag=%s%s", ansiBlue, entry.Context.DagID, ansiReset))
	}
	if entry.Context.NodeID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%snode=%s%s", ansiBlue, entry.Context.NodeID, ansiReset))
	}
	if entry.Context.TaskType != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%stype=%s%s", ansiGray, entry.Context.TaskType, ansiReset))
	}
	if entry.Context.Phase != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%sphase=%s%s", ansiGray, entry.Context.Phase, ansiReset))
	}
	for k, v := range entry.Context.Extra {
		if v == nil {
			continue
		}
		val := fmt.Sprintf("%v", v)
		if b, err := json.Marshal(v); err == nil {
			val = string(b)
		}
		ctxParts = append(ctxParts, fmt.Sprintf("%s%s=%s%s", ansiGray, k, val, ansiReset))
	}

	ctxStr := ""
	if len(ctxParts) > 0 {
		ctxStr = " " + joinStrings(ctxParts, " ")
	}

	dataStr := ""
	if entry.Data != nil {
		if err, ok := entry.Data.(error); ok {
			dataStr = fmt.Sprintf("\n  %s%s%s", ansiRed, err.Error(), ansiReset)
		} else if b, err := json.MarshalIndent(entry.Data, "  ", "  "); err == nil {
			dataStr = fmt.Sprintf("\n  %s%s%s", ansiGray, string(b), ansiReset)
		} else {
			dataStr = fmt.Sprintf(" %s%v%s", ansiGray, entry.Data, ansiReset)
		}
	}

	return fmt.Sprintf("%s%s%s %s %s%s%s%s",
		ansiDim, ts, ansiReset,
		levelStr, moduleStr, entry.Message, ctxStr, dataStr)
}

func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		result += sep + parts[i]
	}
	return result
}
