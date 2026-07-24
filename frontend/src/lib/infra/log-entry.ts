import type { LogContext } from "./log-context";
import type { LogLevel } from "./log-level";

/**
 * Canonical in-memory representation of a single log entry.
 *
 * This is the wire format exchanged between Logger → Handler → LogSink → API.
 * Field names match the JSON output format (camelCase for JS/TS convention).
 */
export interface StructuredLogEntry {
  /** ISO 8601 timestamp with millisecond precision */
  timestamp: string;
  /** Human-readable level label (aligned to 5 chars, e.g. " INFO") */
  level: string;
  /** Numeric level for filtering (see LogLevel enum) */
  levelValue: LogLevel;
  /** Source module name in PascalCase (e.g. "GalleryStore", "Scheduler") */
  module: string;
  /** Plain English log message describing the event */
  message: string;
  /** Trace and task context bound to this logger */
  context: LogContext;
  /** Structured payload: Error, object, or primitive */
  data?: unknown;
}
