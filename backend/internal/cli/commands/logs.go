package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

// PrintStructuredLog prints a single structured log entry.
func PrintStructuredLog(entry dagclient.LogEntry) {
	ts := ui.FormatTime(entry.Timestamp)
	level := ui.LogLevelLabel(entry.Level)
	moduleLabel := fmt.Sprintf("%s[%s]%s", ui.Cyan, entry.Module, ui.Reset)

	var ctxParts []string
	if entry.DagID() != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%sdag=%s%s", ui.Blue, entry.DagID(), ui.Reset))
	}
	if entry.NodeID() != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%snode=%s%s", ui.Blue, entry.NodeID(), ui.Reset))
	}
	if entry.TraceID() != "" {
		trace := entry.TraceID()
		if len(trace) > 12 {
			trace = trace[:12]
		}
		ctxParts = append(ctxParts, fmt.Sprintf("%strace=%s%s", ui.Magenta, trace, ui.Reset))
	}
	ctxStr := ""
	if len(ctxParts) > 0 {
		ctxStr = " " + joinStrings(ctxParts, " ")
	}

	fmt.Printf("%s%s%s %s %s%s %s\n", ui.Dim, ts, ui.Reset, level, moduleLabel, ctxStr, entry.Message)

	if len(entry.Data) > 0 && string(entry.Data) != "null" {
		var pretty bytes
		if err := json.Unmarshal(entry.Data, &pretty); err == nil {
			b, _ := json.MarshalIndent(pretty, "  ", "  ")
			fmt.Printf("  %s%s%s\n", ui.Dim, string(b), ui.Reset)
		} else {
			fmt.Printf("  %s%s%s\n", ui.Dim, string(entry.Data), ui.Reset)
		}
	}
}

type bytes = map[string]any

func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}
