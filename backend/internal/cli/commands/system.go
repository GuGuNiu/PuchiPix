package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

// systemCommand shows runtime system information (version, goroutines,
// memory, uptime, CPU cores).
type systemCommand struct{}

func (systemCommand) Name() string        { return "system" }
func (systemCommand) Description() string { return "Show server runtime info (version, goroutines, memory, uptime)" }
func (systemCommand) Usage() string        { return "puchipix-cli system" }
func (systemCommand) Aliases() []string    { return []string{"sys", "info"} }

func (systemCommand) Execute(ctx CommandContext) error {
	data, err := ctx.Client.GetSystem()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("System Information")
	fmt.Printf("  %sVersion%s:     %s\n", ui.Bold, ui.Reset, data.Version)
	fmt.Printf("  %sGo version%s:  %s\n", ui.Bold, ui.Reset, data.GoVersion)
	fmt.Printf("  %sUptime%s:      %s\n", ui.Bold, ui.Reset, data.Uptime)
	fmt.Printf("  %sCPU cores%s:   %d\n", ui.Bold, ui.Reset, data.CPUCores)
	fmt.Printf("  %sGoroutines%s:  %d\n", ui.Bold, ui.Reset, data.Goroutines)
	fmt.Printf("  %sMem alloc%s:   %s\n", ui.Bold, ui.Reset, formatBytes(data.MemAlloc))
	fmt.Printf("  %sMem sys%s:     %s\n", ui.Bold, ui.Reset, formatBytes(data.MemSys))

	return nil
}

// formatBytes converts a byte count to a human-readable string.
func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	suffix := []string{"KB", "MB", "GB", "TB", "PB"}
	if exp < len(suffix) {
		return fmt.Sprintf("%.1f %s", float64(b)/float64(div), suffix[exp])
	}
	return fmt.Sprintf("%.1f PB", float64(b)/float64(div))
}
