package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"backend/internal/cli"
	"backend/internal/cli/commands"
	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

func main() {
	cli.EnableVT100()

	rawArgs := os.Args[1:]
	cfg, remaining := cli.ParseGlobalOptions(rawArgs)

	registry := commands.NewRegistry()

	if len(remaining) == 0 || cfg.ShowHelp {
		if len(remaining) == 0 {
			commands.PrintHelp(registry, nil)
		} else {
			commands.PrintHelp(registry, remaining[:1])
		}
		return
	}

	commandName := remaining[0]

	if commandName == "help" {
		commands.PrintHelp(registry, remaining[1:])
		return
	}

	cmd := registry.Find(commandName)
	if cmd == nil {
		fmt.Printf("%sUnknown command: %s%s\n", ui.Red, commandName, ui.Reset)
		fmt.Printf("%sUse 'puchipix-cli help' to see available commands%s\n", ui.Dim, ui.Reset)
		os.Exit(1)
	}

	client := dagclient.New(cfg.Host, cfg.Port)
	ctx := commands.CommandContext{
		Client: client,
		Args:   remaining[1:],
		JSON:   cfg.JSON,
		Ctx:    context.Background(),
	}

	if err := cmd.Execute(ctx); err != nil {
		var dagErr *dagclient.DagClientError
		if errors.As(err, &dagErr) {
			if dagErr.IsNetworkError() {
				fmt.Fprintf(os.Stderr, "%sConnection failed: %s%s\n", ui.Red, dagErr.Message, ui.Reset)
				fmt.Fprintf(os.Stderr, "%sPlease ensure the server is running: %s%s\n", ui.Dim, cfg.BaseURL, ui.Reset)
			} else if dagErr.IsNotFound() {
				fmt.Fprintf(os.Stderr, "%sNot found: %s%s\n", ui.Yellow, dagErr.Message, ui.Reset)
			} else {
				statusCodeStr := ""
				if dagErr.StatusCode > 0 {
					statusCodeStr = fmt.Sprintf(" (HTTP %d)", dagErr.StatusCode)
				}
				fmt.Fprintf(os.Stderr, "%sAPI error%s: %s%s\n", ui.Red, statusCodeStr, dagErr.Message, ui.Reset)
			}
		} else {
			fmt.Fprintf(os.Stderr, "%sError: %s%s\n", ui.Red, err.Error(), ui.Reset)
		}
		os.Exit(1)
	}
}
