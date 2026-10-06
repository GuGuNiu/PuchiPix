package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type controlCommand struct {
	action  dagclient.DagControlAction
	cmdName string
	cmdDesc string
	label   string
	icon    string
	color   string
	hasNode bool
}

func (c controlCommand) Name() string        { return c.cmdName }
func (c controlCommand) Description() string { return c.cmdDesc }
func (c controlCommand) Usage() string {
	if c.hasNode {
		return fmt.Sprintf("puchipix-cli %s <dagId> [nodeId]", c.cmdName)
	}
	return fmt.Sprintf("puchipix-cli %s <dagId>", c.cmdName)
}
func (c controlCommand) Aliases() []string { return nil }

func (c controlCommand) Execute(ctx CommandContext) error {
	dagID := firstNonFlag(ctx.Args)
	if dagID == "" {
		fmt.Printf("%sUsage: %s%s\n", ui.Red, c.Usage(), ui.Reset)
		return nil
	}
	nodeID := ""
	if c.hasNode && len(ctx.Args) > 1 {
		nodeID = ctx.Args[1]
	}

	fmt.Printf("%s%s DAG %s%s\n", c.color, c.label, dagID, ui.Reset)
	if nodeID != "" {
		fmt.Printf("  node: %s\n", nodeID)
	}

	var result *dagclient.DagControlResponse
	var err error
	switch c.action {
	case dagclient.ActionPause:
		result, err = ctx.Client.PauseDag(dagID)
	case dagclient.ActionResume:
		result, err = ctx.Client.ResumeDag(dagID, nodeID)
	case dagclient.ActionRetry:
		result, err = ctx.Client.RetryDag(dagID, nodeID)
	case dagclient.ActionCancel:
		result, err = ctx.Client.CancelDag(dagID)
	}
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok && dagErr.StatusCode == 503 {
			fmt.Printf("%sWorker offline, cannot execute control command%s\n", ui.Red, ui.Reset)
			return nil
		}
		return err
	}

	pastTense := map[dagclient.DagControlAction]string{
		dagclient.ActionPause:  "paused",
		dagclient.ActionResume: "resumed",
		dagclient.ActionRetry:  "retry triggered",
		dagclient.ActionCancel: "cancelled",
	}
	fmt.Printf("%s DAG %s %s%s\n", c.icon, dagID, pastTense[c.action], ui.Reset)

	if ctx.JSON && result != nil {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if result != nil && result.Snapshot != nil {
		ui.PrintDivider("Current node status")
		for _, node := range result.Snapshot.Nodes {
			fmt.Printf("  %-12s %s\n", node.NodeID, ui.StatePill(string(node.State)))
		}
	}
	return nil
}

var (
	pauseCommand = controlCommand{
		action:  dagclient.ActionPause,
		cmdName: "pause",
		cmdDesc: "Pause DAG",
		label:   "Pause",
		icon:    ui.Green + "\u2705",
		color:   ui.Yellow,
	}
	resumeCommand = controlCommand{
		action:  dagclient.ActionResume,
		cmdName: "resume",
		cmdDesc: "Resume DAG (node optional)",
		label:   "Resume",
		icon:    ui.Green + "\u2705",
		color:   ui.Yellow,
		hasNode: true,
	}
	retryCommand = controlCommand{
		action:  dagclient.ActionRetry,
		cmdName: "retry",
		cmdDesc: "Retry DAG (node optional)",
		label:   "Retry",
		icon:    ui.Green + "\u2705",
		color:   ui.Yellow,
		hasNode: true,
	}
	cancelCommand = controlCommand{
		action:  dagclient.ActionCancel,
		cmdName: "cancel",
		cmdDesc: "Cancel DAG",
		label:   "Cancel",
		icon:    ui.Red + "\U0001f6ab",
		color:   ui.Yellow,
	}
)
