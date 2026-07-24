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

// commandGroup defines a titled group of commands for help output.
type commandGroup struct {
	title string
	cmds  []string
}

// commandGroups controls the grouping and display order of commands
// in the help output.
var commandGroups = []commandGroup{
	{"System & Monitoring", []string{"health", "system", "stats", "sites"}},
	{"DAG Monitoring", []string{"status", "dag", "node", "events", "watch", "logs", "scheduler", "slots", "worker", "trace"}},
	{"DAG Lifecycle", []string{"create", "link", "trigger", "pause", "resume", "retry", "cancel", "delete"}},
	{"Task & Gallery Management", []string{"tasks", "galleries"}},
}

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
	fmt.Printf("%sPuchiPix CLI%s \u2014 DAG task scheduling & management CLI tool\n\n", ui.Bold, ui.Reset)
	fmt.Printf("%sUsage:%s\n  puchipix-cli <command> [args] [options]\n\n", ui.Bold, ui.Reset)

	// Build a map of command name -> Command for quick lookup.
	cmdMap := make(map[string]Command, len(registry.Commands()))
	for _, cmd := range registry.Commands() {
		cmdMap[cmd.Name()] = cmd
	}

	// Calculate max name width across all commands for alignment.
	maxName := 0
	for _, cmd := range registry.Commands() {
		if len(cmd.Name()) > maxName {
			maxName = len(cmd.Name())
		}
	}

	for _, group := range commandGroups {
		fmt.Printf("%s%s:%s\n", ui.Bold, group.title, ui.Reset)
		for _, name := range group.cmds {
			cmd, ok := cmdMap[name]
			if !ok {
				continue
			}
			padded := cmd.Name()
			for len(padded) < maxName+2 {
				padded += " "
			}
			aliases := ""
			if len(cmd.Aliases()) > 0 {
				aliases = fmt.Sprintf(" %s(%s)%s", ui.Dim, joinStrings(cmd.Aliases(), ", "), ui.Reset)
			}
			fmt.Printf("  %s%s%s %s%s\n", ui.Cyan, padded, ui.Reset, cmd.Description(), aliases)
		}
		fmt.Println()
	}

	fmt.Printf("%sGlobal options:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %s--host <addr>%s   Server address (default localhost, or PUCHIPIX_HOST env)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s--port <port>%s   Server port (default 10540, or PUCHIPIX_PORT env)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s--json%s          Output raw JSON instead of formatted text\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s-h, --help%s      Show help\n\n", ui.Dim, ui.Reset)
	fmt.Printf("%sEnvironment variables:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %sPUCHIPIX_HOST%s  Server address (default localhost)\n", ui.Dim, ui.Reset)
	fmt.Printf("  %sPUCHIPIX_PORT%s  Server port (default 10540)\n\n", ui.Dim, ui.Reset)
	fmt.Printf("%sExamples:%s\n", ui.Bold, ui.Reset)
	fmt.Printf("  %s# Check server health%s\n  puchipix-cli health\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View dashboard statistics%s\n  puchipix-cli stats\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View all DAG statuses%s\n  puchipix-cli status\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View specific DAG details%s\n  puchipix-cli dag gallery-123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View node full state history%s\n  puchipix-cli node gallery-123 scrape\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View event history%s\n  puchipix-cli events gallery-123 --limit 20 --from-seq 100\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Create a new download task from a URL%s\n  puchipix-cli create https://example.com/gallery/123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# List video download tasks%s\n  puchipix-cli tasks list --limit=20\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Retry a failed video task%s\n  puchipix-cli tasks action 42 retry\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# List galleries filtered by status%s\n  puchipix-cli galleries list --status=failed\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View gallery file-level progress%s\n  puchipix-cli galleries progress 123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Retry a failed gallery%s\n  puchipix-cli galleries retry 123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View slot holders for leak diagnosis%s\n  puchipix-cli slots holders\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Dynamically adjust slot concurrency%s\n  puchipix-cli slots update download 5\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Pause DAG%s\n  puchipix-cli pause gallery-123\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Watch DAG event stream in real-time%s\n  puchipix-cli watch\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View system logs in real-time (filter by error level)%s\n  puchipix-cli logs --level=error\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# View worker process status%s\n  puchipix-cli worker status\n\n", ui.Dim, ui.Reset)
	fmt.Printf("  %s# Connect to remote server%s\n  puchipix-cli --host 192.168.1.100 --port 10540 status\n", ui.Dim, ui.Reset)
}
