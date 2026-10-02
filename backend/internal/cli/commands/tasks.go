package commands

import (
	"encoding/json"
	"fmt"
	"strconv"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type tasksCommand struct{}

func (tasksCommand) Name() string { return "tasks" }
func (tasksCommand) Description() string {
	return "Manage video download tasks (list / detail / action / delete)"
}
func (tasksCommand) Usage() string {
	return "puchipix-cli tasks [list|detail|action|delete] [args]"
}
func (tasksCommand) Aliases() []string { return []string{"task"} }

func (tasksCommand) Execute(ctx CommandContext) error {
	subcommand := ""
	if len(ctx.Args) > 0 {
		subcommand = ctx.Args[0]
	}

	switch subcommand {
	case "", "list":
		return tasksList(ctx)
	case "detail":
		return tasksDetail(ctx)
	case "action":
		return tasksAction(ctx)
	case "delete", "rm":
		return tasksDelete(ctx)
	default:
		fmt.Printf("%sUnknown subcommand: %s%s\n", ui.Red, subcommand, ui.Reset)
		printTasksUsage()
		return nil
	}
}

func printTasksUsage() {
	fmt.Printf("%sUsage:%s puchipix-cli tasks <list|detail|action|delete>\n", ui.Bold, ui.Reset)
	fmt.Printf("  %slist%s     List download tasks [--limit=20] [--offset=0]\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sdetail%s   Show task details <taskId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %saction%s   Perform action <taskId> <start|pause|resume|cancel|retry>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sdelete%s   Delete a task <taskId>\n", ui.Cyan, ui.Reset)
}

func tasksList(ctx CommandContext) error {
	limit := 20
	offset := 0
	args := ctx.Args
	if len(args) > 0 && args[0] == "list" {
		args = args[1:]
	}
	if v := getArg(args, "--limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if v := getArg(args, "--offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	tasks, err := ctx.Client.GetTasks(limit, offset)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(tasks, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if len(tasks) == 0 {
		fmt.Printf("%sNo download tasks found%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Download Tasks (%d, offset %d)", len(tasks), offset))
	for _, t := range tasks {
		displayID := "\u2014"
		if t.DisplayID != nil && *t.DisplayID != "" {
			displayID = *t.DisplayID
		}
		statusPill := taskStatusPill(t.Status)
		title := t.GalleryTitle
		if title == "" {
			title = t.URL
		}
		person := t.Person
		if person == "null" || person == "" {
			person = "\u2014"
		}
		fmt.Printf("  %s#%d%s [%s] %s  %s  %s%.0f%%%s  %s\n",
			ui.Bold, t.ID, ui.Reset,
			displayID,
			person,
			statusPill,
			ui.Cyan, t.Progress, ui.Reset,
			ui.Truncate(title, 50))
		if t.ErrorMsg != "" {
			fmt.Printf("    %sError: %s%s\n", ui.Red, ui.Truncate(t.ErrorMsg, 60), ui.Reset)
		}
	}

	if len(tasks) == limit {
		fmt.Printf("\n  %s--limit=%d --offset=%d for next page%s\n",
			ui.Dim, limit, offset+limit, ui.Reset)
	}

	return nil
}

func tasksDetail(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "detail" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli tasks detail <taskId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid task ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	task, err := ctx.Client.GetTask(id)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(task, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	displayID := "\u2014"
	if task.DisplayID != nil && *task.DisplayID != "" {
		displayID = *task.DisplayID
	}

	ui.PrintDivider(fmt.Sprintf("Task #%d", task.ID))
	fmt.Printf("  %sID%s:         %d\n", ui.Bold, ui.Reset, task.ID)
	fmt.Printf("  %sDisplayID%s:  %s\n", ui.Bold, ui.Reset, displayID)
	fmt.Printf("  %sStatus%s:     %s\n", ui.Bold, ui.Reset, taskStatusPill(task.Status))
	fmt.Printf("  %sProgress%s:   %.1f%%\n", ui.Bold, ui.Reset, task.Progress)
	if task.GalleryTitle != "" {
		fmt.Printf("  %sTitle%s:      %s\n", ui.Bold, ui.Reset, task.GalleryTitle)
	}
	person := task.Person
	if person == "null" || person == "" {
		person = "\u2014"
	}
	fmt.Printf("  %sPerson%s:     %s\n", ui.Bold, ui.Reset, person)
	fmt.Printf("  %sURL%s:        %s\n", ui.Bold, ui.Reset, task.URL)
	if task.M3U8URL != "" {
		fmt.Printf("  %sM3U8 URL%s:   %s\n", ui.Bold, ui.Reset, task.M3U8URL)
	}
	fmt.Printf("  %sFormat%s:     %s\n", ui.Bold, ui.Reset, task.Format)
	fmt.Printf("  %sPriority%s:   %d\n", ui.Bold, ui.Reset, task.Priority)
	if task.FilePath != "" {
		fmt.Printf("  %sFile path%s:  %s\n", ui.Bold, ui.Reset, task.FilePath)
	}
	if task.ErrorMsg != "" {
		fmt.Printf("  %sError%s:      %s%s%s\n", ui.Bold, ui.Reset, ui.Red, task.ErrorMsg, ui.Reset)
	}
	fmt.Printf("  %sCreated%s:    %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(task.CreatedAt))
	fmt.Printf("  %sUpdated%s:    %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(task.UpdatedAt))

	return nil
}

func tasksAction(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "action" {
		args = args[1:]
	}
	if len(args) < 2 {
		fmt.Printf("%sUsage: puchipix-cli tasks action <taskId> <start|pause|resume|cancel|retry>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid task ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	action := args[1]
	validActions := map[string]bool{
		"start": true, "pause": true, "resume": true,
		"cancel": true, "retry": true,
	}
	if !validActions[action] {
		fmt.Printf("%sInvalid action: %s (start/pause/resume/cancel/retry)%s\n", ui.Red, action, ui.Reset)
		return nil
	}

	fmt.Printf("%sPerforming '%s' on task #%d...%s\n", ui.Yellow, action, id, ui.Reset)

	result, err := ctx.Client.TaskAction(id, action)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	icon := ui.Green + "\u2705"
	if action == "cancel" {
		icon = ui.Red + "\U0001f6ab"
	}
	fmt.Printf("%s Task #%d %s \u2192 %s%s\n", icon, result.ID, action, result.Status, ui.Reset)
	if result.DagID != "" {
		fmt.Printf("  %sDAG: %s%s\n", ui.Dim, result.DagID, ui.Reset)
	}

	return nil
}

func tasksDelete(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && (args[0] == "delete" || args[0] == "rm") {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli tasks delete <taskId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid task ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	fmt.Printf("%sDeleting task #%d...%s\n", ui.Yellow, id, ui.Reset)

	if err := ctx.Client.DeleteTask(id); err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok && dagErr.StatusCode == 404 {
			fmt.Printf("%sTask not found%s\n", ui.Red, ui.Reset)
			return nil
		}
		return err
	}

	fmt.Printf("%s Task #%d deleted%s\n", ui.Green+"\u2705", id, ui.Reset)
	return nil
}

func taskStatusPill(status string) string {
	colors := map[string]string{
		"pending":     ui.Gray,
		"queued":      ui.Yellow,
		"downloading": ui.Cyan,
		"paused":      ui.Yellow,
		"completed":   ui.Green,
		"failed":      ui.Red,
		"cancelled":   ui.Gray,
		"retrying":    ui.Yellow,
	}
	color, ok := colors[status]
	if !ok {
		return status
	}
	return color + status + ui.Reset
}
