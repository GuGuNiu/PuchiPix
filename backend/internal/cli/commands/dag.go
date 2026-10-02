package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type dagCommand struct{}

func (dagCommand) Name() string        { return "dag" }
func (dagCommand) Description() string { return "View DAG details (with node status history)" }
func (dagCommand) Usage() string       { return "puchipix-cli dag <dagId> [--logs]" }
func (dagCommand) Aliases() []string   { return nil }

func (dagCommand) Execute(ctx CommandContext) error {
	dagID := firstNonFlag(ctx.Args)
	if dagID == "" {
		fmt.Printf("%sUsage: puchipix-cli dag <dagId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	withLogs := containsArg(ctx.Args, "--logs")

	dag, err := ctx.Client.GetDag(dagID)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(dag, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if dag.WorkerDown {
		fmt.Printf("%s\u26a0 Worker offline, data may be stale%s\n\n", ui.Yellow, ui.Reset)
	}

	ui.PrintDivider(fmt.Sprintf("DAG Detail: %s", dag.DagID))
	if dag.State != "" {
		fmt.Printf("  %sState%s:     %s\n", ui.Bold, ui.Reset, ui.StatePill(dag.State))
	}
	if dag.TaskType != "" {
		fmt.Printf("  %sType%s:      %s\n", ui.Bold, ui.Reset, dag.TaskType)
	}
	if dag.SourceURL != "" {
		fmt.Printf("  %sSource URL%s: %s\n", ui.Bold, ui.Reset, dag.SourceURL)
	}
	if dag.CreatedAt != "" {
		fmt.Printf("  %sCreated%s:    %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(dag.CreatedAt))
	}
	fmt.Println()

	ui.PrintDivider("Node Status")
	for _, node := range dag.Nodes {
		phaseStr := ""
		if node.Phase != "" {
			phaseStr = fmt.Sprintf(" [%s]", node.Phase)
		}
		fmt.Printf("  %s%s%s%s %s\n", ui.Bold, node.NodeID, phaseStr, ui.Reset, ui.StatePill(string(node.State)))
		if node.Error != nil {
			fmt.Printf("    %sError: [%s] %s%s\n", ui.Red, node.Error.Code, node.Error.Message, ui.Reset)
			if node.Error.Retryable {
				fmt.Printf("    %sRetryable%s\n", ui.Yellow, ui.Reset)
			}
		}
		fmt.Println()
	}

	if withLogs {
		fmt.Printf("\n%s═══ DAG Logs ═══%s\n\n", ui.Bold, ui.Reset)
		logs, err := ctx.Client.QueryLogs(dagclient.LogQueryFilter{DagID: dagID, Limit: 200})
		if err != nil {
			fmt.Printf("%sFailed to query logs: %s%s\n", ui.Red, err.Error(), ui.Reset)
		} else if len(logs) == 0 {
			fmt.Printf("%sNo associated logs%s\n", ui.Dim, ui.Reset)
		} else {
			for _, entry := range logs {
				PrintStructuredLog(entry)
			}
		}
	}
	return nil
}

func firstNonFlag(args []string) string {
	for _, a := range args {
		if len(a) > 0 && a[0] != '-' {
			return a
		}
	}
	return ""
}
