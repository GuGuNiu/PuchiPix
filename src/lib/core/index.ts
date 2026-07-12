/**
 * 模块：核心基础设施
 *
 * 统一导出六个基础设施模块：
 * - LifecycleManager：应用生命周期管理（启动 → 就绪 → 优雅关闭）
 * - TTLQueueLock：带 TTL 自动过期的队列锁
 * - EventBus：全类型安全的发布/订阅广播站
 * - AntiCrawler：反爬虫防御工具 v2.0（100 UA 轮换、浏览器指纹模拟、Stealth 注入、高斯延迟）
 * - BrowserPool：共享 Playwright 浏览器实例池
 * - RouteStatePersist：路由级状态持久化
 *
 * @author PuchiPix Team
 * @date 2026-07-09
 * @lastModified 2026-07-11
 */

export { lifecycle } from './lifecycle';
export type { LifecyclePhase, LifecycleHook, LifecycleStatus } from './lifecycle';

export { ttlLock } from './ttl-lock';
export type { LockHandle, AcquireOptions } from './ttl-lock';

export { eventBus } from './event-bus';
export type { EventMap, EventHandler, EventSubscription } from './event-bus';

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
