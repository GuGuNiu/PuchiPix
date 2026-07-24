import type { LogLevel } from "./log-level";
import type { StructuredLogEntry } from "./log-entry";

/**
 * Handler processes a StructuredLogEntry — formats it and writes
 * to an output destination. This is the slog Handler pattern:
 * Logger collects parameters → Handler formats + outputs.
 *
 * Implementations include:
 * - ConsoleHandler: colorized text for local development
 * - JSONHandler: NDJSON for production log collection
 * - LogSinkHandler: ring buffer for API/CLI queries
 * - MultiHandler: composite that fans out to multiple sub-handlers
 */
export interface LogHandler {
  /** Unique name for debugging and identification */
  readonly name: string;

  /** Return true if entries at this level should be processed */
  enabled(level: LogLevel): boolean;

  /** Process (format + write) a single log entry */
  handle(entry: StructuredLogEntry): void;

  /** Called on process exit for flush / cleanup */
  flush?(): void;
}

/**
 * Composite handler that fans out a single entry to multiple sub-handlers.
 *
 * Use for dual-write scenarios:
 *   new MultiHandler([consoleHandler, jsonHandler, sinkHandler])
 */
export class MultiHandler implements LogHandler {
  readonly name = "MultiHandler";
  private handlers: LogHandler[];

  constructor(handlers: LogHandler[]) {
    this.handlers = handlers;
  }

  enabled(level: LogLevel): boolean {
    return this.handlers.some((h) => h.enabled(level));
  }

  handle(entry: StructuredLogEntry): void {
    for (const handler of this.handlers) {
      if (handler.enabled(entry.levelValue)) {
        try {
          handler.handle(entry);
        } catch {
          // Prevent one faulty handler from crashing the pipeline
        }
      }
    }
  }

  flush(): void {
    for (const handler of this.handlers) {
      try {
        handler.flush?.();
      } catch {
        // Best-effort flush
      }
    }
  }
}
