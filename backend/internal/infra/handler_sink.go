package infra

// LogSinkHandler pushes every entry into the global ring buffer
// for API and CLI queries. This is a pass-through handler typically
// used inside a MultiHandler alongside ConsoleHandler or JSONHandler.
type LogSinkHandler struct {
	name     string
	minLevel LogLevel
	sink     *LogSink
}

// NewLogSinkHandler creates a handler that writes to the given LogSink.
func NewLogSinkHandler(minLevel LogLevel, sink *LogSink) *LogSinkHandler {
	return &LogSinkHandler{
		name:     "LogSinkHandler",
		minLevel: minLevel,
		sink:     sink,
	}
}

func (h *LogSinkHandler) Name() string             { return h.name }
func (h *LogSinkHandler) Enabled(level LogLevel) bool { return level >= h.minLevel }

func (h *LogSinkHandler) Handle(entry StructuredLogEntry) error {
	h.sink.Push(entry)
	return nil
}

func (h *LogSinkHandler) Flush() error { return nil }
