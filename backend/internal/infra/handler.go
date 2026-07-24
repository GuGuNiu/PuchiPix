package infra

// LogHandler processes a StructuredLogEntry — formats it and writes
// to an output destination. This is the slog Handler pattern.
//
// Implementations:
// - ConsoleHandler: human-readable text for dev
// - JSONHandler: NDJSON for prod
// - LogSinkHandler: ring buffer for API/CLI queries
// - MultiHandler: fans out to multiple sub-handlers
type LogHandler interface {
	// Name returns a unique identifier for debugging and identification.
	Name() string

	// Enabled returns true if entries at this level should be processed.
	Enabled(level LogLevel) bool

	// Handle processes (formats + writes) a single log entry.
	Handle(entry StructuredLogEntry) error

	// Flush is called on process exit for cleanup (optional).
	Flush() error
}

// --- Exported aliases for use by other packages ---

// LogHandlerInterface is the exported name for the handler interface.
// The lowercase type above is package-private; this alias makes it
// accessible from tests and external handler implementations.
type LogHandlerInterface = LogHandler
