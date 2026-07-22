package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type nodeCommand struct{}

func (nodeCommand) Name() string        { return "node" }
func (nodeCommand) Description() string { return "View node details (with full state history)" }
func (nodeCommand) Usage() string        { return "puchipix-cli node <dagId> <nodeId>" }
func (nodeCommand) Aliases() []string   { return nil }

func (nodeCommand) Execute(ctx CommandContext) error {
	if len(ctx.Args) < 2 {
		fmt.Printf("%sUsage: puchipix-cli node <dagId> <nodeId>%s\n", ui.Red, ui.Reset)
		return nil
	}
	dagID := ctx.Args[0]
	nodeID := ctx.Args[1]

	dag, err := ctx.Client.GetDag(dagID)
	if err != nil {
		return err
	}

	var found *dagclient.NodeDetail
	for i := range dag.Nodes {
		if dag.Nodes[i].NodeID == nodeID {
			found = &dag.Nodes[i]
			break
		}
	}
	if found == nil {
		fmt.Printf("%sNode %s not found in DAG %s%s\n", ui.Red, nodeID, dagID, ui.Reset)
		return nil
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(found, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Node details: %s", nodeID))
	fmt.Printf("  %sDAG%s: %s\n", ui.Bold, ui.Reset, dagID)
	fmt.Printf("  %sState%s: %s\n", ui.Bold, ui.Reset, ui.StateLabel(string(found.State)))
	if found.Error != nil {
		fmt.Printf("  %sError%s: %s[%s] %s%s\n", ui.Bold, ui.Reset, ui.Red, found.Error.Code, found.Error.Message, ui.Reset)
		fmt.Printf("    %sRetryable: %v%s\n", ui.Dim, found.Error.Retryable, ui.Reset)
	}
	if found.Result != nil {
		b, _ := json.MarshalIndent(found.Result, "", "  ")
		fmt.Printf("  %sResult%s: %s\n", ui.Bold, ui.Reset, string(b))
	}
	fmt.Println()

	ui.PrintDivider("Full state history")
	for _, h := range found.History {
		fmt.Printf("  %s %s \u2192 %s\n", ui.FormatDateTime(h.Timestamp), ui.StatePill(string(h.From)), ui.StatePill(string(h.To)))
		fmt.Printf("    %sTriggered by: %s  Reason: %s%s\n", ui.Dim, h.TriggeredBy, h.Reason, ui.Reset)
		if h.Error != nil {
			fmt.Printf("    %sError: [%s] %s%s\n", ui.Red, h.Error.Code, h.Error.Message, ui.Reset)
		}
	}
	return nil
}
