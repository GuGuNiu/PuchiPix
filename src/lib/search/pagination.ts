﻿import type { Page } from 'playwright';

export async function goToNextPage(page: Page, pageNum: number): Promise<boolean> {
  const currentUrl = page.url();
  const parsed = new URL(currentUrl);

  if (parsed.searchParams.has('s')) {
    parsed.searchParams.delete('paged');
    const searchParams = parsed.searchParams.toString();
    const nextUrl = `${parsed.origin}/page/${pageNum}/${searchParams ? '?' + searchParams : ''}`;
    console.log(`[goToNextPage] WordPress path pagination: ${currentUrl} → ${nextUrl}`);
    try {
      const response = await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`[goToNextPage] Navigation response status: ${response?.status()}, current URL: ${page.url()}`);

      await page.waitForSelector('article', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);

      if (page.url() === currentUrl) {
        console.log(`[goToNextPage] URL unchanged, pagination failed`);
        return false;
      }

      const hasArticles = await page.locator('article').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasArticles) {
        console.log(`[goToNextPage] No article elements on page, may have reached the last page`);
        return false;
      }

      console.log(`[goToNextPage] WordPress path pagination succeeded`);
      return true;
    } catch (err) {
      console.log(`[goToNextPage] WordPress path pagination failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  const path = parsed.pathname.replace(/\/$/, '');

  if (/\/page\/\d+\/?$/.test(path)) {
    const nextPath = path.replace(/\/page\/\d+\/?$/, `/page/${pageNum}/`);
    const nextUrl = `${parsed.origin}${nextPath}${parsed.search}`;
    console.log(`[goToNextPage] Path pagination (replace): ${currentUrl} → ${nextUrl}`);
    try {
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);
      if (page.url() === currentUrl) return false;
      return true;
    } catch {
      return false;
    }
  }

  if (pageNum > 1 && !path.includes('/article/') && path !== '' && path !== '/') {
    const nextUrl = `${parsed.origin}${path}/page/${pageNum}/${parsed.search}`;
    console.log(`[goToNextPage] Path pagination (append): ${currentUrl} → ${nextUrl}`);
    try {
      const response = await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (response?.status() === 404) {
        console.log(`[goToNextPage] Path pagination 404, reached last page`);
        return false;
      }
      await page.waitForTimeout(800);
      if (page.url() === currentUrl) return false;
      return true;
    } catch {
      return false;
    }
  }

  const hasPagination = await page.locator(
    '.pagination, .pagenavi, .mac_pages, .pages, .page-box, .nav-links, nav[aria-label="Pagination"], .page-navigator'
  ).first().isVisible({ timeout: 1000 }).catch(() => false);

  if (!hasPagination) {
    console.log(`[goToNextPage] No paginator, last page`);
    return false;
  }

  const nextSelectors = [
    `.pagination a:has-text("${pageNum}")`,
    `.pagenavi a:has-text("${pageNum}")`,
    `a[onclick*="page"][onclick*="${pageNum}"]`,
    `.mac_pages a:has-text("${pageNum}")`,
    `a[href*="page=${pageNum}"]`,
    `a[href*="paged=${pageNum}"]`,
    `.pagination a.next`,
    `a:has-text("下一页")`,
    `a:has-text("Next")`,
    `.mac_pages a.next`,
    `a.next.page-numbers`,
    `nav[aria-label="Pagination"] a[rel="next"]`,
    `.nav-links a.next`,
    `a#dnext`,
  ];

  for (const sel of nextSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`[goToNextPage] Trying selector: ${sel}`);
        await el.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(800);
        if (page.url() === currentUrl) {
          console.log(`[goToNextPage] URL unchanged after click, trying next selector`);
          continue;
        }
        return true;
      }
    } catch {
    }
  }

  try {
    if (currentUrl.includes('page=')) {
      const nextUrl = currentUrl.replace(/page=\d+/, `page=${pageNum}`);
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);
      return page.url() !== currentUrl;
    }

    const nextUrl = `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}page=${pageNum}`;
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(800);
    return page.url() !== currentUrl;
  } catch {
    return false;
  }
}
