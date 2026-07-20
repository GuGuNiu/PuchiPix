export { lifecycle } from './lifecycle';
export type { LifecyclePhase, LifecycleHook, LifecycleStatus } from './lifecycle';

export { ttlLock, LockAcquisitionError } from './ttl-lock';
export type { LockHandle, AcquireOptions, LockStats } from './ttl-lock';

export { eventBus } from './event-bus';
export type { EventMap, EventHandler, EventSubscription } from './event-bus';

export { eventStore } from './event-store';

export { getOrCreateGlobal, getGlobalIfExists, removeGlobal, registerHotDispose } from './global-singleton';

export { getNetworkMonitor } from './network-monitor';

export { useRouteState } from './route-state';
export type { RouteStateEntry, RouteStateConfig } from './route-state';

export { seedPresetData } from './seed-preset-data';

export { requestWithRetry, checkWaf } from './http-client';
export type { RequestWithRetryOptions, RequestResult } from './http-client';

export {
  createLogger,
  loggerRegistry,
  runWithTraceContext,
  getTraceId,
  getTraceContext,
  LogLevel,
  loggers,
} from './logger';
export type { Logger, LogContext, StructuredLogEntry } from './logger';

export { logSink } from './log-sink';
export type { LogQueryFilter, LogSinkListener, LogSinkStats } from './log-sink';
