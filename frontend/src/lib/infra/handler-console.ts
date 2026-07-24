import type { LogHandler } from "./handler";
import type { StructuredLogEntry } from "./log-entry";
import type { LogLevel } from "./log-level";
import { logLevelLabel } from "./log-level";
import { formatContextPairs } from "./log-context";

/**
 * ConsoleHandler outputs human-readable colored log lines to stdout/stderr.
 *
 * Format: "2026-07-22 14:00:00.123  INFO [ModuleName] message dag=xxx node=yyy"
 *
 * Intended for local development. For production, use JSONHandler.
 */
export class ConsoleHandler implements LogHandler {
  readonly name = "ConsoleHandler";
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel) {
    this.minLevel = minLevel;
  }

  enabled(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  handle(entry: StructuredLogEntry): void {
    const ts = formatTimestamp();
    const label = logLevelLabel(entry.levelValue);
    const ctxStr = formatContext(entry);

    // Build formatted line: timestamp LEVEL [Module] message ctx...
    const line = `${ts} ${label} [${entry.module}] ${entry.message}${ctxStr}`;

    const writer = entry.levelValue >= 8 /* ERROR */ ? console.error
      : entry.levelValue >= 4 /* WARN */ ? console.warn
      : console.log;

    if (entry.data != null) {
      writer(line, entry.data);
    } else {
      writer(line);
    }
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)} ` +
    `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}.` +
    pad(now.getMilliseconds(), 3)
  );
}

function formatContext(entry: StructuredLogEntry): string {
  const pairs = formatContextPairs(entry.context);
  return pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
}
