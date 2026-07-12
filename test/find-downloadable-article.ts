/**
 * 查找可匿名下载的图库文章
 *
 * 时间门控策略：新发布的图包需要登录或等待 N 天后才能匿名下载。
 * 本脚本尝试多个文章 ID，找到 time_gate 已开放的文章。
 *
 * 使用方式: npx tsx test/find-downloadable-article.ts
 *
 * @date 2026-07-11
 */

import { chromium } from 'playwright';
import { createStealthPage } from '../src/lib/core/anti-crawler';

const DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

// 尝试的文章 ID 范围（从最近的往回找）
const ARTICLE_IDS = [
  32200, 32100, 32000, 31900, 31800, 31700, 31600, 31500, 31400, 31300,
  31200, 31100, 31000, 30900, 30800, 30700, 30600, 30500,
];

async function tryArticle(
  browser: import('playwright').Browser,
  articleId: number,
): Promise<void> {
  const { page, context } = await createStealthPage(browser, undefined, DOMAINS[0]);

  try {
    // 随机选域名
    const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
    const url = `${domain}/article/${articleId}/`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const article = await page.waitForSelector('article', { timeout: 8000 }).catch(() => null);
    if (!article) {
      console.log(`[${articleId}] 页面无 article，跳过`);
      return;
    }

    // 检查是否有 download-section
    const hasDownloadSection = await page.evaluate(() => {
      return !!document.querySelector('.download-section');
    });

    if (!hasDownloadSection) {
      console.log(`[${articleId}] 无 download-section，跳过`);
      return;
    }

    // 提取 data 属性
    const sectionData = await page.evaluate(() => {
      const section = document.querySelector('.download-section');
      if (!section) return null;
      return {
        pageId: section.getAttribute('data-page-id') || '',
        eligibilityUrl: section.getAttribute('data-eligibility-url') || '',
        nextUrl: section.getAttribute('data-next-url') || '',
        loginUrl: section.getAttribute('data-login-url') || '',
      };
    });

    if (!sectionData || !sectionData.pageId) {
      console.log(`[${articleId}] download-section 无 data-page-id，跳过`);
      return;
    }

    // 等待 JS 执行
    await page.waitForTimeout(2000);

    // 检查按钮状态
    const btnState = await page.evaluate(() => {
      const btn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
      if (!btn) return { found: false };
      return {
        found: true,
        className: btn.className,
        href: btn.getAttribute('href'),
        dataCanDownload: btn.getAttribute('data-can-download'),
      };
    });

    // 调用 eligibility API（包含 next 参数）
    const apiUrl = `${sectionData.eligibilityUrl || '/api/download/eligibility'}?page_id=${sectionData.pageId}&next=${encodeURIComponent(sectionData.nextUrl || `/article/${articleId}/`)}`;

    const eligResult = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        const text = await resp.text();
        return { status: resp.status, body: text };
      } catch (err) {
        return { error: String(err) };
      }
    }, apiUrl);

    let eligParsed: any = null;
    try {
      eligParsed = JSON.parse(eligResult.body || '{}');
    } catch {}

    const canDownload = eligParsed?.can_download;
    const resolvedLinks = eligParsed?.resolved_links || [];
    const timeGate = eligParsed?.time_gate_opens;
    const blockReason = eligParsed?.block_reason;

    console.log(
      `[${articleId}] can_download=${canDownload}, ` +
      `resolved_links=${resolvedLinks.length}, ` +
      `time_gate=${timeGate}, ` +
      `block_reason=${blockReason}, ` +
      `btn_class=${btnState.found ? btnState.className : 'N/A'}, ` +
      `btn_href=${btnState.found ? btnState.href?.substring(0, 80) : 'N/A'}`,
    );

    if (canDownload && resolvedLinks.length > 0) {
      console.log(`  >>> 找到可下载文章! resolved_links: ${JSON.stringify(resolvedLinks)}`);
      console.log(`  >>> URL: ${url}`);

      // 输出完整信息
      console.log(`  >>> 完整 eligibility 响应: ${eligResult.body?.substring(0, 1000)}`);

      // 检查按钮是否已更新
      const btnAfter = await page.evaluate(() => {
        const btn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
        if (!btn) return null;
        return {
          className: btn.className,
          href: btn.getAttribute('href'),
          hrefFull: btn.href,
        };
      });
      console.log(`  >>> 按钮状态: ${JSON.stringify(btnAfter)}`);
    }
  } catch (err) {
    console.log(`[${articleId}] 错误: ${err instanceof Error ? err.message : err}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  console.log(`测试 ${ARTICLE_IDS.length} 个文章 ID...\n`);

  for (const articleId of ARTICLE_IDS) {
    await tryArticle(browser, articleId);
    // 随机延迟避免限流
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000));
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
