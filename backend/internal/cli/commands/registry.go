package commands

// Registry holds all registered commands and provides lookup by name
// or alias.
type Registry struct {
	commands []Command
}

// NewRegistry creates a Registry pre-populated with all built-in commands.
func NewRegistry() *Registry {
	cmds := []Command{
		statusCommand{},
		watchCommand{},
		logsCommand{},
		slotsCommand{},
		schedulerCommand{},
		dagCommand{},
		nodeCommand{},
		traceCommand{},
		workerCommand{},
		pauseCommand,
		resumeCommand,
		retryCommand,
		cancelCommand,
		eventsCommand{},
	}
	return &Registry{commands: cmds}
}

// Commands returns all registered commands.
func (r *Registry) Commands() []Command {
	return r.commands
}

// Find returns the command matching the given name or alias, or nil.
func (r *Registry) Find(name string) Command {
	for _, cmd := range r.commands {
		if cmd.Name() == name {
			return cmd
		}
		for _, a := range cmd.Aliases() {
			if a == name {
				return cmd
			}
		}
	}
	return nil
}
