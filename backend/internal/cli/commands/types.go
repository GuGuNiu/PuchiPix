package commands

import (
	"context"
	"database/sql"

	"backend/internal/cli/dagclient"
)

// CommandContext carries the API client, parsed arguments, and global
// flags to each command executor.
type CommandContext struct {
	Client *dagclient.Client
	DB     *sql.DB
	Args   []string
	JSON   bool
	Ctx    context.Context
}

// Command defines the interface for CLI commands.
type Command interface {
	Name() string
	Description() string
	Usage() string
	Aliases() []string
	Execute(ctx CommandContext) error
}
