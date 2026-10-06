package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

type healthCommand struct{}

func (healthCommand) Name() string        { return "health" }
func (healthCommand) Description() string { return "Check server health and database connectivity" }
func (healthCommand) Usage() string       { return "puchipix-cli health" }
func (healthCommand) Aliases() []string   { return []string{"ping"} }

func (healthCommand) Execute(ctx CommandContext) error {
	data, err := ctx.Client.GetHealth()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Server Health")

	statusColor := ui.Green
	statusIcon := "\u2705"
	if data.Status != "ok" {
		statusColor = ui.Red
		statusIcon = "\u274c"
	}

	fmt.Printf("  %s%s %s%s%s\n", statusIcon, statusColor, data.Status, ui.Reset, "")

	dbStatus := data.Database
	if dbStatus == "" {
		dbStatus = "\u2014"
	}
	dbColor := ui.Green
	if dbStatus != "ok" {
		dbColor = ui.Red
	}
	fmt.Printf("  %sDatabase%s:    %s%s%s\n", ui.Bold, ui.Reset, dbColor, dbStatus, ui.Reset)
	fmt.Printf("  %sServer time%s: %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(data.Time))

	return nil
}
