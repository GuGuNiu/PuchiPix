/**
 * Structured Logger for the frontend.
 *
 * Architecture: createLogger(module) → Logger → global Handler chain
 *
 * The Handler chain is built once at startup (log-config.ts) and reused
 * by all Logger instances. Each Logger binds a module name and optional
 * LogContext; log calls build a StructuredLogEntry and pass it through
 * the Handler chain for formatting and output.
 *
 * Supported handlers (configurable via LOG_HANDLERS env):
 * - console: ConsoleHandler (colorized text for dev)
 * - json:    JSONHandler (NDJSON for prod log collection)
 * - sink:    LogSinkHandler (ring buffer for API/CLI queries)
 *
 * CLI and DAG compatibility:
 * - CLI tools read from LogSink via getGlobalSink().query()
 * - DAG orchestrator uses logger.child({dagId, nodeId}) for trace context
 */

import { LogLevel, logLevelLabel } from "./log-level";
import type { LogContext } from "./log-context";
import { mergeContext } from "./log-context";
import type { StructuredLogEntry } from "./log-entry";
import { buildGlobalHandler } from "./log-config";
import type { LogHandler } from "./handler";

// Re-export types for backward compatibility
export type { LogContext };
export type { StructuredLogEntry };
export type { LogHandler };

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  fatal(message: string, data?: unknown): void;

  /** Create a child logger with merged context (immutable, original unchanged) */
  child(context: Partial<LogContext>): Logger;

  /** Execute fn with injected trace context for async boundary crossing */
  runWith?<T>(context: Partial<LogContext>, fn: () => T): T;
}

class LoggerImpl implements Logger {
  private module: string;
  private boundContext: LogContext;
  private handler: LogHandler;

  constructor(module: string, context: LogContext, handler: LogHandler) {
    this.module = module;
    this.boundContext = context;
    this.handler = handler;
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  fatal(message: string, data?: unknown): void {
    this.log(LogLevel.FATAL, message, data);
  }

  child(context: Partial<LogContext>): Logger {
    return new LoggerImpl(
      this.module,
      mergeContext(this.boundContext, context as LogContext),
      this.handler,
    );
  }

  runWith<T>(context: Partial<LogContext>, fn: () => T): T {
    // Future: inject via AsyncLocalStorage for cross-async trace propagation.
    // For now, just execute fn with the merged context available.
    return fn();
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.handler.enabled(level)) return;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: logLevelLabel(level),
      levelValue: level,
      module: this.module,
      message,
      context: this.boundContext,
      data,
    };

    this.handler.handle(entry);
  }
}

const loggerCache = new Map<string, Logger>();

/**
 * Create or retrieve a cached Logger for the given module name.
 *
 * Module names use PascalCase (e.g. "GalleryStore", "TaskStore", "Scheduler").
 * The first call builds the global Handler chain from environment config;
 * subsequent calls reuse the cached handler.
 */
export function createLogger(module: string): Logger {
  const existing = loggerCache.get(module);
  if (existing) return existing;

  const handler = buildGlobalHandler();
  const logger = new LoggerImpl(module, {}, handler);
  loggerCache.set(module, logger);
  return logger;
}
