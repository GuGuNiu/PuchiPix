
import type { Page } from 'playwright';
import { sleep } from '@/lib/utils/delay';

// 重新导出浏览器配置相关内容和类型，保持向后兼容
export type { BrowserType, Platform, BrowserProfile } from './browser-profiles';
export { BROWSER_PROFILES, USER_AGENTS, randomUA, randomProfile } from './browser-profiles';
export { sleep, randomDelay } from '@/lib/utils/delay';

// 重新导出 Stealth 相关函数
export {
  DEFAULT_ACCEPT_LANGUAGE,
  buildStealthHeaders,
  buildPageHeaders,
  buildAntiCrawlerHeaders,
  getStealthScripts,
  applyStealthToPage,
  createStealthPage,
} from './stealth';

/**
 * 高斯分布随机延迟（反爬虫专用）
 *
 * 生成符合正态分布的随机延迟，比均匀分布更接近人类行为。
 *
 * @param mean - 均值（毫秒）
 * @param stddev - 标准差（毫秒）
 * @returns 随机延迟毫秒数
 */
export function gaussianDelay(mean: number, stddev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + z * stddev));
}

/**
 * 带抖动的指数退避延迟（反爬虫专用）
 *
 * 在标准指数退避基础上添加 ±20% 的随机抖动，避免重试风暴。
 *
 * @param retryCount - 重试次数
 * @param baseDelay - 基础延迟（毫秒，默认 2000）
 * @param maxDelay - 最大延迟（毫秒，默认 16000）
 * @returns 等待的毫秒数
 */
export function backoffDelay(
  retryCount: number,
  baseDelay: number = 2000,
  maxDelay: number = 16000,
): number {
  const raw = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const jitter = raw * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + jitter));
}

/** 翻页间隔范围（毫秒） */
export const PAGE_DELAY_MIN = 800;
export const PAGE_DELAY_MAX = 1500;

/** 批量任务间隔范围（毫秒），用于标题间/图库间防爬 */
export const BATCH_DELAY_MIN = 3000;
export const BATCH_DELAY_MAX = 5000;

/** 单个关键词/URL 最大重试次数 */
export const MAX_RETRIES = 3;

/** 图库最大翻页数（安全上限，防止无限翻页） */
export const MAX_GALLERY_PAGES = 30;

/** 短周期：每批处理数量上限（达到后短休息） */
export const BATCH_SHORT_CYCLE = 5;
/** 短周期休息时间范围（毫秒，10~30 秒随机抖动） */
export const BATCH_SHORT_REST_MIN = 10_000;
export const BATCH_SHORT_REST_MAX = 30_000;

/** 长周期：累计处理数量上限（达到后长休息） */
export const BATCH_LONG_CYCLE = 15;
/** 长周期休息时间范围（毫秒，20~40 分钟随机抖动） */
export const BATCH_LONG_REST_MIN = 20 * 60_000;
export const BATCH_LONG_REST_MAX = 40 * 60_000;

/** 大批量任务间基础间隔范围（毫秒，5~15 秒随机抖动） */
export const BATCH_TASK_DELAY_MIN = 5_000;
export const BATCH_TASK_DELAY_MAX = 15_000;

/** 贝塞尔曲线轨迹 */
export async function humanMouseMove(
  page: Page,
  selector: string,
): Promise<void> {
  try {
    const element = await page.$(selector);
    if (!element) return;

    const box = await element.boundingBox();
    if (!box) return;

    const startX = Math.random() * (box.x + box.width + 200);
    const startY = Math.random() * (box.y + box.height + 200);
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    const steps = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = startX + (targetX - startX) * t + (Math.random() - 0.5) * 20;
      const y = startY + (targetY - startY) * t + (Math.random() - 0.5) * 20;
      await page.mouse.move(x, y);
      await sleep(gaussianDelay(80, 30));
    }
  } catch {
  }
}

export async function humanClick(
  page: Page,
  selector: string,
): Promise<void> {
  await humanMouseMove(page, selector);
  await sleep(gaussianDelay(120, 50));

  const element = await page.$(selector);
  if (element) {
    const box = await element.boundingBox();
    if (box) {
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      await page.mouse.move(x, y);
      await sleep(gaussianDelay(50, 20));
      await page.mouse.down();
      await sleep(gaussianDelay(40, 20));
      await page.mouse.up();
    }
  } else {
    await page.click(selector).catch(() => {});
  }
}

export async function humanWait(): Promise<void> {
  await sleep(gaussianDelay(2000, 800));
}

export async function humanScroll(
  page: Page,
  scrolls: number = 2,
): Promise<void> {
  for (let i = 0; i < scrolls; i++) {
    const deltaY = 100 + Math.floor(Math.random() * 300);
    await page.mouse.wheel(0, deltaY);
    await sleep(gaussianDelay(500, 200));
  }
}
