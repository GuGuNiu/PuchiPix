package commands

type Registry struct {
	commands []Command
}

func NewRegistry() *Registry {
	cmds := []Command{
		healthCommand{},
		systemCommand{},
		statsCommand{},
		sitesCommand{},
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
		pauseCommand,
		resumeCommand,
		retryCommand,
		cancelCommand,
		dagCreateCommand{},
		dagLinkCommand{},
		dagTriggerCommand{},
		dagDeleteCommand{},
		tasksCommand{},
		galleriesCommand{},
		dbCommand{},
	}
	return &Registry{commands: cmds}
}

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
