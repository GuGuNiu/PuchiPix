import type { Browser, Page, Route } from 'playwright';
import { chromium } from 'playwright';
import type { SniffStatus, CapturedURL } from '@/types';

export class Sniffer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private running: boolean = false;
  private targetURL: string = '';
  private capturedURLs: CapturedURL[] = [];
  private startTime: string = '';

  async start(url: string): Promise<void> {
    if (this.running) {
      throw new Error('Sniffer is already running');
    }

    this.targetURL = url;
    this.capturedURLs = [];
    this.startTime = new Date().toISOString();
    this.running = true;

    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();

    await this.page.route('**/*', (route: Route) => {
      const reqUrl = route.request().url();

      if (reqUrl.includes('.m3u8') || reqUrl.includes('.m3u')) {
        const fileName = reqUrl.split('/').pop()?.split('?')[0] || 'unknown.m3u8';
        this.capturedURLs.push({
          url: reqUrl,
          type: 'm3u8',
          timestamp: new Date().toISOString(),
          page_url: this.targetURL,
          filename: fileName,
        });
      }

      route.continue();
    });

    this.page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] || '';
        const lower = contentType.toLowerCase();

        if (
          lower.includes('mpegurl') ||
          lower.includes('vnd.apple.mpegurl') ||
          lower.includes('application/x-mpegurl')
        ) {
          const reqUrl = response.url();
          const fileName = reqUrl.split('/').pop()?.split('?')[0] || 'unknown.m3u8';
          const exists = this.capturedURLs.some((u) => u.url === reqUrl);
          if (!exists) {
            this.capturedURLs.push({
              url: reqUrl,
              type: 'm3u8',
              timestamp: new Date().toISOString(),
              page_url: this.targetURL,
              filename: fileName,
            });
          }
        }
      } catch {
      }
    });

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch {
    }
  }

  getStatus(): SniffStatus {
    return {
      running: this.running,
      target_url: this.targetURL,
      captured: this.capturedURLs.length,
      start_time: this.startTime,
    };
  }

  getCapturedURLs(): CapturedURL[] {
    return [...this.capturedURLs];
  }

  getM3U8URLs(): CapturedURL[] {
    return this.capturedURLs.filter((u) => u.type === 'm3u8');
  }
}

const SNIFFER_KEY = '__snifferInstance__';

export function getSniffer(): Sniffer {
  const g = globalThis as Record<string, unknown>;
  if (!g[SNIFFER_KEY]) {
    g[SNIFFER_KEY] = new Sniffer();
  }
  return g[SNIFFER_KEY] as Sniffer;
}