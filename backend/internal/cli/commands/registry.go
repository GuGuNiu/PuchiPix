package commands

// Registry holds all registered commands and provides lookup by name
// or alias.
type Registry struct {
	commands []Command
}

// NewRegistry creates a Registry pre-populated with all built-in commands.
func NewRegistry() *Registry {
	cmds := []Command{
		// ── System & monitoring ──
		healthCommand{},
		systemCommand{},
		statsCommand{},
		sitesCommand{},

		// ── DAG monitoring & status ──
		statusCommand{},
		watchCommand{},
		logsCommand{},
		slotsCommand{},
		schedulerCommand{},
		dagCommand{},
		nodeCommand{},
		traceCommand{},
		workerCommand{},
		eventsCommand{},

		// ── DAG lifecycle control ──
		pauseCommand,
		resumeCommand,
		retryCommand,
		cancelCommand,
		dagCreateCommand{},
		dagLinkCommand{},
		dagTriggerCommand{},
		dagDeleteCommand{},

		// ── Task & gallery management ──
		tasksCommand{},
		galleriesCommand{},
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
