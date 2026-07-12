/**
 * 轻量级视频预览 API
 *
 * 双策略获取 m3u8 URL：
 * 1. 快速路径：Node 原生 fetch 获取页面 HTML，正则提取 player_aaaa 中的 m3u8 URL（<1 秒）
 * 2. 回退路径：fetch 失败时（如 Cloudflare 拦截），使用 Playwright 浏览器爬取（~8 秒）
 *
 * POST /api/preview
 * @param url - 视频页面 URL
 * @returns m3u8_url - 提取到的 m3u8 URL
 *
 * @date 2026-07-09
 * @lastModified 2026-07-10
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 从 HTML 文本中提取 m3u8 URL
 *
 * 提取顺序：
 * 1. player_aaaa JSON 中的 url 字段（MacCMS 标准）
 * 2. 正则匹配所有 .m3u8 URL
 *
 * @date 2026-07-09
 */
function extractM3U8FromHtml(html: string): string | null {
  // 1. 尝试从 player_aaaa 变量中提取
  const playerMatch = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*[;<]/);
  if (playerMatch) {
    try {
      const playerData = JSON.parse(playerMatch[1]);
      if (playerData.url && typeof playerData.url === 'string') {
        const url = playerData.url.trim();
        if (url.includes('.m3u8') || url.includes('.m3u')) {
          return url;
        }
        try {
          const decoded = decodeURIComponent(url);
          if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
            return decoded;
          }
        } catch {}
        try {
          const decoded = Buffer.from(url, 'base64').toString('utf-8');
          if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
            return decoded;
          }
        } catch {}
      }
    } catch {}
  }

  // 2. 正则扫描所有 m3u8 URL
  const m3u8Matches = html.match(/https?:\/\/[^\s"'<>)\\]+\.m3u8[^\s"'<>)\\]*/gi);
  if (m3u8Matches && m3u8Matches.length > 0) {
    const excludePatterns = ['ad', 'stat', 'analytics', 'tracker', 'beacon'];
    const filtered = m3u8Matches.filter((url) => {
      const lower = url.toLowerCase();
      return !excludePatterns.some((p) => lower.includes(p));
    });
    if (filtered.length > 0) {
      return filtered[0];
    }
    return m3u8Matches[0];
  }

  return null;
}

/**
 * 使用 Playwright 爬虫获取 m3u8 URL（回退方案）
 *
 * 当目标站点使用 Cloudflare 等防护导致 fetch 失败时，
 * 通过真实浏览器绕过 TLS 指纹检测。
 *
 * @date 2026-07-10
 */
async function scrapeM3U8WithPlaywright(url: string): Promise<string | null> {
  const { getScraper } = await import('@/lib/scraper/scraper');
  const scraper = getScraper();
  const result = await scraper.scrape(url, 20000);
  return result.m3u8_url || null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // ============================================================
    // 策略 1：快速 fetch 获取 HTML
    // ============================================================
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const m3u8Url = extractM3U8FromHtml(html);
        if (m3u8Url) {
          return NextResponse.json({ m3u8_url: m3u8Url });
        }
        // HTML 中未找到 m3u8，继续尝试 Playwright
      }
      // res 非 200 或未提取到 m3u8，继续回退
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      // fetch 失败（ECONNRESET / 超时 / DNS 错误等），继续回退到 Playwright
      console.log(`[Preview] fetch 失败${isAbort ? '（超时）' : ''}，回退到 Playwright: ${url}`);
    }

    // ============================================================
    // 策略 2：Playwright 浏览器爬取（绕过 Cloudflare）
    // ============================================================
    try {
      const m3u8Url = await scrapeM3U8WithPlaywright(url);
      if (m3u8Url) {
        return NextResponse.json({ m3u8_url: m3u8Url });
      }
      return NextResponse.json(
        { error: 'No m3u8 URL found' },
        { status: 404 }
      );
    } catch (scrapeErr) {
      const message = scrapeErr instanceof Error ? scrapeErr.message : 'Scrape failed';
      console.error(`[Preview] Playwright 爬取也失败: ${url} — ${message}`);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
