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

	if data.Stats.TotalDags == 0 && len(data.Dags) == 0 {
		ui.PrintDivider("DAG System Overview")
		fmt.Printf("  %sNo DAG records%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider("DAG System Overview")
	fmt.Printf("  %sTotal%s: %d  %sActive%s: %d  %sNodes%s: %d\n",
		ui.Bold, ui.Reset, data.Stats.TotalDags,
		ui.Bold, ui.Reset, data.Stats.ActiveDags,
		ui.Bold, ui.Reset, data.Stats.TotalNodes)
	fmt.Printf("  %sStrategy%s: %s  %sQueue%s: %d\n",
		ui.Bold, ui.Reset, data.Stats.Scheduler.Strategy,
		ui.Bold, ui.Reset, data.Stats.Scheduler.QueueSize)
	fmt.Println()

	ui.PrintDivider("Slot Pool")
	for key, slot := range data.Stats.Slots {
		fmt.Printf("  %-16s %s\n", key, ui.RenderProgressBar(slot.Current, slot.Max, 20))
	}
	fmt.Println()

	if len(data.Dags) == 0 {
		fmt.Printf("  %s(no DAG records)%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider("DAG List")
	for _, dag := range data.Dags {
		p := dag.Progress
		fmt.Printf("  %s%s%s  [%s]  %s\u2705%d%s %s\u26a1%d%s %s\u23f8%d%s %s\u274c%d%s %s\u23f3%d%s\n",
			ui.Bold, dag.DagID, ui.Reset, dag.TaskType,
			ui.Green, p.Completed, ui.Reset,
			ui.Cyan, p.Running, ui.Reset,
			ui.Yellow, p.Paused, ui.Reset,
			ui.Red, p.Failed, ui.Reset,
			ui.Gray, p.Queued, ui.Reset)
		fmt.Printf("    %sURL: %s  Created: %s%s\n",
			ui.Dim, ui.Truncate(dag.SourceURL, 60), ui.FormatDateTime(dag.CreatedAt), ui.Reset)

		for _, node := range dag.Nodes {
			reason := ""
			if node.LastTrans != nil {
				reason = node.LastTrans.Reason
			}
			fmt.Printf("    %s\u251c��?%s %-12s %s %s%s\n",
				ui.Dim, ui.Reset,
				node.NodeID,
				ui.StatePill(string(node.State)),
				ui.Dim, ui.Reset)
			if reason != "" {
				fmt.Printf("      %s%s%s\n", ui.Dim, reason, ui.Reset)
			}
		}
		fmt.Println()
	}

	if withLogs {
		fmt.Printf("\n%s��?��?��? Associated Logs ��?��?��?%s\n\n", ui.Bold, ui.Reset)
		for _, dag := range data.Dags {
			p := dag.Progress
			if p.Completed == dag.NodeCount || p.Failed == dag.NodeCount {
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
