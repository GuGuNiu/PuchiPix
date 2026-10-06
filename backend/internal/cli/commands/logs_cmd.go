package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type logsCommand struct{}

func (logsCommand) Name() string { return "logs" }
func (logsCommand) Description() string {
	return "View real-time system logs (filter by DAG/module/trace)"
}
func (logsCommand) Usage() string {
	return "puchipix-cli logs [--dag=<dagId>] [--node=<nodeId>] [--trace=<traceId>] [--module=<name>] [--level=<debug|info|warn|error>]"
}
func (logsCommand) Aliases() []string { return nil }

func (logsCommand) Execute(ctx CommandContext) error {
	filter := dagclient.LogQueryFilter{
		DagID:   getArg(ctx.Args, "--dag"),
		NodeID:  getArg(ctx.Args, "--node"),
		TraceID: getArg(ctx.Args, "--trace"),
		Module:  getArg(ctx.Args, "--module"),
		Level:   getArg(ctx.Args, "--level"),
	}

	logURL := ctx.Client.GetLogStreamURL(filter)
	fmt.Printf("%s\u201c Connecting to log stream...%s\n", ui.Cyan, ui.Reset)

	var filterParts []string
	if filter.DagID != "" {
		filterParts = append(filterParts, "dagId="+filter.DagID)
	}
	if filter.NodeID != "" {
		filterParts = append(filterParts, "nodeId="+filter.NodeID)
	}
	if filter.TraceID != "" {
		filterParts = append(filterParts, "traceId="+filter.TraceID)
	}
	if filter.Module != "" {
		filterParts = append(filterParts, "module="+filter.Module)
	}
	if filter.Level != "" {
		filterParts = append(filterParts, "level="+filter.Level)
	}
	if len(filterParts) > 0 {
		fmt.Printf("%sFilter: %s%s\n", ui.Dim, joinStrings(filterParts, ", "), ui.Reset)
	}
	fmt.Printf("%sPress Ctrl+C to exit%s\n\n", ui.Dim, ui.Reset)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sse := dagclient.NewSSEClient(logURL,
		func(event dagclient.SseEvent) {
			if event.Type == "history" {
				var entries []dagclient.LogEntry
				if err := json.Unmarshal(event.Data, &entries); err == nil {
					for _, entry := range entries {
						PrintStructuredLog(entry)
					}
				}
			} else if event.Type == "log" {
				var entry dagclient.LogEntry
				if err := json.Unmarshal(event.Data, &entry); err == nil {
					PrintStructuredLog(entry)
				}
			}
		},
		func(err error) {
			fmt.Fprintf(os.Stderr, "%sLog stream error: %s%s\n", ui.Red, err.Error(), ui.Reset)
		},
	)

	go func() {
		<-sigCh
		sse.Close()
		fmt.Printf("\n%sDisconnected from log stream%s\n", ui.Dim, ui.Reset)
		os.Exit(0)
	}()

	return sse.Connect()
}

func getArg(args []string, flag string) string {
	prefix := flag + "="
	for _, a := range args {
		if len(a) > len(prefix) && a[:len(prefix)] == prefix {
			return a[len(prefix):]
		}
	}
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}
