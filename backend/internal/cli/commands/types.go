package commands

import (
	"context"

	"backend/internal/cli/dagclient"
)

// CommandContext carries the API client, parsed arguments, and global
// flags to each command executor.
type CommandContext struct {
	Client *dagclient.Client
	Args   []string
	JSON   bool
	Ctx    context.Context
}

// Command defines the interface for CLI commands, mirroring the
// TypeScript Command interface.
type Command interface {
	Name() string
	Description() string
	Usage() string
	Aliases() []string
	Execute(ctx CommandContext) error
}

// BaseCommand provides default values for optional Command fields,
// reducing boilerplate in concrete command implementations.
type BaseCommand struct {
	CmdName        string
	CmdDescription string
	CmdUsage       string
	CmdAliases     []string
}

func (b BaseCommand) Name() string        { return b.CmdName }
func (b BaseCommand) Description() string { return b.CmdDescription }
func (b BaseCommand) Usage() string       { return b.CmdUsage }
func (b BaseCommand) Aliases() []string   { return b.CmdAliases }
