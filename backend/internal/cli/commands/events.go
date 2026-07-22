package commands

import (
	"encoding/json"
	"fmt"
	"strconv"

	"backend/internal/cli/ui"
)

type eventsCommand struct{}

func (eventsCommand) Name() string        { return "events" }
func (eventsCommand) Description() string { return "View event history for a specific DAG" }
func (eventsCommand) Usage() string        { return "puchipix-cli events <dagId> [--limit N] [--from-seq N]" }
func (eventsCommand) Aliases() []string   { return nil }

func (eventsCommand) Execute(ctx CommandContext) error {
	dagID := firstNonFlag(ctx.Args)
	if dagID == "" {
		fmt.Printf("%sPlease specify DAG ID: puchipix-cli events <dagId>%s\n", ui.Yellow, ui.Reset)
		fmt.Printf("%sUse 'puchipix-cli status' to see all DAG IDs%s\n", ui.Dim, ui.Reset)
		return nil
	}

	limitStr := getArg(ctx.Args, "--limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	fromSeqStr := getArg(ctx.Args, "--from-seq")
	fromSeq := 0
	if fromSeqStr != "" {
		if n, err := strconv.Atoi(fromSeqStr); err == nil && n > 0 {
			fromSeq = n
		}
	}

	data, err := ctx.Client.GetDagEvents(dagID, limit, fromSeq)
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("DAG %s event history (%d/%d)", dagID, len(data.Events), data.TotalEvents))
	for _, e := range data.Events {
		fmt.Printf("  %s%s%s #%d %s%s%s\n",
			ui.Dim, ui.FormatDateTime(e.Timestamp), ui.Reset, e.Seq, ui.Cyan, e.Type, ui.Reset)
		if e.NodeID != "" {
			fmt.Printf("    %snode: %s%s\n", ui.Dim, e.NodeID, ui.Reset)
		}
		if len(e.Payload) > 0 && string(e.Payload) != "{}" {
			payloadStr := string(e.Payload)
			if len(payloadStr) > 120 {
				payloadStr = payloadStr[:120]
			}
			fmt.Printf("    %spayload: %s%s\n", ui.Dim, payloadStr, ui.Reset)
		}
	}
	if len(data.Events) == 0 {
		fmt.Printf("%s(no event records)%s\n", ui.Dim, ui.Reset)
	}
	return nil
}
