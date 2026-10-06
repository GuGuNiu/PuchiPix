package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type statusCommand struct{}

func (statusCommand) Name() string        { return "status" }
func (statusCommand) Description() string { return "List all DAGs and node status overview" }
func (statusCommand) Usage() string       { return "puchipix-cli status [--logs]" }
func (statusCommand) Aliases() []string   { return nil }

func (statusCommand) Execute(ctx CommandContext) error {
	withLogs := containsArg(ctx.Args, "--logs")

	data, err := ctx.Client.GetAllDags()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if len(data.Dags) == 0 {
		ui.PrintDivider("DAG System Overview")
		fmt.Printf("  %sNo DAG records%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider("DAG System Overview")
	totalDags := len(data.Dags)
	activeDags := 0
	totalNodes := 0
	for _, dag := range data.Dags {
		if dag.State != "completed" && dag.State != "failed" && dag.State != "cancelled" {
			activeDags++
		}
		totalNodes += dag.NodeCount
	}
	fmt.Printf("  %sTotal%s: %d  %sActive%s: %d  %sNodes%s: %d\n",
		ui.Bold, ui.Reset, totalDags,
		ui.Bold, ui.Reset, activeDags,
		ui.Bold, ui.Reset, totalNodes)
	if data.Stats != nil {
		fmt.Printf("  %sStrategy%s: %s  %sQueue%s: %d\n",
			ui.Bold, ui.Reset, data.Stats.Scheduler.Strategy,
			ui.Bold, ui.Reset, data.Stats.Scheduler.QueueSize)
		fmt.Println()
		ui.PrintDivider("Slot Pool")
		for key, slot := range data.Stats.Slots {
			fmt.Printf("  %-16s %s\n", key, ui.RenderProgressBar(slot.Current, slot.Max, 20))
		}
	}
	fmt.Println()

	ui.PrintDivider("DAG List")
	for _, dag := range data.Dags {
		fmt.Printf("  %s%s%s  %s%s%s\n",
			ui.Bold, dag.DagID, ui.Reset,
			ui.StatePill(dag.State), ui.Reset, dag.SourceURL)
		fmt.Printf("    %sNodes: %d  Created: %s%s\n",
			ui.Dim, dag.NodeCount, ui.FormatDateTime(dag.CreatedAt), ui.Reset)
		fmt.Println()
	}

	if withLogs {
		fmt.Printf("\n%s═══ Associated Logs ═══%s\n\n", ui.Bold, ui.Reset)
		for _, dag := range data.Dags {
			if dag.State == "completed" || dag.State == "failed" || dag.State == "cancelled" {
				continue
			}
			logs, err := ctx.Client.QueryLogs(dagclient.LogQueryFilter{DagID: dag.DagID, Limit: 5})
			if err != nil {
				continue
			}
			if len(logs) > 0 {
				fmt.Printf("%s%s%s %slast %d logs:%s\n", ui.Cyan, dag.DagID, ui.Reset, ui.Dim, len(logs), ui.Reset)
				for _, entry := range logs {
					PrintStructuredLog(entry)
				}
				fmt.Println()
			}
		}
	}
	return nil
}

func containsArg(args []string, target string) bool {
	for _, a := range args {
		if a == target {
			return true
		}
	}
	return false
}
