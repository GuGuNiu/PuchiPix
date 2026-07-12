/**
 * 调试脚本：检查爱妹子图库页面的 ZIP 下载区域结构
 *
 * 用途：
 * 1. 打开图库详情页，检查 .download-section 和 .download-info-box 的完整 HTML
 * 2. 监控网络请求，捕获 eligibility API 的请求和响应
 * 3. 检查 .btn-download 按钮的状态变化
 * 4. 手动调用 eligibility API，查看返回值
 *
 * 使用方式: npx tsx test/debug-zip-extraction.ts [article-url]
 *
 * @date 2026-07-11
 */

import { chromium } from 'playwright';
import { createStealthPage } from '../src/lib/core/anti-crawler';

const TARGET_URL = process.argv[2] || 'https://www.lovecutes.com/article/32238/';
const DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  const { page, context } = await createStealthPage(browser, undefined, DOMAINS[0]);

  // 监听网络请求
  page.on('request', (req) => {
    if (req.url().includes('eligibility') || req.url().includes('download')) {
      console.log(`[NET-REQ] ${req.method()} ${req.url()}`);
    }
  });

  page.on('response', async (resp) => {
    if (resp.url().includes('eligibility') || resp.url().includes('download')) {
      console.log(`[NET-RESP] ${resp.status()} ${resp.url()}`);
      try {
        const body = await resp.text();
        console.log(`[NET-RESP-BODY] ${body.substring(0, 2000)}`);
      } catch {
        console.log('[NET-RESP-BODY] <unable to read>');
      }
    }
  });

  // 依次尝试域名
  for (const domain of DOMAINS) {
    const articleId = TARGET_URL.match(/\/article\/(\d+)/)?.[1] || '32238';
    const url = `${domain}/article/${articleId}/`;

    console.log(`\n========== 尝试域名: ${domain} ==========`);
    console.log(`URL: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const article = await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
      if (!article) {
        console.log('未找到 article 元素，尝试下一个域名');
        continue;
      }

      console.log('页面加载成功，等待 3 秒让 JS 执行...');
      await page.waitForTimeout(3000);

      // 1. 检查 .download-section 的完整 HTML
      console.log('\n--- 1. .download-section HTML ---');
      const sectionHtml = await page.evaluate(() => {
        const section = document.querySelector('.download-section');
        return section ? section.outerHTML.substring(0, 5000) : 'NOT FOUND';
      });
      console.log(sectionHtml);

      // 2. 检查 .download-info-box 的完整 HTML
      console.log('\n--- 2. .download-info-box HTML ---');
      const boxHtml = await page.evaluate(() => {
        const box = document.querySelector('.download-info-box');
        return box ? box.outerHTML.substring(0, 3000) : 'NOT FOUND';
      });
      console.log(boxHtml);

      // 3. 检查 .btn-download 按钮
      console.log('\n--- 3. .btn-download 按钮状态 ---');
      const btnInfo = await page.evaluate(() => {
        const btn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
        if (!btn) return { found: false };

        return {
          found: true,
          tagName: btn.tagName,
          className: btn.className,
          href: btn.getAttribute('href'),
          hrefFull: btn.href,
          dataProvider: btn.getAttribute('data-provider'),
          dataPageId: btn.getAttribute('data-page-id'),
          dataEligibilityUrl: btn.getAttribute('data-eligibility-url'),
          dataLoginUrl: btn.getAttribute('data-login-url'),
          textContent: btn.textContent?.trim().substring(0, 200),
          outerHTML: btn.outerHTML.substring(0, 1000),
        };
      });
      console.log(JSON.stringify(btnInfo, null, 2));

      // 4. 检查所有带 download 相关 class 的元素
      console.log('\n--- 4. 所有 download 相关元素 ---');
      const allDownloadEls = await page.evaluate(() => {
        const els = document.querySelectorAll('[class*="download"], [class*="Download"]');
        return Array.from(els).map((el) => ({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          href: el.getAttribute('href'),
          text: el.textContent?.trim().substring(0, 100),
        }));
      });
      console.log(JSON.stringify(allDownloadEls, null, 2));

      // 5. 等待 is-pending 被移除
      console.log('\n--- 5. 等待 is-pending 移除 ---');
      await page.waitForFunction(() => {
        const btn = document.querySelector('.btn-download');
        if (!btn) return true;
        return !btn.classList.contains('is-pending');
      }, { timeout: 8000 }).catch(() => {
        console.log('is-pending 等待超时');
      });

      // 再次检查按钮
      const btnAfterWait = await page.evaluate(() => {
        const btn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
        if (!btn) return { found: false };
        return {
          found: true,
          className: btn.className,
          href: btn.getAttribute('href'),
          hrefFull: btn.href,
        };
      });
      console.log('等待后按钮状态:', JSON.stringify(btnAfterWait, null, 2));

      // 6. 从 .download-section 提取 data 属性
      console.log('\n--- 6. .download-section data 属性 ---');
      const sectionData = await page.evaluate(() => {
        const section = document.querySelector('.download-section');
        if (!section) return null;
        const attrs: Record<string, string> = {};
        for (const attr of section.attributes) {
          attrs[attr.name] = attr.value;
        }
        return attrs;
      });
      console.log(JSON.stringify(sectionData, null, 2));

      // 7. 手动调用 eligibility API
      console.log('\n--- 7. 手动调用 eligibility API ---');
      const pageId = sectionData?.['data-page-id'] || '';
      const eligibilityUrl = sectionData?.['data-eligibility-url'] || '';

      console.log(`pageId: ${pageId}`);
      console.log(`eligibilityUrl: ${eligibilityUrl}`);

      if (pageId || eligibilityUrl) {
        const apiUrl = eligibilityUrl
          ? eligibilityUrl.startsWith('http')
            ? eligibilityUrl
            : new URL(eligibilityUrl, page.url()).href
          : `/api/download/eligibility?page_id=${pageId}&link_index=0`;

        console.log(`调用 API: ${apiUrl}`);

        const eligResult = await page.evaluate(async (url) => {
          try {
            const resp = await fetch(url, {
              credentials: 'include',
              headers: { 'Accept': 'application/json' },
            });
            const status = resp.status;
            const text = await resp.text();
            return { status, body: text.substring(0, 3000) };
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        }, apiUrl);

        console.log('eligibility API 返回:');
        console.log(JSON.stringify(eligResult, null, 2));

        // 尝试解析 JSON
        if (eligResult.body) {
          try {
            const parsed = JSON.parse(eligResult.body);
            console.log('\n解析后的 JSON:');
            console.log(JSON.stringify(parsed, null, 2));

            if (parsed.resolved_links) {
              console.log(`\nresolved_links: ${JSON.stringify(parsed.resolved_links)}`);
            }
            if (parsed.can_download !== undefined) {
              console.log(`can_download: ${parsed.can_download}`);
            }
          } catch {
            console.log('（非 JSON 响应）');
          }
        }
      } else {
        console.log('未找到 pageId 或 eligibilityUrl');

        // 尝试从页面 URL 提取 article ID
        const articleIdMatch = page.url().match(/\/article\/(\d+)/);
        if (articleIdMatch) {
          const aid = articleIdMatch[1];
          console.log(`从 URL 提取的 article ID: ${aid}`);

          // 尝试多种 API 格式
          const apiUrls = [
            `/api/download/eligibility?page_id=${aid}&link_index=0`,
            `/api/download/eligibility?article_id=${aid}&link_index=0`,
            `/api/download/eligibility?post_id=${aid}&link_index=0`,
          ];

          for (const apiUrl of apiUrls) {
            console.log(`\n尝试: ${apiUrl}`);
            const result = await page.evaluate(async (url) => {
              try {
                const resp = await fetch(url, { credentials: 'include' });
                return { status: resp.status, body: await resp.text() };
              } catch (err) {
                return { error: String(err) };
              }
            }, apiUrl);
            console.log(JSON.stringify(result, null, 2));
          }
        }
      }

      // 8. 检查页面中的 script 标签，寻找下载相关逻辑
      console.log('\n--- 8. 页面中的下载相关 script ---');
      const scriptInfo = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script');
        const relevant: string[] = [];
        scripts.forEach((s) => {
          const content = s.textContent || '';
          if (
            content.includes('eligibility') ||
            content.includes('download') ||
            content.includes('btn-download') ||
            content.includes('resolved_links')
          ) {
            relevant.push(content.substring(0, 2000));
          }
        });
        return relevant;
      });
      console.log(`找到 ${scriptInfo.length} 个相关 script 标签`);
      scriptInfo.forEach((s, i) => {
        console.log(`\nScript ${i + 1}:`);
        console.log(s);
      });

      break;
    } catch (err) {
      console.log(`域名 ${domain} 失败:`, err instanceof Error ? err.message : err);
    }
  }

  await page.close().catch(() => {});
  await context.close().catch(() => {});
  await browser.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
