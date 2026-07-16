import type { Page } from 'playwright';

/**
 * 导航到下一页
 *
 * 翻页策略（按优先级排序）：
 * - WordPress 搜索 URL（?s=keyword）用路径方式翻页 /page/N/?s=keyword
 *   （部分站点不支持 ?paged=N 参数，所以统一用路径方式翻页）
 * - 路径方式翻页（/tag/xxx/page/2/）支持首次翻页（/tag/xxx/ → /tag/xxx/page/2/）
 * - 通用分页按钮（CSS 选择器 + 点击 / URL 拼接）
 */
export async function goToNextPage(page: Page, pageNum: number): Promise<boolean> {
  const currentUrl = page.url();
  const parsed = new URL(currentUrl);

  // WordPress 搜索：不支持 ?paged=N 参数（已测试），统一使用路径方式翻页
  if (parsed.searchParams.has('s')) {
    parsed.searchParams.delete('paged');
    const searchParams = parsed.searchParams.toString();
    const nextUrl = `${parsed.origin}/page/${pageNum}/${searchParams ? '?' + searchParams : ''}`;
    console.log(`[goToNextPage] WordPress 路径翻页: ${currentUrl} → ${nextUrl}`);
    try {
      const response = await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`[goToNextPage] 跳转响应状态: ${response?.status()}, 当前URL: ${page.url()}`);

      await page.waitForSelector('article', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);

      if (page.url() === currentUrl) {
        console.log(`[goToNextPage] URL 未变化，翻页失败`);
        return false;
      }

      const hasArticles = await page.locator('article').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasArticles) {
        console.log(`[goToNextPage] 页面无 article 元素，可能已到最后一页`);
        return false;
      }

      console.log(`[goToNextPage] WordPress 路径翻页成功`);
      return true;
    } catch (err) {
      console.log(`[goToNextPage] WordPress 路径翻页失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  const path = parsed.pathname.replace(/\/$/, '');

  if (/\/page\/\d+\/?$/.test(path)) {
    const nextPath = path.replace(/\/page\/\d+\/?$/, `/page/${pageNum}/`);
    const nextUrl = `${parsed.origin}${nextPath}${parsed.search}`;
    console.log(`[goToNextPage] 路径翻页(替换): ${currentUrl} → ${nextUrl}`);
    try {
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);
      if (page.url() === currentUrl) return false;
      return true;
    } catch {
      return false;
    }
  }

  // 排除首页和文章页的路径翻页
  if (pageNum > 1 && !path.includes('/article/') && path !== '' && path !== '/') {
    const nextUrl = `${parsed.origin}${path}/page/${pageNum}/${parsed.search}`;
    console.log(`[goToNextPage] 路径翻页(追加): ${currentUrl} → ${nextUrl}`);
    try {
      const response = await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (response?.status() === 404) {
        console.log(`[goToNextPage] 路径翻页 404，已到最后一页`);
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
    console.log(`[goToNextPage] 无分页器，最后一页`);
    return false;
  }

  // 尝试点击分页按钮
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
    // E-Hentai 下一页选择器
    `a#dnext`,
  ];

  for (const sel of nextSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`[goToNextPage] 尝试选择器: ${sel}`);
        await el.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(800);
        if (page.url() === currentUrl) {
          console.log(`[goToNextPage] 点击后 URL 未变化，尝试下一个选择器`);
          continue;
        }
        return true;
      }
    } catch {
    }
  }

  // 通用 URL 翻页尝试
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
