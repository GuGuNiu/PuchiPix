import { logSink } from './log-sink';

export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
}

export interface LogContext {
  traceId?: string;
  dagId?: string;
  nodeId?: string;
  taskType?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  levelValue: number;
  module: string;
  message: string;
  context: LogContext;
  data?: unknown;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  child(context: LogContext): Logger;
  runWith<T>(context: LogContext, fn: () => T): T;
}

function getEnvLogLevel(): LogLevel {
  const raw = typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined;
  if (!raw) return LogLevel.INFO;
  switch (raw.toUpperCase()) {
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

const globalMinLevel = getEnvLogLevel();

let currentTraceContext: LogContext | null = null;

export function getCurrentTraceContext(): LogContext {
  return currentTraceContext ?? {};
}

export function runWithTraceContext<T>(context: LogContext, fn: () => T): T {
  const prev = currentTraceContext;
  const traceId = context.traceId ?? generateTraceId();
  currentTraceContext = { ...prev, ...context, traceId };
  try {
    return fn();
  } finally {
    currentTraceContext = prev;
  }
}

function generateTraceId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '\x1b[37m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};
const MODULE_COLOR = '\x1b[36m';
const RESET = '\x1b[0m';

function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

function formatContextTags(ctx: LogContext): string {
  const parts: string[] = [];
  if (ctx.traceId) parts.push(`trace=${ctx.traceId}`);
  if (ctx.dagId) parts.push(`dag=${ctx.dagId}`);
  if (ctx.nodeId) parts.push(`node=${ctx.nodeId}`);
  if (ctx.taskType) parts.push(`type=${ctx.taskType}`);
  if (ctx.phase) parts.push(`phase=${ctx.phase}`);
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

class LoggerImpl implements Logger {
  private readonly module: string;
  private readonly boundContext: LogContext;

  constructor(module: string, boundContext: LogContext = {}) {
    this.module = module;
    this.boundContext = boundContext;
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

  child(context: LogContext): Logger {
    return new LoggerImpl(this.module, { ...this.boundContext, ...context });
  }

  runWith<T>(context: LogContext, fn: () => T): T {
    return runWithTraceContext({ ...this.boundContext, ...context }, fn);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level < globalMinLevel) return;

    const levelName = LogLevel[level] as StructuredLogEntry['level'];
    const mergedContext = { ...getCurrentTraceContext(), ...this.boundContext };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      Object.assign(mergedContext, data as LogContext);
    }

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      levelValue: level,
      module: this.module,
      message,
      context: mergedContext,
      data,
    };

    const ts = formatTimestamp();
    const color = LEVEL_COLORS[levelName] ?? '';
    const levelPad = levelName.padEnd(5);
    const tags = formatContextTags(mergedContext);
    const consoleMsg = `${ts} ${color}${levelPad}${RESET} ${MODULE_COLOR}[${this.module}]${RESET}${tags} ${message}`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(consoleMsg, data !== undefined ? data : '');
        break;
      case LogLevel.INFO:
        console.info(consoleMsg, data !== undefined ? data : '');
        break;
      case LogLevel.WARN:
        console.warn(consoleMsg, data !== undefined ? data : '');
        break;
      case LogLevel.ERROR:
        console.error(consoleMsg, data !== undefined ? data : '');
        break;
    }

    logSink.push(entry);
  }
}

const loggerCache = new Map<string, Logger>();

export function createLogger(module: string): Logger {
  const cached = loggerCache.get(module);
  if (cached) return cached;
  const logger = new LoggerImpl(module);
  loggerCache.set(module, logger);
  return logger;
}

