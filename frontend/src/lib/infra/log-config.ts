import { LogLevel, parseLogLevel } from "./log-level";
import type { LogHandler } from "./handler";
import { ConsoleHandler } from "./handler-console";
import { JSONHandler } from "./handler-json";
import { MultiHandler } from "./handler";
import { LogSinkHandler } from "./handler-sink";
import { LogSink } from "./log-sink";

/**
 * Global logger configuration driven by environment variables.
 *
 * Override defaults via:
 * - LOG_LEVEL: minimum log level (TRACE | DEBUG | INFO | WARN | ERROR | FATAL)
 * - LOG_FORMAT: output format (console | json)
 * - LOG_HANDLERS: comma-separated handler names (console, json, sink)
 * - LOG_SINK_CAPACITY: ring buffer size (default 1000)
 */
export interface LogConfig {
  /** Minimum log level */
  level: LogLevel;
  /** Primary output format */
  format: "console" | "json";
  /** Active handler names */
  handlerNames: string[];
  /** LogSink ring buffer capacity */
  sinkCapacity: number;
}

let globalSink: LogSink | null = null;
let globalHandler: LogHandler | null = null;

function resolveConfig(): LogConfig {
  const isDev = process.env.NODE_ENV !== "production";

  const level = parseLogLevel(
    process.env.LOG_LEVEL,
    isDev,
  );

  const format = (process.env.LOG_FORMAT === "json" ? "json" : "console") as
    | "console"
    | "json";

  const handlerNames = process.env.LOG_HANDLERS
    ? process.env.LOG_HANDLERS.split(",").map((s) => s.trim())
    : isDev
      ? ["console"]
      : ["json", "sink"];

  const sinkCapacity = parseInt(process.env.LOG_SINK_CAPACITY || "1000", 10) || 1000;

  return { level, format, handlerNames, sinkCapacity };
}

/**
 * Build the handler stack from configuration.
 * Called once at startup; result is cached globally.
 */
export function buildGlobalHandler(): LogHandler {
  if (globalHandler) return globalHandler;

  const config = resolveConfig();
  const handlers: LogHandler[] = [];

  for (const name of config.handlerNames) {
    switch (name) {
      case "console":
        handlers.push(new ConsoleHandler(config.level));
        break;
      case "json":
        handlers.push(new JSONHandler(config.level));
        break;
      case "sink": {
        const sink = getGlobalSink(config.sinkCapacity);
        handlers.push(new LogSinkHandler(config.level, sink));
        break;
      }
    }
  }

  if (handlers.length === 0) {
    handlers.push(new ConsoleHandler(config.level));
  }

  globalHandler =
    handlers.length === 1 ? handlers[0] : new MultiHandler(handlers);
  return globalHandler;
}

/**
 * Get or create the global LogSink instance.
 * The CLI and API endpoints use this for log queries.
 */
export function getGlobalSink(capacity?: number): LogSink {
  if (!globalSink) {
    globalSink = new LogSink(capacity ?? 1000);
  }
  return globalSink;
}

/**
 * Get the current log configuration (read-only).
 */
export function getLogConfig(): LogConfig {
  return resolveConfig();
}
