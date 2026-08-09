package commands

import (
	"encoding/json"
	"fmt"
	"strconv"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type slotsCommand struct{}

func (slotsCommand) Name() string        { return "slots" }
func (slotsCommand) Description() string { return "View slot pool usage, holders, and adjust concurrency" }
func (slotsCommand) Usage() string {
	return "puchipix-cli slots [holders|update <type> <max>|reset <type>|detail <type>]"
}
func (slotsCommand) Aliases() []string { return []string{"slot"} }

func (slotsCommand) Execute(ctx CommandContext) error {
	// Check for subcommands
	if len(ctx.Args) > 0 {
		switch ctx.Args[0] {
		case "holders":
			return slotsHolders(ctx)
		case "update":
			return slotsUpdate(ctx)
		case "reset":
			return slotsReset(ctx)
		case "detail":
			return slotsDetail(ctx)
		}
	}

	// Default: show slot pool overview
	data, err := ctx.Client.GetSlotStatus()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Slot Pool Status")
	for key, slot := range data.Snapshot {
		fmt.Printf("  %-16s %s  available: %d\n",
			key, ui.RenderProgressBar(slot.Current, slot.Max, 20), slot.Available)
	}
	fmt.Println()

	ui.PrintDivider("Download Concurrency Config")
	fmt.Printf("  TS segment concurrency:   %d\n", data.DownloadConcurrency.TsSegmentConcurrent)
	fmt.Printf("  Gallery image concurrency: %d\n", data.DownloadConcurrency.GalleryImageConcurrent)

	fmt.Printf("\n  %sSubcommands:%s holders, update <type> <max>, reset <type>, detail <type>\n",
		ui.Dim, ui.Reset)

	return nil
}

// slotsReset force-clears all usage for a slot type (emergency recovery
// from ghost slots / P-SLOT-01 leaks).
func slotsReset(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "reset" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli slots reset <slotType>%s\n",
			ui.Red, ui.Reset)
		fmt.Printf("  %sExample:%s puchipix-cli slots reset download\n",
			ui.Dim, ui.Reset)
		return nil
	}

	slotType := args[0]

	fmt.Printf("%sResetting slot '%s' (clears ghost holders)...%s\n",
		ui.Yellow, slotType, ui.Reset)

	result, err := ctx.Client.ResetSlot(slotType)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok && dagErr.StatusCode == 404 {
			fmt.Printf("%sSlot type '%s' not found%s\n",
				ui.Red, slotType, ui.Reset)
			return nil
		}
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	fmt.Printf("%s Slot '%s' reset%s\n",
		ui.Green+"\u2705", result.SlotType, ui.Reset)
	fmt.Printf("  %sCurrent%s:   %d\n", ui.Bold, ui.Reset, result.Current)
	fmt.Printf("  %sAvailable%s: %d\n", ui.Bold, ui.Reset, result.Available)

	return nil
}

// slotsHolders shows active slot holder IDs for leak diagnosis.
func slotsHolders(ctx CommandContext) error {
	data, err := ctx.Client.GetSlotHolders()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Active Slot Holders")

	totalHolders := 0
	for slotType, holders := range data.Holders {
		totalHolders += len(holders)
		if len(holders) == 0 {
			fmt.Printf("  %-16s %s(empty)%s\n", slotType, ui.Dim, ui.Reset)
			continue
		}
		fmt.Printf("  %-16s %s%d holder(s):%s\n", slotType, ui.Bold, len(holders), ui.Reset)
		for _, h := range holders {
			fmt.Printf("    %s\u2022%s %s\n", ui.Cyan, ui.Reset, h)
		}
	}

	if totalHolders == 0 {
		fmt.Printf("\n  %sNo active slot holders — all slots are free.%s\n",
			ui.Green, ui.Reset)
	}

	return nil
}

// slotsUpdate dynamically adjusts the max concurrency for a slot type.
func slotsUpdate(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "update" {
		args = args[1:]
	}
	if len(args) < 2 {
		fmt.Printf("%sUsage: puchipix-cli slots update <slotType> <max>%s\n",
			ui.Red, ui.Reset)
		fmt.Printf("  %sExample:%s puchipix-cli slots update download 5\n",
			ui.Dim, ui.Reset)
		return nil
	}

	slotType := args[0]
	maxVal, err := strconv.Atoi(args[1])
	if err != nil || maxVal <= 0 {
		fmt.Printf("%sInvalid max value: %s (must be a positive integer)%s\n",
			ui.Red, args[1], ui.Reset)
		return nil
	}

	fmt.Printf("%sUpdating slot '%s' max to %d...%s\n",
		ui.Yellow, slotType, maxVal, ui.Reset)

	result, err := ctx.Client.UpdateSlotMax(slotType, maxVal)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok {
			if dagErr.StatusCode == 404 {
				fmt.Printf("%sSlot type '%s' not found%s\n",
					ui.Red, slotType, ui.Reset)
				return nil
			}
			if dagErr.StatusCode == 400 {
				fmt.Printf("%sInvalid value: %s%s\n",
					ui.Red, dagErr.Message, ui.Reset)
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

	fmt.Printf("%s Slot '%s' updated%s\n",
		ui.Green+"\u2705", result.SlotType, ui.Reset)
	fmt.Printf("  %sCurrent%s:   %d\n", ui.Bold, ui.Reset, result.Current)
	fmt.Printf("  %sMax%s:       %d\n", ui.Bold, ui.Reset, result.Max)
	fmt.Printf("  %sAvailable%s: %d\n", ui.Bold, ui.Reset, result.Available)

	return nil
}

// slotsDetail shows detailed info for a single slot type.
func slotsDetail(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "detail" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli slots detail <slotType>%s\n",
			ui.Red, ui.Reset)
		return nil
	}

	slotType := args[0]

	data, err := ctx.Client.GetSlotDetail(slotType)
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok && dagErr.StatusCode == 404 {
			fmt.Printf("%sSlot type '%s' not found%s\n",
				ui.Red, slotType, ui.Reset)
			return nil
		}
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Slot Detail: %s", data.SlotType))
	fmt.Printf("  %sCurrent%s:        %d / %d\n", ui.Bold, ui.Reset, data.Current, data.Max)
	fmt.Printf("  %sAvailable%s:      %d\n", ui.Bold, ui.Reset, data.Available)
	fmt.Printf("  %sUtilization%s:    %.1f%%\n", ui.Bold, ui.Reset, data.Utilization)
	fmt.Printf("  %sBar%s:            %s\n", ui.Bold, ui.Reset,
		ui.RenderProgressBar(data.Current, data.Max, 20))
	fmt.Printf("  %sHolder count%s:   %d\n", ui.Bold, ui.Reset, data.HolderCount)
	fmt.Printf("  %sScheduler queue%s: %d\n", ui.Bold, ui.Reset, data.SchedulerQueue)

	if len(data.ActiveHolders) > 0 {
		fmt.Println()
		fmt.Printf("  %sActive holders:%s\n", ui.Bold, ui.Reset)
		for _, h := range data.ActiveHolders {
			fmt.Printf("    %s\u2022%s %s\n", ui.Cyan, ui.Reset, h)
		}
	}

	return nil
}
