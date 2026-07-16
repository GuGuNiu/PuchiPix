import type { Page, BrowserContext } from "playwright";
import type { ExtendedMetadata, SiteSearchResult } from "../../types";
import {
  BASE_E_URL,
  BASE_EX_URL,
  IMAGE_BATCH_SIZE,
  IMAGE_FETCH_TIMEOUT,
  THUMBS_PER_PAGE,
  getExhentaiCookies,
  cleanExhentaiTitle,
} from "./constants";
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from "@/lib/core/anti-crawler";
import { logT } from "@/lib/i18n/server";

/**
 * 设置浏览器上下文 Cookie。
 */
export async function setupExhentaiBrowserContext(context: BrowserContext): Promise<void> {
  const cookies = getExhentaiCookies();
  if (!cookies) return;

  const cookieList = Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: ".exhentai.org",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  }));

  cookieList.push(
    ...Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      domain: ".e-hentai.org",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    })),
  );

  await context.addCookies(cookieList);
}

/**
 * 从搜索结果页面提取图库链接列表。
 */
export async function extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
  return page.evaluate(() => {
    const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seen = new Set<string>();

    const rows = document.querySelectorAll(
      'table.itg.gltc > tbody > tr:not(:first-child):not(:has(td.itd[colspan="4"]))',
    );

    const extendedRows = document.querySelectorAll(
      "table.itg:not(.gltc) > tbody > tr:not(:first-child)",
    );

    const allRows = [...rows, ...extendedRows];

    for (const row of allRows) {
      try {
        const linkEl = row.querySelector("td.gl3c.glname a") as HTMLAnchorElement;
        if (!linkEl) continue;

        const href = linkEl.href;
        if (!href || !href.includes("/g/") || seen.has(href)) continue;
        seen.add(href);

        const titleEl = row.querySelector("td.gl3c.glname a div.glink") as HTMLElement;
        const title = titleEl?.textContent?.trim() || linkEl.textContent?.trim() || "";

        const coverImg = row.querySelector("td.gl2c img") as HTMLImageElement;
        const coverUrl =
          coverImg?.getAttribute("data-src") || coverImg?.getAttribute("src") || undefined;

        const postedEl = row.querySelector('div[id^="posted_"]') as HTMLElement;
        const dateText = postedEl?.textContent?.trim() || "";
        let date: string | undefined;
        if (dateText) {
          const match = dateText.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) {
            date = match[1];
          }
        }

        results.push({ url: href, title, coverUrl, date });
      } catch {}
    }

    return results.slice(0, 50);
  });
}

/**
 * 从图库详情页提取扩展元信息。
 */
export async function extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
  const raw = await page.evaluate(() => {
    const titleEl = document.querySelector("#gn") as HTMLElement;
    const h1Title = titleEl?.textContent?.trim() || document.title || "";

    const uploaderEl = document.querySelector("#gdn a") as HTMLElement;
    const uploader = uploaderEl?.textContent?.trim() || "";

    const infoRows = document.querySelectorAll("#gdd table tbody > tr");
    let language = "";
    let pages = 0;
    let posted = "";
    let fileSize = "";

    infoRows.forEach((row) => {
      const label = row.querySelector("td.gdt1")?.textContent?.trim() || "";
      const value = row.querySelector("td.gdt2")?.textContent?.trim() || "";

      if (label.includes("Language")) {
        language = value;
      } else if (label.includes("Length") || label.includes("Pages")) {
        const m = value.match(/(\d+)/);
        if (m) pages = parseInt(m[1]);
      } else if (label.includes("Posted")) {
        posted = value;
      } else if (label.includes("File Size")) {
        fileSize = value;
      }
    });

    const ratingEl = document.querySelector("#gdr #rating_label") as HTMLElement;
    const ratingText = ratingEl?.textContent?.trim() || "";
    const ratingMatch = ratingText.match(/Average:\s*([\d.]+)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    const tags: Record<string, string[]> = {};
    const tagRows = document.querySelectorAll("#taglist table tbody > tr");
    tagRows.forEach((row) => {
      const keyEl = row.querySelector("td.tc") as HTMLElement;
      const key = keyEl?.textContent?.trim().replace(/:$/, "") || "";
      const valueEls = row.querySelectorAll("td > div > a");
      const values: string[] = [];
      valueEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text) values.push(text);
      });
      if (key && values.length > 0) {
        tags[key] = values;
      }
    });

    const coverEl = document.querySelector("#gd1 img, #gdc img") as HTMLImageElement;
    const coverUrl =
      coverEl?.getAttribute("data-src") || coverEl?.getAttribute("src") || "";

    const categoryEl = document.querySelector(
      "#gdc .cs, .cs.ct1, .cs.ct2, .cs.ct3",
    ) as HTMLElement;
    const category = categoryEl?.textContent?.trim() || "";

    return {
      h1Title,
      uploader,
      language,
      pages,
      posted,
      fileSize,
      rating,
      tags,
      coverUrl,
      category,
      documentTitle: document.title,
    };
  });

  const title = cleanExhentaiTitle(raw.h1Title || raw.documentTitle);

  const flatTags: string[] = [];
  for (const [ns, labels] of Object.entries(raw.tags)) {
    for (const label of labels) {
      flatTags.push(`${ns}:${label}`);
    }
  }

  const parodies = raw.tags["parody"] || raw.tags["group"] || [];
  const characters = raw.tags["character"] || [];
  const actors = [...parodies, ...characters];

  return {
    title,
    tags: flatTags,
    actors,
    categories: raw.category ? [raw.category] : [],
    director: raw.uploader,
    series: [],
    blocked: false,
  };
}

/**
 * 从图库详情页提取画廊基本信息。
 */
export async function extractGalleryInfo(
  page: Page,
): Promise<{ pages: number; posted: string; coverUrl: string; uploader: string; category: string }> {
  return page.evaluate(() => {
    const lengthRow = Array.from(document.querySelectorAll("#gdd table tbody > tr")).find(
      (row) =>
        row.querySelector("td.gdt1")?.textContent?.includes("Length") ||
        row.querySelector("td.gdt1")?.textContent?.includes("Pages"),
    );
    const lengthText = lengthRow?.querySelector("td.gdt2")?.textContent?.trim() || "";
    const pagesMatch = lengthText.match(/(\d+)/);
    const pages = pagesMatch ? parseInt(pagesMatch[1]) : 0;

    const postedRow = Array.from(document.querySelectorAll("#gdd table tbody > tr")).find(
      (row) => row.querySelector("td.gdt1")?.textContent?.includes("Posted"),
    );
    const postedText = postedRow?.querySelector("td.gdt2")?.textContent?.trim() || "";
    const postedMatch = postedText.match(/(\d{4}-\d{2}-\d{2})/);
    const posted = postedMatch ? postedMatch[1] : "";

    const coverEl = document.querySelector("#gd1 img, #gdc img") as HTMLImageElement;
    const coverUrl = coverEl?.getAttribute("data-src") || coverEl?.getAttribute("src") || "";

    const uploaderEl = document.querySelector("#gdn a") as HTMLElement;
    const uploader = uploaderEl?.textContent?.trim() || "";

    const categoryEl = document.querySelector("#gdc .cs, .cs") as HTMLElement;
    const category = categoryEl?.textContent?.trim() || "";

    return { pages, posted, coverUrl, uploader, category };
  });
}

/**
 * 收集图库所有页面的图片页链接。
 */
export async function collectImagePageLinks(
  page: Page,
  galleryUrl: string,
  totalImages: number,
): Promise<string[]> {
  const allLinks: string[] = [];
  const seenLinks = new Set<string>();

  const galleryPages = Math.min(
    Math.ceil(totalImages / THUMBS_PER_PAGE) || 1,
    MAX_GALLERY_PAGES,
  );

  for (let pageNum = 0; pageNum < galleryPages; pageNum++) {
    if (pageNum > 0) {
      const pageUrl = `${galleryUrl.replace(/\/$/, "")}/?p=${pageNum}`;
      await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));

      try {
        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      } catch (err) {
        console.error(logT("log.exhentai.scrapePageFailed", { page: pageNum }), err);
        break;
      }
    }

    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll("#gdt a");
      return Array.from(anchors).map((a) => (a as HTMLAnchorElement).href);
    });

    let newCount = 0;
    for (const link of links) {
      if (link && !seenLinks.has(link)) {
        seenLinks.add(link);
        allLinks.push(link);
        newCount++;
      }
    }

    console.log(
      logT("log.exhentai.pageNewLinks", { page: pageNum + 1, count: newCount, total: allLinks.length }),
    );

    if (newCount === 0) break;
  }

  return allLinks;
}

/**
 * 批量从图片页提取实际图片 URL。
 */
export async function fetchImageUrls(
  page: Page,
  imagePageUrls: string[],
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(imagePageUrls.length).fill(null);

  for (let i = 0; i < imagePageUrls.length; i += IMAGE_BATCH_SIZE) {
    const batch = imagePageUrls.slice(i, i + IMAGE_BATCH_SIZE);
    const batchIndices = batch.map((_, j) => i + j);

    try {
      const batchResults = await page.evaluate(
        async ({ urls, timeout }: { urls: string[]; timeout: number }) => {
          const results: (string | null)[] = [];

          for (const url of urls) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), timeout);

              const resp = await fetch(url, {
                signal: controller.signal,
                credentials: "include",
              });
              clearTimeout(timeoutId);

              if (!resp.ok) {
                results.push(null);
                continue;
              }

              const html = await resp.text();
              const match = html.match(/<img[^>]+id="img"[^>]+src="([^"]+)"/);
              results.push(match ? match[1] : null);
            } catch {
              results.push(null);
            }
          }

          return results;
        },
        { urls: batch, timeout: IMAGE_FETCH_TIMEOUT },
      );

      batchResults.forEach((url, j) => {
        results[batchIndices[j]] = url;
      });
    } catch (err) {
      console.error(logT("log.exhentai.batchFailed", { batch: i }), err);
    }

    if (i + IMAGE_BATCH_SIZE < imagePageUrls.length) {
      await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
    }

    const successCount = results.filter(Boolean).length;
    console.log(
      `[ExHentai] 图片 URL 获取进度: ${Math.min(i + IMAGE_BATCH_SIZE, imagePageUrls.length)}/${imagePageUrls.length}（成功 ${successCount}）`,
    );
  }

  return results;
}
