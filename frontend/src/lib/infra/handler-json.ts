import type { LogHandler } from "./handler";
import type { StructuredLogEntry } from "./log-entry";
import type { LogLevel } from "./log-level";

/**
 * JSONHandler outputs newline-delimited JSON (NDJSON) to stdout.
 *
 * Each log entry is a single JSON object suitable for ingestion by
 * log aggregators (ELK, Loki, Datadog). Human-readable formatting
 * is handled downstream by the aggregation platform.
 */
export class JSONHandler implements LogHandler {
  readonly name = "JSONHandler";
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel) {
    this.minLevel = minLevel;
  }

  enabled(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  handle(entry: StructuredLogEntry): void {
    const record: Record<string, unknown> = {
      timestamp: entry.timestamp,
      level: entry.level.trim(),
      module: entry.module,
      message: entry.message,
    };

    // Flatten known context fields into top-level JSON keys
    if (entry.context.traceId) record.traceId = entry.context.traceId;
    if (entry.context.dagId) record.dagId = entry.context.dagId;
    if (entry.context.nodeId) record.nodeId = entry.context.nodeId;
    if (entry.context.taskType) record.taskType = entry.context.taskType;
    if (entry.context.phase) record.phase = entry.context.phase;

    // Include any extra context fields
    const knownKeys = new Set(["traceId", "dagId", "nodeId", "taskType", "phase"]);
    for (const [k, v] of Object.entries(entry.context)) {
      if (!knownKeys.has(k) && v != null) {
        record[k] = v;
      }
    }

    if (entry.data != null) {
      if (entry.data instanceof Error) {
        record.error = { name: entry.data.name, message: entry.data.message };
      } else {
        record.data = entry.data;
      }
    }

    // NDJSON: one JSON object per line, no indentation
    process.stdout.write(JSON.stringify(record) + "\n");
  }
}
