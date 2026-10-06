package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

type schedulerCommand struct{}

func (schedulerCommand) Name() string        { return "scheduler" }
func (schedulerCommand) Description() string { return "View scheduler queue stats" }
func (schedulerCommand) Usage() string       { return "puchipix-cli scheduler" }
func (schedulerCommand) Aliases() []string   { return nil }

func (schedulerCommand) Execute(ctx CommandContext) error {
	s, err := ctx.Client.GetSchedulerStats()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(s, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Scheduler stats")
	fmt.Printf("  %sStrategy%s: %s\n", ui.Bold, ui.Reset, s.Strategy)
	fmt.Printf("  %sQueue length%s: %d\n", ui.Bold, ui.Reset, s.QueueSize)
	fmt.Println()

	if len(s.ByPriority) > 0 {
		ui.PrintDivider("By priority")
		for prio, count := range s.ByPriority {
			fmt.Printf("  %-12s %d\n", prio, count)
		}
		fmt.Println()
	}

	if len(s.ByTaskType) > 0 {
		ui.PrintDivider("By task type")
		for t, count := range s.ByTaskType {
			fmt.Printf("  %-12s %d\n", t, count)
		}
	}
	return nil
}
