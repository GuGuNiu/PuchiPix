﻿﻿﻿import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { randomProfile, getStealthScripts, buildPageHeaders, DEFAULT_ACCEPT_LANGUAGE } from './anti-crawler';
import type { BrowserProfile } from './browser-profiles';
import { loggers } from '../infra/logger';

const logger = loggers.browserPool();

const BROWSER_KEY = '__sharedBrowserInstance__';


const STEALTH_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--password-store=basic',
  '--use-mock-keychain',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
];

export async function getSharedBrowser(): Promise<Browser> {
  const g = globalThis as Record<string, unknown>;
  let browser = g[BROWSER_KEY] as Browser | null;

  if (!browser || !browser.isConnected()) {
    const headlessEnv = process.env.STEALTH_HEADLESS;
    const headless: boolean =
      headlessEnv === 'false' || headlessEnv === '0' ? false : true;

    browser = await chromium.launch({
      headless,
      channel: 'chrome',
      args: STEALTH_ARGS,
    });
    g[BROWSER_KEY] = browser;
  }

  return browser;
}

export async function closeSharedBrowser(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const browser = g[BROWSER_KEY] as Browser | null;
  if (browser) {
    await browser.close().catch(() => {});
    g[BROWSER_KEY] = null;
  }
}


interface PooledContext {
  context: BrowserContext;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

interface PendingAcquire {
  resolve: (result: { page: Page; context: BrowserContext; profile: BrowserProfile }) => void;
  reject: (err: Error) => void;
}

class BrowserContextPool {
  private static readonly MAX_CONTEXTS = 2;
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  private static readonly MAX_REUSE_COUNT = 20;

  private idlePool: PooledContext[] = [];
  private activeCount = 0;
  private pendingQueue: PendingAcquire[] = [];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60_000);
    if (this.cleanupTimer && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as ReturnType<typeof setInterval>).unref?.();
    }
  }

  /** / ** / * / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  / 
 / 
 / */
  async acquire(
    browser: Browser,
    profile?: BrowserProfile,
    referer?: string,
  ): Promise<{ page: Page; context: BrowserContext; profile: BrowserProfile }> {
    const p = profile ?? randomProfile();

    while (this.idlePool.length > 0) {
      const pooled = this.idlePool.pop()!;
      try {
        const page = await pooled.context.newPage();
        pooled.lastUsedAt = Date.now();
        pooled.useCount++;
        this.activeCount++;
        return { page, context: pooled.context, profile: p };
      } catch {
        await pooled.context.close().catch(() => {});
      }
    }

    if (this.activeCount < BrowserContextPool.MAX_CONTEXTS) {
      const context = await this.createContext(browser, p, referer);
      const page = await context.newPage();
      this.activeCount++;
      return { page, context, profile: p };
    }

    logger.info(`Context pool full (${this.activeCount}/${BrowserContextPool.MAX_CONTEXTS}), queuing...`);
    return new Promise<{ page: Page; context: BrowserContext; profile: BrowserProfile }>((resolve, reject) => {
      this.pendingQueue.push({ resolve, reject });
    });
  }

  /** / ** / * / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  / 
 / 
 / */
  async release(context: BrowserContext, page: Page): Promise<void> {
    // Closecurrent Page
    await page.close().catch(() => {});

    this.activeCount = Math.max(0, this.activeCount - 1);

    try {
      // SimpleVerify Context yesnoavailable
      const contexts = context.browser()?.contexts();
      if (!contexts || !contexts.includes(context)) {
        await context.close().catch(() => {});
        this.wakeNext();
        return;
      }

      this.idlePool.push({
        context,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 0,
      });
    } catch {
      await context.close().catch(() => {});
    }

    this.wakeNext();
  }

  /** / * / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  /  / *  / 
 / 
 / */
  private async wakeNext(): Promise<void> {
    if (this.pendingQueue.length === 0) return;
    if (this.activeCount >= BrowserContextPool.MAX_CONTEXTS) return;

    const pending = this.pendingQueue.shift()!;
    const browser = await this.getBrowser();
    if (!browser) {
      pending.reject(new Error('Browser instance unavailable'));
      return;
    }

    try {
      const result = await this.acquire(browser);
      pending.resolve(result);
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async createContext(
    browser: Browser,
    profile: BrowserProfile,
    referer?: string,
  ): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: profile.ua,
      viewport: profile.viewport,
      extraHTTPHeaders: buildPageHeaders(profile, referer),
      locale: 'zh-CN',
    });
    return context;
  }

  private async cleanupIdle(): Promise<void> {
    const now = Date.now();
    const cutoff = now - BrowserContextPool.IDLE_TIMEOUT_MS;

    const toRemove: BrowserContext[] = [];
    this.idlePool = this.idlePool.filter((pooled) => {
      if (pooled.lastUsedAt < cutoff) {
        toRemove.push(pooled.context);
        return false;
      }
      return true;
    });

    for (const ctx of toRemove) {
      await ctx.close().catch(() => {});
    }

    if (toRemove.length > 0) {
      logger.info(`Cleaned ${toRemove.length} idle contexts`);
    }
  }

  private async getBrowser(): Promise<Browser | null> {
    const g = globalThis as Record<string, unknown>;
    const browser = g[BROWSER_KEY] as Browser | null;
    if (!browser || !browser.isConnected()) return null;
    return browser;
  }

  getStats(): { active: number; idle: number; pending: number; max: number } {
    return {
      active: this.activeCount,
      idle: this.idlePool.length,
      pending: this.pendingQueue.length,
      max: BrowserContextPool.MAX_CONTEXTS,
    };
  }

  async closeAll(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const pending of this.pendingQueue) {
      pending.reject(new Error('Context pool closed'));
    }
    this.pendingQueue = [];

    // CloseallIdle Context
    for (const pooled of this.idlePool) {
      await pooled.context.close().catch(() => {});
    }
    this.idlePool = [];
    this.activeCount = 0;
  }
}

export const browserContextPool = getOrCreateGlobal(
  '__puchipix_browser_context_pool__',
  () => new BrowserContextPool(),
);
