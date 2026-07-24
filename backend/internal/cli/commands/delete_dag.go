package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

// dagDeleteCommand removes a completed, cancelled, or failed DAG from
// the orchestrator's memory.
type dagDeleteCommand struct{}

func (c dagDeleteCommand) Name() string        { return "delete" }
func (c dagDeleteCommand) Description() string { return "Remove a completed/cancelled/failed DAG from memory" }
func (c dagDeleteCommand) Usage() string {
	return "puchipix-cli delete <dagId> [--force]"
}
func (c dagDeleteCommand) Aliases() []string { return []string{"rm", "remove"} }

func (c dagDeleteCommand) Execute(ctx CommandContext) error {
	dagID := firstNonFlag(ctx.Args)
	if dagID == "" {
		fmt.Printf("%sUsage: %s%s\n", ui.Red, c.Usage(), ui.Reset)
		fmt.Println()
		fmt.Println("  Note: Only DAGs in terminal states (completed, cancelled, failed)")
		fmt.Println("  can be deleted. Use --force to cancel first, then delete.")
		return nil
	}

	force := false
	for _, arg := range ctx.Args {
		if arg == "--force" || arg == "-f" {
			force = true
			break
		}
	}

	if force {
		fmt.Printf("%sForce-deleting DAG %s (cancelling first if active)...%s\n",
			ui.Yellow, dagID, ui.Reset)
		// Try to cancel first (ignore errors if already terminal)
		_, _ = ctx.Client.CancelDag(dagID)
	}

	fmt.Printf("%sDeleting DAG %s%s\n", ui.Yellow, dagID, ui.Reset)

	result, err := ctx.Client.DeleteDag(dagID)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok {
			if dagErr.StatusCode == 404 {
				fmt.Printf("%sDAG not found%s\n", ui.Red, ui.Reset)
				return nil
			}
			if dagErr.StatusCode == 409 {
				fmt.Printf("%sDAG is still active. Cancel it first or use --force.%s\n",
					ui.Red, ui.Reset)
				return nil
			}
			if dagErr.StatusCode == 503 {
				fmt.Printf("%sWorker offline, cannot delete DAG%s\n", ui.Red, ui.Reset)
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

	fmt.Printf("%s DAG %s deleted%s\n", ui.Green+"\u2705", dagID, ui.Reset)
	fmt.Printf("  Status: %s\n", result.Status)

	return nil
}
