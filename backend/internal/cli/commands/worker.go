package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type workerCommand struct{}

func (workerCommand) Name() string { return "worker" }
func (workerCommand) Description() string {
	return "Worker process management (status / restart / logs)"
}
func (workerCommand) Usage() string     { return "puchipix-cli worker <status|restart|logs> [options]" }
func (workerCommand) Aliases() []string { return []string{"w"} }

func (workerCommand) Execute(ctx CommandContext) error {
	subcommand := ""
	if len(ctx.Args) > 0 {
		subcommand = ctx.Args[0]
	}

	switch subcommand {
	case "status":
		return workerStatus(ctx)
	case "restart":
		return workerRestart(ctx)
	case "logs":
		return workerLogs(ctx)
	default:
		fmt.Printf("%sUnknown subcommand: %s%s\n", ui.Red, subcommand, ui.Reset)
		fmt.Printf("%sUsage: puchipix-cli worker <status|restart|logs>%s\n", ui.Dim, ui.Reset)
		fmt.Printf("  %sstatus%s   Show worker process status\n", ui.Cyan, ui.Reset)
		fmt.Printf("  %srestart%s  Restart worker process\n", ui.Cyan, ui.Reset)
		fmt.Printf("  %slogs%s     Show recent worker logs\n", ui.Cyan, ui.Reset)
		return nil
	}
}

func workerStatus(ctx CommandContext) error {
	stats, err := ctx.Client.GetWorkerStatus()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(stats, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider("Worker Process Status")

	statusColor := ui.Gray
	switch stats.Status {
	case "ready":
		statusColor = ui.Green
	case "starting", "restarting":
		statusColor = ui.Yellow
	case "fatal":
		statusColor = ui.Red
	}

	fmt.Printf("  %sStatus%s        %s%s%s\n", ui.Bold, ui.Reset, statusColor, stats.Status, ui.Reset)

	pidStr := "\u2014"
	if stats.PID != nil {
		pidStr = strconv.Itoa(*stats.PID)
	}
	fmt.Printf("  %sPID%s           %s\n", ui.Bold, ui.Reset, pidStr)

	uptimeStr := "\u2014"
	if stats.Uptime != nil {
		uptimeStr = ui.FormatDuration(*stats.Uptime)
	}
	fmt.Printf("  %sUptime%s        %s\n", ui.Bold, ui.Reset, uptimeStr)
	fmt.Printf("  %sRestarts%s      %d\n", ui.Bold, ui.Reset, stats.RestartCount)

	exitStr := "null"
	if stats.LastExitCode != nil {
		exitStr = strconv.Itoa(*stats.LastExitCode)
	}
	fmt.Printf("  %sLast exit%s     %s\n", ui.Bold, ui.Reset, exitStr)

	ui.PrintDivider("")
	return nil
}

func workerRestart(ctx CommandContext) error {
	fmt.Printf("%sRestarting worker...%s\n", ui.Yellow, ui.Reset)
	result, err := ctx.Client.RestartWorker()
	if err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok {
			fmt.Fprintf(os.Stderr, "%sFailed to restart worker: %s%s\n", ui.Red, dagErr.Message, ui.Reset)
		} else {
			fmt.Fprintf(os.Stderr, "%sError: %s%s\n", ui.Red, err.Error(), ui.Reset)
		}
		return nil
	}
	fmt.Printf("  %sWorker stopped (PID %d)%s\n", ui.Gray, result.OldPID, ui.Reset)
	fmt.Printf("  %sWorker started (PID %d)%s\n", ui.Green, result.NewPID, ui.Reset)
	fmt.Printf("  %sReady in %s%s\n", ui.Bold, ui.FormatDuration(result.ReadyMs), ui.Reset)
	fmt.Printf("%sDone.%s\n", ui.Green, ui.Reset)
	return nil
}

func workerLogs(ctx CommandContext) error {
	lines := 50
	linesArg := getArg(ctx.Args, "--lines")
	if linesArg != "" {
		if n, err := strconv.Atoi(linesArg); err == nil && n > 0 {
			lines = n
		}
	}

	logs, err := ctx.Client.GetWorkerLogs(lines)
	if err != nil {
		return err
	}
	if len(logs) == 0 {
		fmt.Printf("%s(no worker logs available)%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Worker Logs (last %d lines)", len(logs)))
	for _, line := range logs {
		fmt.Println(line)
	}
	ui.PrintDivider("")
	return nil
}
