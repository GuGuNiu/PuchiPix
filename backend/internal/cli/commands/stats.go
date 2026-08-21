package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

type statsCommand struct{}

func (statsCommand) Name() string        { return "stats" }
func (statsCommand) Description() string { return "Show aggregate dashboard statistics" }
func (statsCommand) Usage() string        { return "puchipix-cli stats" }
func (statsCommand) Aliases() []string    { return []string{"summary"} }

func (statsCommand) Execute(ctx CommandContext) error {
	data, err := ctx.Client.GetStats()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Dashboard Statistics")
	fmt.Printf("  %sGalleries%s:       %d\n", ui.Bold, ui.Reset, data.Galleries)
	fmt.Printf("  %sTasks%s:           %d\n", ui.Bold, ui.Reset, data.Tasks)
	fmt.Printf("  %sDownload history%s: %d\n", ui.Bold, ui.Reset, data.DownloadHistory)
	fmt.Printf("  %sCurrent speed%s:   %s\n", ui.Bold, ui.Reset, data.CurrentSpeedStr)
	fmt.Printf("  %sDisk I/O%s:        %s\n", ui.Bold, ui.Reset, data.DiskIOStr)

	if data.DagTotal > 0 || data.DagActive > 0 {
		fmt.Println()
		fmt.Printf("  %sDAG total%s:       %d\n", ui.Bold, ui.Reset, data.DagTotal)
		fmt.Printf("  %sDAG active%s:      %d\n", ui.Bold, ui.Reset, data.DagActive)
	}

	if data.SchedulerQueueSize > 0 {
		fmt.Printf("  %sScheduler queue%s: %d\n", ui.Bold, ui.Reset, data.SchedulerQueueSize)
	}

	if len(data.SlotUsage) > 0 {
		fmt.Println()
		ui.PrintDivider("Slot Usage")
		for slotType, raw := range data.SlotUsage {
			m, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			current := toInt(m["current"])
			max := toInt(m["max"])
			avail := toInt(m["available"])
			util := 0.0
			if v, ok := m["utilization"].(float64); ok {
				util = v
			}
			fmt.Printf("  %-16s %s  avail: %d  util: %.0f%%\n",
				slotType, ui.RenderProgressBar(current, max, 16), avail, util)
		}
	}

	return nil
}

func toInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}
