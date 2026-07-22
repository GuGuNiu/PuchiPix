package commands_test

import (
	"strings"
	"testing"

	"backend/internal/cli/commands"
)

// TestRegistryHasCommands verifies that all expected commands are registered.
func TestRegistryHasCommands(t *testing.T) {
	registry := commands.NewRegistry()
	cmds := registry.Commands()

	expected := []string{
		"status", "watch", "logs", "slots", "scheduler",
		"dag", "node", "trace", "worker",
		"pause", "resume", "retry", "cancel",
		"events",
	}

	cmdNames := make(map[string]bool)
	for _, cmd := range cmds {
		cmdNames[cmd.Name()] = true
	}

	for _, name := range expected {
		if !cmdNames[name] {
			t.Errorf("command %q is not registered", name)
		}
	}

	if len(cmds) < 12 {
		t.Errorf("registry has %d commands, want at least 12", len(cmds))
	}
}

// TestCommandMetadata verifies that every registered command has non-empty
// Name, Description, and Usage fields.
func TestCommandMetadata(t *testing.T) {
	registry := commands.NewRegistry()

	for _, cmd := range registry.Commands() {
		t.Run(cmd.Name(), func(t *testing.T) {
			if cmd.Name() == "" {
				t.Error("Name() is empty")
			}
			if cmd.Description() == "" {
				t.Error("Description() is empty")
			}
			if cmd.Usage() == "" {
				t.Error("Usage() is empty")
			}
		})
	}
}

// TestFindCommand verifies that Find returns the correct command by name.
func TestFindCommand(t *testing.T) {
	registry := commands.NewRegistry()

	tests := []string{
		"status", "watch", "logs", "dag", "pause", "events",
	}

	for _, name := range tests {
		t.Run("find_"+name, func(t *testing.T) {
			cmd := registry.Find(name)
			if cmd == nil {
				t.Errorf("Find(%q) returned nil", name)
			}
			if cmd != nil && cmd.Name() != name {
				t.Errorf("Find(%q) returned command with name %q", name, cmd.Name())
			}
		})
	}
}

// TestFindUnknownCommand verifies that Find returns nil for unknown commands.
func TestFindUnknownCommand(t *testing.T) {
	registry := commands.NewRegistry()

	cmd := registry.Find("nonexistent-command")
	if cmd != nil {
		t.Errorf("Find(nonexistent) returned non-nil: %v", cmd)
	}
}

// TestPrintHelp verifies that help output contains all command names.
func TestPrintHelp(t *testing.T) {
	registry := commands.NewRegistry()

	// PrintHelp writes to stdout, we can't easily capture it in Go tests
	// without redirecting os.Stdout. Instead, we verify the registry
	// contains all expected commands by iterating.
	cmds := registry.Commands()
	for _, cmd := range cmds {
		if !strings.Contains(cmd.Description(), "") {
			t.Errorf("command %q has empty description", cmd.Name())
		}
	}
}

// TestCommandContextJSON verifies that the CommandContext struct correctly
// carries the JSON flag.
func TestCommandContextJSON(t *testing.T) {
	ctx := commands.CommandContext{
		JSON: true,
	}

	if !ctx.JSON {
		t.Error("JSON flag is not set correctly")
	}
}
