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
func (dagCommand) Usage() string        { return "puchipix-cli dag <dagId> [--logs]" }
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
	fmt.Printf("  %sType%s:      %s\n", ui.Bold, ui.Reset, dag.TaskType)
	fmt.Printf("  %sSource URL%s: %s\n", ui.Bold, ui.Reset, dag.SourceURL)
	fmt.Printf("  %sCreated%s:    %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(dag.CreatedAt))
	if dag.ProviderID != "" {
		fmt.Printf("  %sProvider%s:   %s\n", ui.Bold, ui.Reset, dag.ProviderID)
	}
	fmt.Println()

	ui.PrintDivider("Node Definition")
	for _, node := range dag.Definition.Nodes {
		fmt.Printf("  %s%s%s [%s] executor=%s prio=%d\n",
			ui.Cyan, node.ID, ui.Reset, node.Phase, node.Executor, node.Priority)
		if len(node.Dependencies) > 0 {
			fmt.Printf("    %sDepends: %s%s\n", ui.Dim, joinStrings(node.Dependencies, ", "), ui.Reset)
		}
		if len(node.ResourceRequirements) > 0 {
			var resParts []string
			for _, r := range node.ResourceRequirements {
				resParts = append(resParts, fmt.Sprintf("%s\u00d7%d", r.SlotType, r.Count))
			}
			fmt.Printf("    %sResources: %s%s\n", ui.Dim, joinStrings(resParts, ", "), ui.Reset)
		}
		if node.Timeout > 0 {
			fmt.Printf("    %sTimeout: %dms  Retry: %d%s\n", ui.Dim, node.Timeout, node.MaxRetries, ui.Reset)
		}
	}
	fmt.Println()

	ui.PrintDivider("Node Status")
	for _, node := range dag.Nodes {
		fmt.Printf("  %s%s%s %s\n", ui.Bold, node.NodeID, ui.Reset, ui.StateLabel(string(node.State)))
		if node.Error != nil {
			fmt.Printf("    %sError: [%s] %s%s\n", ui.Red, node.Error.Code, node.Error.Message, ui.Reset)
			if node.Error.Retryable {
				fmt.Printf("    %sRetryable%s\n", ui.Yellow, ui.Reset)
			}
		}
		if node.Result != nil {
			fmt.Printf("    %sResult: success=%v%s\n", ui.Dim, node.Result.Success, ui.Reset)
		}
		if len(node.History) > 0 {
			fmt.Printf("    %sHistory (%d entries):%s\n", ui.Dim, len(node.History), ui.Reset)
			start := 0
			if len(node.History) > 5 {
				start = len(node.History) - 5
			}
			for _, h := range node.History[start:] {
				fmt.Printf("      %s %s \u2192 %s %s(%s: %s)%s\n",
					ui.FormatTime(h.Timestamp),
					ui.StatePill(string(h.From)), ui.StatePill(string(h.To)),
					ui.Dim, h.TriggeredBy, h.Reason, ui.Reset)
			}
		}
		fmt.Println()
	}

	if withLogs {
		fmt.Printf("\n%s��?��?��? DAG Logs ��?��?��?%s\n\n", ui.Bold, ui.Reset)
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
