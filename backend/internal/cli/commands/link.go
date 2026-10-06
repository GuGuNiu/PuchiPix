package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type dagLinkCommand struct{}

func (c dagLinkCommand) Name() string        { return "link" }
func (c dagLinkCommand) Description() string { return "Add dependency edge between two DAG nodes" }
func (c dagLinkCommand) Usage() string {
	return "puchipix-cli link <dagId> <parentNodeId> <childNodeId>"
}
func (c dagLinkCommand) Aliases() []string { return []string{"dep", "depend"} }

func (c dagLinkCommand) Execute(ctx CommandContext) error {
	if len(ctx.Args) < 3 {
		fmt.Printf("%sUsage: %s%s\n", ui.Red, c.Usage(), ui.Reset)
		return nil
	}

	dagID := ctx.Args[0]
	parentID := ctx.Args[1]
	childID := ctx.Args[2]

	fmt.Printf("%sAdding dependency: %s -> %s in DAG %s%s\n",
		ui.Yellow, parentID, childID, dagID, ui.Reset)

	result, err := ctx.Client.AddDependency(dagID, parentID, childID)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok {
			if dagErr.StatusCode == 404 {
				fmt.Printf("%sDAG or node not found%s\n", ui.Red, ui.Reset)
				return nil
			}
			if dagErr.StatusCode == 503 {
				fmt.Printf("%sWorker offline, cannot modify DAG%s\n", ui.Red, ui.Reset)
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

	fmt.Printf("%s Dependency added: %s -> %s%s\n",
		ui.Green+"\u2705", parentID, childID, ui.Reset)
	fmt.Printf("  DAG:    %s\n", result.DagID)
	fmt.Printf("  Status: %s\n", result.Status)

	return nil
}
