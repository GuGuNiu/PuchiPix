package commands

import (
	"fmt"

	"backend/internal/cli/ui"
)

type helpCommand struct{}

func (helpCommand) Name() string        { return "help" }
func (helpCommand) Description() string { return "Show help information" }
func (helpCommand) Usage() string        { return "puchipix-cli help [command]" }
func (helpCommand) Aliases() []string   { return nil }

// PrintHelp prints the full help text or command-specific help.
func PrintHelp(registry *Registry, args []string) {
	if len(args) > 0 && args[0] != "" {
		cmd := registry.Find(args[0])
		if cmd != nil {
			fmt.Printf("\n%s%s%s \u2014 %s\n", ui.Bold, cmd.Name(), ui.Reset, cmd.Description())
			fmt.Printf("\n%sUsage:%s %s\n", ui.Bold, ui.Reset, cmd.Usage())
			if len(cmd.Aliases()) > 0 {
				fmt.Printf("%sAliases:%s %s\n", ui.Bold, ui.Reset, joinStrings(cmd.Aliases(), ", "))
			}
			fmt.Println()
			return
		}
		fmt.Printf("%sUnknown command: %s%s\n", ui.Red, args[0], ui.Reset)
	}

	fmt.Println()
	fmt.Printf("%sPuchiPix DAG CLI%s \u2014 DAG task scheduling CLI tool\n\n", ui.Bold, ui.Reset)
	fmt.Printf("%sUsage:%s\n  puchipix-cli <command> [args] [options]\n\n", ui.Bold, ui.Reset)
	fmt.Printf("%sCommands:%s\n", ui.Bold, ui.Reset)

	maxName := 0
	for _, cmd := range registry.Commands() {
		if len(cmd.Name()) > maxName {
			maxName = len(cmd.Name())
		}
	}

	for _, cmd := range registry.Commands() {
		padded := cmd.Name()
		for len(padded) < maxName+2 {
			padded += " "
		}
		fmt.Printf("  %s%s%s %s\n", ui.Cyan, padded, ui.Reset, cmd.Description())
	}

	fmt.Printf("\n%sGlobal options:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %s--host <addr>%s   Server address (default localhost, or PUCHIPIX_HOST env)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s--port <port>%s   Server port (default 10540, or PUCHIPIX_PORT env)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s--json%s          Output raw JSON instead of formatted text\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s-h, --help%s      Show help\n\n", ui.Dim, ui.Reset)
	fmt.Printf("%sEnvironment variables:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %sPUCHIPIX_HOST%s  Server address (default localhost)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %sPUCHIPIX_PORT%s  Server port (default 10540)\n\n", ui.Dim, ui.Reset)
	fmt.Printf("%sExamples:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %s# View all DAG statuses%s\n  puchipix-cli status\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View specific DAG details%s\n  puchipix-cli dag gallery-123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View node full state history%s\n  puchipix-cli node gallery-123 scrape\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View event history%s\n  puchipix-cli events gallery-123 --limit 20 --from-seq 100\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Pause DAG%s\n  puchipix-cli pause gallery-123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Watch DAG event stream in real-time%s\n  puchipix-cli watch\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View system logs in real-time (filter by error level)%s\n  puchipix-cli logs --level=error\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View worker process status%s\n  puchipix-cli worker status\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Connect to remote server%s\n  puchipix-cli --host 192.168.1.100 --port 10540 status\n", ui.Dim, ui.Reset)
}
