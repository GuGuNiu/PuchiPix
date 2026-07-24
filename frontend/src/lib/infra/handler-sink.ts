import type { LogHandler } from "./handler";
import type { StructuredLogEntry } from "./log-entry";
import type { LogLevel } from "./log-level";
import { LogSink } from "./log-sink";

/**
 * LogSinkHandler pushes every entry into the global ring buffer
 * for API and CLI queries while still passing through to the caller.
 *
 * This is a pass-through handler — it delegates formatting to another
 * handler (usually ConsoleHandler or JSONHandler) while writing a
 * structured copy to the LogSink.
 */
export class LogSinkHandler implements LogHandler {
  readonly name = "LogSinkHandler";
  private minLevel: LogLevel;
  private sink: LogSink;

  constructor(minLevel: LogLevel, sink: LogSink) {
    this.minLevel = minLevel;
    this.sink = sink;
  }

  enabled(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  handle(entry: StructuredLogEntry): void {
    this.sink.push(entry);
  }
}
