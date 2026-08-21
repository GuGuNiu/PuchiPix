package commands

import (
	"encoding/json"
	"fmt"

	"backend/internal/cli/ui"
)

type sitesCommand struct{}

func (sitesCommand) Name() string        { return "sites" }
func (sitesCommand) Description() string { return "List supported site providers" }
func (sitesCommand) Usage() string        { return "puchipix-cli sites" }
func (sitesCommand) Aliases() []string    { return nil }

func (sitesCommand) Execute(ctx CommandContext) error {
	sites, err := ctx.Client.GetSites()
	if err != nil {
		return err
	}

	if ctx.JSON {
		b, _ := json.MarshalIndent(sites, "", "  ")
		fmt.Println(string(b))
		return nil
	}

	if len(sites) == 0 {
		fmt.Printf("%sNo site providers registered%s\n", ui.Dim, ui.Reset)
		return nil
	}

	ui.PrintDivider(fmt.Sprintf("Supported Sites (%d)", len(sites)))
	for _, s := range sites {
		fmt.Printf("  %s%s%s [%s]\n", ui.Cyan, s.SiteID, ui.Reset, s.Type)
		if s.Name != "" {
			fmt.Printf("    %sName%s:     %s\n", ui.Dim, ui.Reset, s.Name)
		}
		if len(s.Domains) > 0 {
			fmt.Printf("    %sDomains%s:  %s\n", ui.Dim, ui.Reset, joinStrings(s.Domains, ", "))
		}
		if s.Description != "" {
			fmt.Printf("    %sDesc%s:     %s\n", ui.Dim, ui.Reset, s.Description)
		}
		fmt.Println()
	}

	return nil
}
