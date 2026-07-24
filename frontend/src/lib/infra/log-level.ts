/**
 * Log severity levels with spacing for custom levels between standard values.
 *
 * Level numbering mirrors Go slog: gaps allow insertion of project-specific
 * levels without renumbering. The DAG system, CLI, and API filters all
 * reference these numeric values.
 *
 * Wire format: these exact integer values appear in StructuredLogEntry.levelValue.
 */
export enum LogLevel {
  /** Development-only verbose output, disabled by default in production */
  TRACE = -8,
  /** Detailed diagnostic information for local debugging */
  DEBUG = -4,
  /** Normal operational events (default minimum level) */
  INFO = 0,
  /** Unexpected but recoverable situations */
  WARN = 4,
  /** Errors that affect functionality but do not crash */
  ERROR = 8,
  /** Unrecoverable errors that precede process exit */
  FATAL = 12,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: "TRACE",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: " INFO",
  [LogLevel.WARN]: " WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
};

/**
 * Parse a log level string (case-insensitive) from env or config.
 * Defaults to DEBUG in development, INFO otherwise.
 */
export function parseLogLevel(raw: string | undefined, isDev: boolean): LogLevel {
  if (!raw) return isDev ? LogLevel.DEBUG : LogLevel.INFO;

  const upper = raw.toUpperCase();
  switch (upper) {
    case "TRACE":
      return LogLevel.TRACE;
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
    case "WARNING":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    case "FATAL":
      return LogLevel.FATAL;
    default:
      return isDev ? LogLevel.DEBUG : LogLevel.INFO;
  }
}

/**
 * Get the 5-character left-padded label for a log level.
 * INFO/WARN have a leading space so all labels align at 5 chars.
 */
export function logLevelLabel(level: LogLevel): string {
  return LEVEL_LABELS[level] ?? "?????";
}
