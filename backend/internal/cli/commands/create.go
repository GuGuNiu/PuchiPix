package commands

import (
	"encoding/json"
	"fmt"
	"strconv"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

// dagCreateCommand creates a new task via POST /api/tasks, mirroring
// the frontend's add-task flow. The backend creates a download_tasks
// record and returns { ID, DisplayID, Status }.
type dagCreateCommand struct{}

func (c dagCreateCommand) Name() string        { return "create" }
func (c dagCreateCommand) Description() string { return "Create a new task from a URL (gallery / video / sniff auto-detected by backend)" }
func (c dagCreateCommand) Usage() string {
	return "puchipix-cli create <url> [--format=mp4] [--priority=1]"
}
func (c dagCreateCommand) Aliases() []string { return []string{"new", "add"} }

func (c dagCreateCommand) Execute(ctx CommandContext) error {
	if len(ctx.Args) == 0 {
		fmt.Printf("%sUsage: %s%s\n", ui.Red, c.Usage(), ui.Reset)
		fmt.Println()
		fmt.Println("  Arguments:")
		fmt.Println("    <url>                Source URL (required, HTTP/HTTPS)")
		fmt.Println()
		fmt.Println("  Options:")
		fmt.Println("    --format=<fmt>        Output format (default: mp4)")
		fmt.Println("    --priority=<n>        Task priority (default: 1)")
		return nil
	}

	sourceURL := ctx.Args[0]
	format := "mp4"
	priority := 1

	for i := 1; i < len(ctx.Args); i++ {
		arg := ctx.Args[i]
		if v, ok := extractFlagValue(arg, "--format="); ok {
			format = v
		} else if v, ok := extractFlagValue(arg, "--priority="); ok {
			priority, _ = strconv.Atoi(v)
		}
	}

	if sourceURL == "" || (!startsWith(sourceURL, "http://") && !startsWith(sourceURL, "https://")) {
		fmt.Printf("%sError: a valid HTTP(S) URL is required%s\n", ui.Red, ui.Reset)
		return nil
	}

	fmt.Printf("%sCreating task from: %s%s\n", ui.Yellow, sourceURL, ui.Reset)

	result, err := ctx.Client.CreateTask(dagclient.TaskCreateRequest{
		URL:      sourceURL,
		Format:   format,
		Priority: priority,
	})
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	id := result.GalleryIDOrID()
	seq := result.EffectiveSeq()
	fmt.Printf("%s Task created: #%d%s\n", ui.Green+"\u2705", id, ui.Reset)
	fmt.Printf("  Seq:    %s\n", seq)
	fmt.Printf("  Status: %s\n", result.Status)
	if result.TaskType != "" {
		fmt.Printf("  Type:   %s\n", result.TaskType)
	}
	if result.DagID != "" {
		fmt.Printf("  DAG:    %s\n", result.DagID)
	}

	return nil
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// extractFlagValue extracts the value from a --key=value argument.
func extractFlagValue(arg, prefix string) (string, bool) {
	if len(arg) > len(prefix) && arg[:len(prefix)] == prefix {
		return arg[len(prefix):], true
	}
	return "", false
}
