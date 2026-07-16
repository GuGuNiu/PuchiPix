export { lifecycle } from './lifecycle';
export type { LifecyclePhase, LifecycleHook, LifecycleStatus } from './lifecycle';

export { ttlLock, LockAcquisitionError } from './ttl-lock';
export type { LockHandle, AcquireOptions, LockStats } from './ttl-lock';

export { eventBus } from './event-bus';
export type { EventMap, EventHandler, EventSubscription } from './event-bus';

export { getOrCreateGlobal, getGlobalIfExists, removeGlobal } from './global-singleton';

export { SchedulerStrategy } from './scheduler-strategy';
export type { SchedulerStrategyOptions } from './scheduler-strategy';

export { OrchestratorBase } from './orchestrator-base';
export type { BaseTask, BaseTaskStatus, OrchestratorConfig, OrchestratorStatus } from './orchestrator-base';

export { routeState, useRouteState } from './route-state';
export type { RouteStateEntry, RouteStateConfig } from './route-state';

export {
  USER_AGENTS,
  BROWSER_PROFILES,
  randomUA,
  randomProfile,
  sleep,
  randomDelay,
  gaussianDelay,
  backoffDelay,
  buildAntiCrawlerHeaders,
  buildStealthHeaders,
  buildPageHeaders,
  getStealthScripts,
  applyStealthToPage,
  createStealthPage,
  DEFAULT_ACCEPT_LANGUAGE,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  BATCH_DELAY_MIN,
  BATCH_DELAY_MAX,
  MAX_RETRIES,
  MAX_GALLERY_PAGES,
} from './anti-crawler';
export type { BrowserType, Platform, BrowserProfile } from './anti-crawler';

export { getSharedBrowser, closeSharedBrowser } from './browser-pool';

export {
  getOuoOrchestrator,
} from './ouo-orchestrator';
export type {
  OuoTask,
  OuoTaskStatus,
  OuoOrchestratorStatus,
} from './ouo-orchestrator';

export { BatchScheduler } from './batch-scheduler';
export type { BatchSchedulerOptions } from './batch-scheduler';

export { DomainHealthTracker, shuffleDomainList, getGlobalDomainHealthTracker } from './domain-health-tracker';

export {
  PinyinService,
  getPinyinService,
  resetPinyinService,
  PinyinProAdapter,
  LevenshteinCalculator,
  JaroWinklerCalculator,
  BigramCalculator,
  CombinedCalculator,
  createSimilarityCalculator,
} from './pinyin-service';
export type {
  PinyinConvertOptions,
  PinyinMatchOptions,
  SimilarityOptions,
  SimilarityAlgorithm,
  PinyinVariants,
  PinyinMatchResult,
  PinyinServiceConfig,
  PinyinEngine,
  SimilarityCalculator,
} from './pinyin-service';
