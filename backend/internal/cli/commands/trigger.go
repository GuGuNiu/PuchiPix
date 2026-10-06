package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type dagTriggerCommand struct{}

func (c dagTriggerCommand) Name() string        { return "trigger" }
func (c dagTriggerCommand) Description() string { return "Re-activate pending/ready nodes in a DAG" }
func (c dagTriggerCommand) Usage() string {
	return "puchipix-cli trigger <dagId>"
}
func (c dagTriggerCommand) Aliases() []string { return []string{"run", "start", "activate"} }

func (c dagTriggerCommand) Execute(ctx CommandContext) error {
	dagID := firstNonFlag(ctx.Args)
	if dagID == "" {
		fmt.Printf("%sUsage: %s%s\n", ui.Red, c.Usage(), ui.Reset)
		return nil
	}

	fmt.Printf("%sTriggering DAG %s%s\n", ui.Yellow, dagID, ui.Reset)

	result, err := ctx.Client.TriggerDag(dagID)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok {
			if dagErr.StatusCode == 404 {
				fmt.Printf("%sDAG not found%s\n", ui.Red, ui.Reset)
				return nil
			}
			if dagErr.StatusCode == 503 {
				fmt.Printf("%sWorker offline, cannot trigger DAG%s\n", ui.Red, ui.Reset)
				return nil
			}
		}
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	fmt.Printf("%s DAG %s triggered%s\n", ui.Green+"\u2705", dagID, ui.Reset)

	if result != nil && result.Snapshot != nil {
		ui.PrintDivider("Current node status")
		for _, node := range result.Snapshot.Nodes {
			fmt.Printf("  %-12s %s\n", node.NodeID, ui.StatePill(string(node.State)))
		}
	}

	return nil
}
