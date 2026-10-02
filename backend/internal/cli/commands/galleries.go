package commands

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type galleriesCommand struct{}

func (galleriesCommand) Name() string { return "galleries" }
func (galleriesCommand) Description() string {
	return "Manage galleries (list / detail / progress / retry / pause / resume / delete)"
}
func (galleriesCommand) Usage() string {
	return "puchipix-cli galleries <list|detail|progress|retry|pause|resume|delete> [args]"
}
func (galleriesCommand) Aliases() []string { return []string{"gallery", "gal"} }

func (galleriesCommand) Execute(ctx CommandContext) error {
	subcommand := ""
	if len(ctx.Args) > 0 {
		subcommand = ctx.Args[0]
	}

	switch subcommand {
	case "", "list":
		return galleriesList(ctx)
	case "detail":
		return galleriesDetail(ctx)
	case "progress":
		return galleriesProgress(ctx)
	case "retry", "retry-failed":
		return galleriesAction(ctx, "retry-failed")
	case "pause":
		return galleriesAction(ctx, "pause")
	case "resume":
		return galleriesAction(ctx, "resume")
	case "delete", "rm":
		return galleriesDelete(ctx)
	default:
		fmt.Printf("%sUnknown subcommand: %s%s\n", ui.Red, subcommand, ui.Reset)
		printGalleriesUsage()
		return nil
	}
}

func printGalleriesUsage() {
	fmt.Printf("%sUsage:%s puchipix-cli galleries <subcommand> [args]\n", ui.Bold, ui.Reset)
	fmt.Printf("  %slist%s      List galleries [--limit=20] [--offset=0] [--status=completed]\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sdetail%s    Show gallery details <galleryId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sprogress%s  Show file-level progress <galleryId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sretry%s     Retry failed downloads <galleryId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %spause%s     Pause gallery download <galleryId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sresume%s    Resume gallery download <galleryId>\n", ui.Cyan, ui.Reset)
	fmt.Printf("  %sdelete%s    Delete gallery <galleryId> [--force]\n", ui.Cyan, ui.Reset)
}

func galleriesList(ctx CommandContext) error {
	limit := 20
	offset := 0
	status := ""
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
	if v := getArg(args, "--status"); v != "" {
		status = v
	}

	galleries, err := ctx.Client.GetGalleries(limit, offset, status)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(galleries, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if len(galleries) == 0 {
		msg := "No galleries found"
		if status != "" {
			msg += fmt.Sprintf(" with status '%s'", status)
		}
		fmt.Printf("%s%s%s\n", ui.Dim, msg, ui.Reset)
		return nil
	}

	title := fmt.Sprintf("Galleries (%d", len(galleries))
	if status != "" {
		title += fmt.Sprintf(", status=%s", status)
	}
	title += fmt.Sprintf(", offset %d)", offset)

	ui.PrintDivider(title)
	for _, g := range galleries {
		displayID := "\u2014"
		if g.DisplayID != nil && *g.DisplayID != "" {
			displayID = *g.DisplayID
		}
		title := g.Title
		if title == "" {
			title = "(untitled)"
		}
		fmt.Printf("  %s#%d%s [%s] %s  %s  %s%dP%dV%s\n",
			ui.Bold, g.ID, ui.Reset,
			displayID,
			galleryStatusPill(g.Status),
			ui.Truncate(title, 40),
			ui.Dim, g.ImageCount, g.VideoCount, ui.Reset)
		if g.Protagonist != "" {
			fmt.Printf("    %sProtagonist: %s%s\n", ui.Dim, g.Protagonist, ui.Reset)
		}
		if g.ErrorMsg != "" {
			fmt.Printf("    %sError: %s%s\n", ui.Red, ui.Truncate(g.ErrorMsg, 60), ui.Reset)
		}
	}

	if len(galleries) == limit {
		fmt.Printf("\n  %s--limit=%d --offset=%d for next page%s\n",
			ui.Dim, limit, offset+limit, ui.Reset)
	}

	return nil
}

func galleriesDetail(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "detail" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli galleries detail <galleryId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid gallery ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	g, err := ctx.Client.GetGallery(id)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(g, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	displayID := "\u2014"
	if g.DisplayID != nil && *g.DisplayID != "" {
		displayID = *g.DisplayID
	}

	ui.PrintDivider(fmt.Sprintf("Gallery #%d", g.ID))
	fmt.Printf("  %sID%s:           %d\n", ui.Bold, ui.Reset, g.ID)
	fmt.Printf("  %sDisplayID%s:    %s\n", ui.Bold, ui.Reset, displayID)
	fmt.Printf("  %sStatus%s:       %s\n", ui.Bold, ui.Reset, galleryStatusPill(g.Status))
	fmt.Printf("  %sSite%s:         %s\n", ui.Bold, ui.Reset, g.SiteID)
	if g.ScrapedDomain != "" {
		fmt.Printf("  %sDomain%s:       %s\n", ui.Bold, ui.Reset, g.ScrapedDomain)
	}
	fmt.Printf("  %sTitle%s:        %s\n", ui.Bold, ui.Reset, g.Title)
	if g.Protagonist != "" {
		fmt.Printf("  %sProtagonist%s:  %s\n", ui.Bold, ui.Reset, g.Protagonist)
	}
	if g.Category != "" {
		fmt.Printf("  %sCategory%s:     %s\n", ui.Bold, ui.Reset, g.Category)
	}
	if len(g.Tags) > 0 {
		fmt.Printf("  %sTags%s:         %s\n", ui.Bold, ui.Reset, ui.Truncate(strings.Join(g.Tags, ", "), 60))
	}
	fmt.Printf("  %sSource URL%s:   %s\n", ui.Bold, ui.Reset, g.SourceURL)
	fmt.Printf("  %sImages%s:       %d", ui.Bold, ui.Reset, g.ImageCount)
	if g.ExpectedImageCount > 0 {
		fmt.Printf(" (expected: %d)", g.ExpectedImageCount)
	}
	fmt.Println()
	fmt.Printf("  %sVideos%s:       %d", ui.Bold, ui.Reset, g.VideoCount)
	if g.ExpectedVideoCount > 0 {
		fmt.Printf(" (expected: %d)", g.ExpectedVideoCount)
	}
	fmt.Println()
	if g.TotalSize > 0 || g.DownloadedSize > 0 {
		fmt.Printf("  %sSize%s:         %s / %s\n", ui.Bold, ui.Reset,
			formatBytes(uint64(g.DownloadedSize)), formatBytes(uint64(g.TotalSize)))
	}
	if g.SavePath != "" {
		fmt.Printf("  %sSave path%s:    %s\n", ui.Bold, ui.Reset, g.SavePath)
	}
	fmt.Printf("  %sVerified%s:     %v\n", ui.Bold, ui.Reset, g.ContentVerified)
	if g.GameCharacters != nil && *g.GameCharacters != "" {
		fmt.Printf("  %sGame chars%s:   %s\n", ui.Bold, ui.Reset, *g.GameCharacters)
	}
	if g.PublishTime != nil && *g.PublishTime != "" {
		fmt.Printf("  %sPublish time%s: %s\n", ui.Bold, ui.Reset, *g.PublishTime)
	}
	if g.ErrorMsg != "" {
		fmt.Printf("  %sError%s:        %s%s%s\n", ui.Bold, ui.Reset, ui.Red, g.ErrorMsg, ui.Reset)
	}
	fmt.Printf("  %sCreated%s:      %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(g.CreatedAt))
	if g.CompletedAt != nil && *g.CompletedAt != "" {
		fmt.Printf("  %sCompleted%s:    %s\n", ui.Bold, ui.Reset, ui.FormatDateTime(*g.CompletedAt))
	}

	return nil
}

func galleriesProgress(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && args[0] == "progress" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli galleries progress <galleryId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid gallery ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	data, err := ctx.Client.GetGalleryFileProgress(id)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Gallery #%d — File Progress", id))

	if status, ok := data.Summary["status"].(string); ok {
		fmt.Printf("  %sStatus%s:          %s\n", ui.Bold, ui.Reset, galleryStatusPill(status))
	}
	total := toInt(data.Summary["totalFiles"])
	completed := toInt(data.Summary["completedFiles"])
	failed := toInt(data.Summary["failedFiles"])
	progress, _ := data.Summary["progress"].(float64)

	fmt.Printf("  %sTotal files%s:    %d\n", ui.Bold, ui.Reset, total)
	fmt.Printf("  %sCompleted%s:      %d\n", ui.Bold, ui.Reset, completed)
	fmt.Printf("  %sFailed%s:         %d\n", ui.Bold, ui.Reset, failed)
	if progress > 0 {
		fmt.Printf("  %sProgress%s:       %.1f%%\n", ui.Bold, ui.Reset, progress)
		fmt.Printf("  %sBar%s:            %s\n", ui.Bold, ui.Reset,
			ui.RenderProgressBar(completed, total, 24))
	}

	if len(data.Failed) > 0 {
		fmt.Println()
		ui.PrintDivider(fmt.Sprintf("Failed Files (%d)", len(data.Failed)))
		for _, f := range data.Failed {
			b, _ := json.MarshalIndent(f, "", "  ")
			fmt.Printf("  %s%s%s\n", ui.Dim, string(b), ui.Reset)
		}
	}

	return nil
}

func galleriesAction(ctx CommandContext, action string) error {
	args := ctx.Args
	if len(args) > 0 && (args[0] == "retry" || args[0] == "retry-failed" ||
		args[0] == "pause" || args[0] == "resume") {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli galleries %s <galleryId>%s\n",
			ui.Red, action, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid gallery ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	fmt.Printf("%sPerforming '%s' on gallery #%d...%s\n", ui.Yellow, action, id, ui.Reset)

	result, err := ctx.Client.GalleryAction(id, action)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	icon := ui.Green + "\u2705"
	if action == "pause" {
		icon = ui.Yellow + "\u23f8"
	}
	fmt.Printf("%s Gallery #%d %s \u2192 %s%s\n", icon, result.ID, action, result.Status, ui.Reset)
	if result.DagID != "" {
		fmt.Printf("  %sDAG: %s%s\n", ui.Dim, result.DagID, ui.Reset)
	}

	return nil
}

func galleriesDelete(ctx CommandContext) error {
	args := ctx.Args
	if len(args) > 0 && (args[0] == "delete" || args[0] == "rm") {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Printf("%sUsage: puchipix-cli galleries delete <galleryId>%s\n", ui.Red, ui.Reset)
		return nil
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Printf("%sInvalid gallery ID: %s%s\n", ui.Red, args[0], ui.Reset)
		return nil
	}

	fmt.Printf("%sDeleting gallery #%d (including images/videos)...%s\n",
		ui.Yellow, id, ui.Reset)

	if err := ctx.Client.DeleteGallery(id); err != nil {
		if dagErr, ok := err.(*dagclient.DagClientError); ok && dagErr.StatusCode == 404 {
			fmt.Printf("%sGallery not found%s\n", ui.Red, ui.Reset)
			return nil
		}
		return err
	}

	fmt.Printf("%s Gallery #%d deleted%s\n", ui.Green+"\u2705", id, ui.Reset)
	return nil
}

func galleryStatusPill(status string) string {
	colors := map[string]string{
		"pending":     ui.Gray,
		"scraping":    ui.Cyan,
		"downloading": ui.Cyan,
		"paused":      ui.Yellow,
		"completed":   ui.Green,
		"failed":      ui.Red,
		"cancelled":   ui.Gray,
	}
	color, ok := colors[status]
	if !ok {
		return status
	}
	return color + status + ui.Reset
}
