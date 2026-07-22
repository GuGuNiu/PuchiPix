package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

type slotsCommand struct{}

func (slotsCommand) Name() string        { return "slots" }
func (slotsCommand) Description() string { return "View slot pool usage" }
func (slotsCommand) Usage() string       { return "puchipix-cli slots" }
func (slotsCommand) Aliases() []string   { return nil }

func (slotsCommand) Execute(ctx CommandContext) error {
	data, err := ctx.Client.GetSlotStatus()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Slot pool status")
	for key, slot := range data.Snapshot {
		fmt.Printf("  %-16s %s  available: %d\n",
			key, ui.RenderProgressBar(slot.Current, slot.Max, 20), slot.Available)
	}
	fmt.Println()

	ui.PrintDivider("Download concurrency config")
	fmt.Printf("  TS segment concurrency: %d\n", data.DownloadConcurrency.TsSegmentConcurrent)
	fmt.Printf("  Gallery image concurrency: %d\n", data.DownloadConcurrency.GalleryImageConcurrent)
	return nil
}
