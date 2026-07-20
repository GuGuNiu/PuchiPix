import { AsyncLocalStorage } from 'node:async_hooks';
import { getOrCreateGlobal } from './global-singleton';
import { logSink } from './log-sink';
import { logT as translateLog, type TranslationKey } from '@/lib/i18n/server';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
}

export interface LogContext {
  traceId?: string;
  /** DAG instance ID */
  dagId?: string;
  /** DAG Node ID */
  nodeId?: string;
  /** Tasktype */
  taskType?: string;
  /** Phase */
  phase?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: keyof typeof LogLevel;
  levelValue: number;
  module: string;
  message: string;
  context: LogContext;
  data?: unknown;
  i18nKey?: string;
  i18nParams?: Record<string, string | number>;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface TraceContext {
  traceId: string;
  dagId?: string;
  nodeId?: string;
  taskType?: string;
  phase?: string;
  [key: string]: unknown;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();


function generateTraceId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  ).slice(0, 16);
}

/**
 *
 * @example
 * logger.runWithTrace({ dagId: 'gallery-123', nodeId: 'scrape' }, async () => {
 *   logger.info('Recognition started');
 *   await doWork();
 *   logger.info('Recognition completed');
 * });
 */
function runWithTrace<T>(
  context: Partial<TraceContext>,
  fn: () => T,
): T {
  const current = traceStorage.getStore();
  const merged: TraceContext = {
    traceId: current?.traceId ?? generateTraceId(),
    ...current,
    ...context,
  };
  // Ensure traceId exist
  if (!merged.traceId) {
    merged.traceId = generateTraceId();
  }
  return traceStorage.run(merged, fn);
}

function getCurrentTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}


function currentTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Environmentconfig
 * ─────────────────────────────────────────────────────────────────────────────
 */

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return LogLevel.INFO;
  const upper = value.toUpperCase();
  if (upper === 'DEBUG') return LogLevel.DEBUG;
  if (upper === 'INFO') return LogLevel.INFO;
  if (upper === 'WARN' || upper === 'WARNING') return LogLevel.WARN;
  if (upper === 'ERROR') return LogLevel.ERROR;
  const num = parseInt(value, 10);
  if (!isNaN(num)) {
    if (num <= LogLevel.DEBUG) return LogLevel.DEBUG;
    if (num <= LogLevel.INFO) return LogLevel.INFO;
    if (num <= LogLevel.WARN) return LogLevel.WARN;
    return LogLevel.ERROR;
  }
  return LogLevel.INFO;
}

const isDev = process.env.NODE_ENV !== 'production';
const minLevel = parseLogLevel(process.env.LOG_LEVEL);

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * OutputFormat
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LEVEL_LABEL: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: ' INFO',
  [LogLevel.WARN]: ' WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: COLOR.dim,
  [LogLevel.INFO]: COLOR.green,
  [LogLevel.WARN]: COLOR.yellow,
  [LogLevel.ERROR]: COLOR.red,
};

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}


function formatDev(entry: StructuredLogEntry): string {
  const ts = formatTimestamp(new Date(entry.timestamp));
  const lv = entry.levelValue as LogLevel;
  const levelStr = `${LEVEL_COLOR[lv]}${LEVEL_LABEL[lv]}${COLOR.reset}`;
  const moduleStr = `${COLOR.cyan}[${entry.module}]${COLOR.reset}`;

  const ctxParts: string[] = [];
  if (entry.context.traceId) {
    ctxParts.push(`${COLOR.magenta}trace=${entry.context.traceId}${COLOR.reset}`);
  }
  if (entry.context.dagId) {
    ctxParts.push(`${COLOR.blue}dag=${entry.context.dagId}${COLOR.reset}`);
  }
  if (entry.context.nodeId) {
    ctxParts.push(`${COLOR.blue}node=${entry.context.nodeId}${COLOR.reset}`);
  }
  if (entry.context.taskType) {
    ctxParts.push(`${COLOR.gray}type=${entry.context.taskType}${COLOR.reset}`);
  }
  if (entry.context.phase) {
    ctxParts.push(`${COLOR.gray}phase=${entry.context.phase}${COLOR.reset}`);
  }
  for (const [key, value] of Object.entries(entry.context)) {
    if (['traceId', 'dagId', 'nodeId', 'taskType', 'phase'].includes(key)) continue;
    if (value === undefined || value === null) continue;
    ctxParts.push(`${COLOR.gray}${key}=${typeof value === 'object' ? JSON.stringify(value) : value}${COLOR.reset}`);
  }

  const ctxStr = ctxParts.length > 0 ? ` ${ctxParts.join(' ')}` : '';
  let dataStr = '';
  if (entry.data !== undefined) {
    if (entry.data instanceof Error) {
      dataStr = `\n  ${COLOR.red}${entry.data.stack ?? entry.data.message}${COLOR.reset}`;
    } else if (typeof entry.data === 'object' && entry.data !== null) {
      dataStr = `\n  ${COLOR.gray}${JSON.stringify(entry.data, null, 2).replace(/\n/g, '\n  ')}${COLOR.reset}`;
    } else {
      dataStr = ` ${COLOR.gray}${String(entry.data)}${COLOR.reset}`;
    }
  }

  return `${COLOR.dim}${ts}${COLOR.reset} ${levelStr} ${moduleStr} ${entry.message}${ctxStr}${dataStr}`;
}


function formatJson(entry: StructuredLogEntry): string {
  const record: Record<string, unknown> = {
    timestamp: entry.timestamp,
    level: entry.level,
    module: entry.module,
    message: entry.message,
  };

  if (entry.context.traceId) record.traceId = entry.context.traceId;
  if (entry.context.dagId) record.dagId = entry.context.dagId;
  if (entry.context.nodeId) record.nodeId = entry.context.nodeId;
  if (entry.context.taskType) record.taskType = entry.context.taskType;
  if (entry.context.phase) record.phase = entry.context.phase;
  for (const [key, value] of Object.entries(entry.context)) {
    if (['traceId', 'dagId', 'nodeId', 'taskType', 'phase'].includes(key)) continue;
    if (value !== undefined && value !== null) record[key] = value;
  }

  if (entry.i18nKey) record.i18nKey = entry.i18nKey;
  if (entry.i18nParams) record.i18nParams = entry.i18nParams;

  if (entry.data !== undefined) {
    if (entry.data instanceof Error) {
      record.error = {
        name: entry.data.name,
        message: entry.data.message,
        stack: entry.data.stack,
      };
    } else {
      record.data = entry.data;
    }
  }

  return JSON.stringify(record);
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Logger core
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class Logger {
  private readonly module: string;
  private readonly boundContext: LogContext;

  constructor(module: string, boundContext: LogContext = {}) {
    this.module = module;
    this.boundContext = boundContext;
  }

  
  child(context: LogContext): Logger {
    return new Logger(this.module, { ...this.boundContext, ...context });
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

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * 
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   *
   *
   * @example
   * logger.infoT('log.taskQueue.slotAllocated', { key: 'xxx', normal: 1 });
   */
  infoT(key: TranslationKey, params?: Record<string, string | number>, data?: unknown): void {
    this.logWithI18nKey(LogLevel.INFO, key, params, data);
  }

  warnT(key: TranslationKey, params?: Record<string, string | number>, data?: unknown): void {
    this.logWithI18nKey(LogLevel.WARN, key, params, data);
  }

  errorT(key: TranslationKey, params?: Record<string, string | number>, data?: unknown): void {
    this.logWithI18nKey(LogLevel.ERROR, key, params, data);
  }

  debugT(key: TranslationKey, params?: Record<string, string | number>, data?: unknown): void {
    this.logWithI18nKey(LogLevel.DEBUG, key, params, data);
  }

  
  private logWithI18nKey(
    level: LogLevel,
    key: TranslationKey,
    params: Record<string, string | number> | undefined,
    data: unknown,
  ): void {
    const message = translateLog(key, params);
    this.logWithI18n(level, message, data, key, params);
  }

  
  private logWithI18n(
    level: LogLevel,
    message: string,
    data: unknown,
    i18nKey: string,
    i18nParams: Record<string, string | number> | undefined,
  ): void {
    if (level < minLevel) return;

    const store = getCurrentTraceContext();
    const context: LogContext = { ...this.boundContext };
    if (store) {
      if (store.traceId) context.traceId = store.traceId;
      if (store.dagId) context.dagId = store.dagId;
      if (store.nodeId) context.nodeId = store.nodeId;
      if (store.taskType) context.taskType = store.taskType;
      if (store.phase) context.phase = store.phase;
      for (const [key, value] of Object.entries(store)) {
        if (['traceId', 'dagId', 'nodeId', 'taskType', 'phase'].includes(key)) continue;
        if (value !== undefined && value !== null) context[key] = value;
      }
    }

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_LABEL[level].trim() as keyof typeof LogLevel,
      levelValue: level,
      module: this.module,
      message,
      context,
      data,
      i18nKey,
      i18nParams,
    };

    const output = isDev ? formatDev(entry) : formatJson(entry);

    if (level >= LogLevel.ERROR) {
      console.error(output);
    } else if (level >= LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }

    logSink.push(entry);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level < minLevel) return;

    const store = getCurrentTraceContext();
    const context: LogContext = {
      ...this.boundContext,
    };
    if (store) {
      if (store.traceId) context.traceId = store.traceId;
      if (store.dagId) context.dagId = store.dagId;
      if (store.nodeId) context.nodeId = store.nodeId;
      if (store.taskType) context.taskType = store.taskType;
      if (store.phase) context.phase = store.phase;
      for (const [key, value] of Object.entries(store)) {
        if (['traceId', 'dagId', 'nodeId', 'taskType', 'phase'].includes(key)) continue;
        if (value !== undefined && value !== null) context[key] = value;
      }
    }

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_LABEL[level].trim() as keyof typeof LogLevel,
      levelValue: level,
      module: this.module,
      message,
      context,
      data,
    };

    const output = isDev ? formatDev(entry) : formatJson(entry);

    if (level >= LogLevel.ERROR) {
      console.error(output);
    } else if (level >= LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }

    logSink.push(entry);
  }

  
  runWith<T>(context: LogContext, fn: () => T): T {
    return runWithTrace(
      { ...this.boundContext, ...context } as TraceContext,
      fn,
    );
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

class LoggerRegistry {
  private loggers = new Map<string, Logger>();

  /**
   *
   * @example
   * const logger = createLogger('Scheduler');
   *   logger.info('Node enqueued', { nodeId: 'scrape-1' });
   */
  get(module: string, context?: LogContext): Logger {
    if (context && Object.keys(context).length > 0) {
      return new Logger(module, context);
    }
    let logger = this.loggers.get(module);
    if (!logger) {
      logger = new Logger(module);
      this.loggers.set(module, logger);
    }
    return logger;
  }

  
  listModules(): string[] {
    return Array.from(this.loggers.keys());
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * GlobalSingletonExport
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const loggerRegistry = getOrCreateGlobal(
  '__puchipix_logger_registry__',
  () => new LoggerRegistry(),
);

/**
 *
 *
 * @example
 * const logger = createLogger('Scheduler');
 * logger.info('Node enqueued', { nodeId: 'scrape-1' });
 *
 * const dagLogger = createLogger('DAG', { dagId: 'gallery-123' });
 *
 * logger.runWithTrace({ dagId: 'gallery-1', nodeId: 'scrape' }, async () => {
 *   logger.info('Recognition started'); // traceId auto-generated and propagated
 *   await scrape();
 *   logger.info('Recognition completed');
 * });
 */
export function createLogger(module: string, context?: LogContext): Logger {
  return loggerRegistry.get(module, context);
}


export function runWithTraceContext<T>(
  context: LogContext,
  fn: () => T,
): T {
  return runWithTrace(context as TraceContext, fn);
}


export function getTraceId(): string | undefined {
  return currentTraceId();
}


export function getTraceContext(): Readonly<TraceContext> | undefined {
  const store = getCurrentTraceContext();
  return store ? { ...store } : undefined;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const loggers = {
  scheduler: (): Logger => createLogger('Scheduler'),
  dagOrchestrator: (): Logger => createLogger('DagOrchestrator'),
  eventStore: (): Logger => createLogger('EventStore'),
  eventBus: (): Logger => createLogger('EventBus'),
  slotPool: (): Logger => createLogger('SlotPool'),
  sse: (): Logger => createLogger('SSE'),
  websocket: (): Logger => createLogger('WebSocket'),
  server: (): Logger => createLogger('Server'),
  cli: (): Logger => createLogger('CLI'),
  taskQueue: (): Logger => createLogger('TaskQueue'),
  lifecycle: (): Logger => createLogger('Lifecycle'),
  orchestrator: (): Logger => createLogger('Orchestrator'),
  dagInit: (): Logger => createLogger('DAGInit'),
  dagConfig: (): Logger => createLogger('DAGConfig'),
  browserPool: (): Logger => createLogger('BrowserPool'),
  domainHealth: (): Logger => createLogger('DomainHealth'),
  seedData: (): Logger => createLogger('SeedData'),
  schedulerStrategy: (): Logger => createLogger('SchedulerStrategy'),
  taskStateReset: (): Logger => createLogger('TaskStateReset'),
  slotTypeRegistry: (): Logger => createLogger('SlotTypeRegistry'),
  taskStateMachine: (): Logger => createLogger('TaskStateMachine'),
  taskExecutor: (): Logger => createLogger('TaskExecutor'),
  seqAllocator: (): Logger => createLogger('SeqAllocator'),
  schedulingStrategy: (): Logger => createLogger('SchedulingStrategy'),
  ouoOrchestrator: (): Logger => createLogger('OuoOrchestrator'),
  batchScheduler: (): Logger => createLogger('BatchScheduler'),
  galleryScrapeExecutor: (): Logger => createLogger('GalleryScrapeExecutor'),
  galleryHandler: (): Logger => createLogger('GalleryHandler'),
  galleryDownloader: (): Logger => createLogger('GalleryDownloader'),
  downloadManager: (): Logger => createLogger('DownloadManager'),
  zipDownloader: (): Logger => createLogger('ZipDownloader'),
  urlResolver: (): Logger => createLogger('UrlResolver'),
  archiveExtractor: (): Logger => createLogger('ArchiveExtractor'),
  parallelDownloader: (): Logger => createLogger('ParallelDownloader'),
  chunkDownloader: (): Logger => createLogger('ChunkDownloader'),
  m3u8Downloader: (): Logger => createLogger('M3u8Downloader'),
  fileDownload: (): Logger => createLogger('FileDownload'),
  coverDownloader: (): Logger => createLogger('CoverDownloader'),
  segmentDownloader: (): Logger => createLogger('SegmentDownloader'),
  segmentQueue: (): Logger => createLogger('SegmentQueue'),
  searchEngine: (): Logger => createLogger('SearchEngine'),
  searchPagination: (): Logger => createLogger('SearchPagination'),
  batchSearch: (): Logger => createLogger('BatchSearch'),
  protagonistService: (): Logger => createLogger('ProtagonistService'),
  personManager: (): Logger => createLogger('PersonManager'),
  adaptiveExtractor: (): Logger => createLogger('AdaptiveExtractor'),
  characterDB: (): Logger => createLogger('CharacterDB'),
  charDBScheduler: (): Logger => createLogger('CharDBScheduler'),
  bwikiCrawler: (): Logger => createLogger('BwikiCrawler'),
  aliasLibrary: (): Logger => createLogger('AliasLibrary'),
  safeDelete: (): Logger => createLogger('SafeDelete'),
  siteRegistry: (): Logger => createLogger('SiteRegistry'),
  siteAccountManager: (): Logger => createLogger('SiteAccountManager'),
  aimeiziziProvider: (): Logger => createLogger('AimeiziziProvider'),
  scrapeGallery: (): Logger => createLogger('ScrapeGallery'),
  scrapeGalleryHttp: (): Logger => createLogger('ScrapeGalleryHttp'),
  pageEvaluators: (): Logger => createLogger('PageEvaluators'),
  sjsProvider: (): Logger => createLogger('SjsProvider'),
  sjsAuth: (): Logger => createLogger('SjsAuth'),
  sjsActions: (): Logger => createLogger('SjsActions'),
  sjsCheckin: (): Logger => createLogger('SjsCheckin'),
  exhentaiProvider: (): Logger => createLogger('ExhentaiProvider'),
  pageExtractors: (): Logger => createLogger('PageExtractors'),
  universalProvider: (): Logger => createLogger('UniversalProvider'),
  baseProvider: (): Logger => createLogger('BaseProvider'),
  galleryAPI: (): Logger => createLogger('GalleryAPI'),
  tasksAPI: (): Logger => createLogger('TasksAPI'),
  searchAPI: (): Logger => createLogger('SearchAPI'),
  accountsAPI: (): Logger => createLogger('AccountsAPI'),
  logsAPI: (): Logger => createLogger('LogsAPI'),
  sjsAPI: (): Logger => createLogger('SjsAPI'),
  previewAPI: (): Logger => createLogger('PreviewAPI'),
  scrapeHelper: (): Logger => createLogger('ScrapeHelper'),
};
