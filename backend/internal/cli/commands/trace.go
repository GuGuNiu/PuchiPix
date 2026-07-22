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

type traceCommand struct{}

func (traceCommand) Name() string        { return "trace" }
func (traceCommand) Description() string { return "View full trace logs for a traceId" }
func (traceCommand) Usage() string        { return "puchipix-cli trace <traceId> [--follow]" }
func (traceCommand) Aliases() []string   { return nil }

func (traceCommand) Execute(ctx CommandContext) error {
	traceID := firstNonFlag(ctx.Args)
	if traceID == "" {
		fmt.Fprintf(os.Stderr, "%sError: traceId required%s\n", ui.Red, ui.Reset)
		fmt.Fprintf(os.Stderr, "%sUsage: puchipix-cli trace <traceId>%s\n", ui.Dim, ui.Reset)
		return nil
	}

	follow := containsArg(ctx.Args, "--follow")
	fmt.Printf("%sTracing: %s%s\n\n", ui.Cyan, traceID, ui.Reset)

	if follow {
		logURL := ctx.Client.GetLogStreamURL(dagclient.LogQueryFilter{TraceID: traceID})
		sse := dagclient.NewSSEClient(logURL,
			func(event dagclient.SseEvent) {
				if event.Type == "history" {
					var entries []dagclient.LogEntry
					if err := json.Unmarshal(event.Data, &entries); err == nil {
						printTraceSummary(entries)
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
				fmt.Fprintf(os.Stderr, "%sConnection error: %s%s\n", ui.Red, err.Error(), ui.Reset)
				os.Exit(1)
			},
		)

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigCh
			sse.Close()
			os.Exit(0)
		}()

		return sse.Connect()
	}

	logs, err := ctx.Client.QueryLogs(dagclient.LogQueryFilter{TraceID: traceID, Limit: 1000})
	if err != nil {
		return err
	}
	if len(logs) == 0 {
		fmt.Printf("%sNo logs found for traceId=%s%s\n", ui.Dim, traceID, ui.Reset)
		return nil
	}
	printTraceSummary(logs)
	for _, entry := range logs {
		PrintStructuredLog(entry)
	}
	return nil
}

func printTraceSummary(entries []dagclient.LogEntry) {
	modules := map[string]bool{}
	dagIDs := map[string]bool{}
	nodeIDs := map[string]bool{}
	errCount := 0
	for _, e := range entries {
		if e.Module != "" {
			modules[e.Module] = true
		}
		if e.DagID() != "" {
			dagIDs[e.DagID()] = true
		}
		if e.NodeID() != "" {
			nodeIDs[e.NodeID()] = true
		}
		if e.Level == "ERROR" {
			errCount++
		}
	}
	var duration int64
	if len(entries) > 1 {
		duration = ui.DurationBetween(entries[0].Timestamp, entries[len(entries)-1].Timestamp)
	}

	fmt.Printf("%s��?��?��? Trace Summary ��?��?��?%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %sEntries:%s   %d\n", ui.Dim, ui.Reset, len(entries))
	fmt.Printf("  %sModules:%s   %s\n", ui.Dim, ui.Reset, joinMapKeys(modules))
	fmt.Printf("  %sDAG:%s       %s\n", ui.Dim, ui.Reset, joinMapKeys(dagIDs))
	fmt.Printf("  %sNodes:%s     %s\n", ui.Dim, ui.Reset, joinMapKeys(nodeIDs))
	fmt.Printf("  %sDuration:%s  %dms\n", ui.Dim, ui.Reset, duration)
	errStr := "none"
	if errCount > 0 {
		errStr = fmt.Sprintf("%s%d%s", ui.Red, errCount, ui.Reset)
	}
	fmt.Printf("  %sErrors:%s    %s\n", ui.Dim, ui.Reset, errStr)
	fmt.Printf("%s��?��?��? Trace Logs ��?��?��?%s\n\n", ui.Bold, ui.Reset)
}

func joinMapKeys(m map[string]bool) string {
	if len(m) == 0 {
		return "\u2014"
	}
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	return joinStrings(keys, ", ")
}

