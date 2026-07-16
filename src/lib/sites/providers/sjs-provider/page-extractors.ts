import type { Page } from "playwright";
import type { ExtendedMetadata, SiteSearchResult } from "../../types";
import { cleanSjsTitle, extractForumId, PLACEHOLDER_GIF } from "./constants";

/**
 * 从搜索结果页面提取帖子链接列表。
 */
export async function extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
  return page.evaluate(() => {
    const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seen = new Set<string>();

    const items = document.querySelectorAll("li.nexwateritems");

    items.forEach((item) => {
      const link = item.querySelector('a[href*="mod=viewthread&tid="]') as HTMLAnchorElement;
      if (!link) return;

      const tidMatch = link.href.match(/tid=(\d+)/);
      if (!tidMatch) return;
      const tid = tidMatch[1];

      const url = `${window.location.origin}/thread-${tid}-1-1.html`;
      if (seen.has(tid)) return;
      seen.add(tid);

      let title = link.textContent?.trim() || "";
      if (!title) {
        const h3 = item.querySelector("h3 a, h3");
        title = h3?.textContent?.trim() || "";
      }

      let date: string | undefined;
      const allText = item.textContent || "";
      const dateMatch = allText.match(
        /(\d{4}-\d{1,2}-\d{1,2}|\d+分钟前|\d+小时前|昨天|前天|\d+天前)/,
      );
      if (dateMatch) {
        date = dateMatch[1];
      }

      results.push({ url, title, date });
    });

    return results.slice(0, 30);
  });
}

/**
 * 从帖子详情页提取扩展元信息。
 */
export async function extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
  const raw = await page.evaluate(() => {
    const titleEl = document.querySelector("#thread_subject");
    const title = titleEl?.textContent?.trim() || document.title || "";

    const firstPost = document.querySelector('#postlist div[id^="post_"]');
    const authorEl = firstPost?.querySelector(".authi a, .pi .authi a");
    const author = authorEl?.textContent?.trim() || "";

    const dateEl = firstPost?.querySelector(".authi em, .pti .authi em");
    const dateText = dateEl?.textContent?.trim() || "";
    let date = "";
    const dateMatch = dateText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
    if (dateMatch) {
      date = dateMatch[1];
    } else {
      const relMatch = dateText.match(/发表于\s*(.+)/);
      if (relMatch) {
        date = relMatch[1];
      }
    }

    let category = "";
    const breadcrumbLinks = document.querySelectorAll(".z a, #ct .z a");
    if (breadcrumbLinks.length >= 2) {
      category = breadcrumbLinks[breadcrumbLinks.length - 1]?.textContent?.trim() || "";
    }

    const tags: string[] = [];
    document.querySelectorAll(".ptg a, .ptg mbk a").forEach((a) => {
      const text = a.textContent?.trim();
      if (text && text.length < 30) tags.push(text);
    });

    const metaKeywords = document.querySelector('meta[name="keywords"]');
    const keywordStr = metaKeywords?.getAttribute("content") || "";

    let coverUrl = "";
    const contentEl = firstPost?.querySelector(".t_f");
    if (contentEl) {
      const imgs = contentEl.querySelectorAll("img");
      for (const img of imgs) {
        const file = img.getAttribute("file") || "";
        const src = img.getAttribute("src") || "";
        const url = file || src;
        if (
          url &&
          !url.includes("/static/image/common/none.gif") &&
          !url.startsWith("data:")
        ) {
          coverUrl = url;
          break;
        }
      }
    }

    return {
      title,
      author,
      date,
      category,
      tags,
      keywordStr,
      coverUrl,
      documentTitle: document.title,
    };
  });

  const title = cleanSjsTitle(raw.title || raw.documentTitle);

  const metaKeywords = raw.keywordStr
    .split(/[,，;；]/)
    .map((t) => t.trim())
    .filter((t) => t && t.length < 50 && !raw.tags.includes(t));

  return {
    title,
    tags: [...raw.tags, ...metaKeywords],
    actors: raw.author ? [raw.author] : [],
    categories: raw.category ? [raw.category] : [],
    director: raw.author,
    series: [],
    blocked: false,
  };
}

/**
 * 从帖子页面提取图片、视频和封面信息。
 */
export async function extractPostContent(
  page: Page,
  pageIndex: number,
): Promise<{
  images: { url: string; pageIndex: number }[];
  videos: string[];
  coverUrl: string;
  publishTime: string;
}> {
  return page.evaluate(
    ({ pageIndex, placeholderGif }) => {
      const images: { url: string; pageIndex: number }[] = [];
      const videos: string[] = [];
      let coverUrl = "";
      let publishTime = "";

      const firstPost = document.querySelector('#postlist div[id^="post_"]');
      if (!firstPost) {
        return { images, videos, coverUrl, publishTime };
      }

      const contentEl = firstPost.querySelector(".t_f");
      if (!contentEl) {
        return { images, videos, coverUrl, publishTime };
      }

      const imgs = contentEl.querySelectorAll("img");
      imgs.forEach((img) => {
        const file = img.getAttribute("file") || "";
        const src = img.getAttribute("src") || "";

        let url = file;
        if (!url || url.includes(placeholderGif)) {
          url = src;
        }

        if (
          url &&
          !url.includes(placeholderGif) &&
          !url.startsWith("data:") &&
          !url.includes("/static/image/common/")
        ) {
          images.push({ url, pageIndex });
          if (!coverUrl) {
            coverUrl = url;
          }
        }
      });

      contentEl
        .querySelectorAll("video source, video, embed, iframe")
        .forEach((el) => {
          const src =
            el.getAttribute("src") || el.getAttribute("data-src") || "";
          if (src && (src.includes(".mp4") || src.includes(".m3u8") || src.includes(".flv"))) {
            videos.push(src);
          }
        });

      contentEl.querySelectorAll("a").forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (href && (href.includes(".mp4") || href.includes(".m3u8"))) {
          videos.push(href);
        }
      });

      const dateEl = firstPost.querySelector(".authi em, .pti .authi em");
      const dateText = dateEl?.textContent?.trim() || "";
      const dateMatch = dateText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      if (dateMatch) {
        publishTime = dateMatch[1];
      }

      return { images, videos, coverUrl, publishTime };
    },
    { pageIndex, placeholderGif: PLACEHOLDER_GIF },
  );
}

/**
 * 获取帖子总页数。
 */
export async function getThreadTotalPages(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pageLinks = document.querySelectorAll(".pg a, .pgs a");
    let maxPage = 1;

    pageLinks.forEach((a) => {
      const text = a.textContent?.trim() || "";
      const num = parseInt(text);
      if (!isNaN(num) && num > maxPage) {
        maxPage = num;
      }
    });

    const lastSpan = document.querySelector(".pg .last span, .pgs .last span");
    if (lastSpan) {
      const text = lastSpan.textContent?.trim() || "";
      const num = parseInt(text);
      if (!isNaN(num) && num > maxPage) {
        maxPage = num;
      }
    }

    const pageInput = document.querySelector(
      ".pg label input, .pgs label input",
    ) as HTMLInputElement;
    if (pageInput) {
      const title = pageInput.getAttribute("title") || "";
      const match = title.match(/(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxPage) {
          maxPage = num;
        }
      }
    }

    return maxPage;
  });
}

/**
 * 从版块列表页提取帖子链接。
 */
export async function extractForumListResults(page: Page): Promise<SiteSearchResult[]> {
  return page.evaluate(() => {
    const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seen = new Set<string>();

    const threadContainers = document.querySelectorAll(
      '#threadlisttableid > div[id^="normalthread_"], #threadlisttableid > div[id^="stickthread_"]',
    );

    threadContainers.forEach((container) => {
      const titleLink = container.querySelector("a.s.xst") as HTMLAnchorElement;
      if (!titleLink) return;

      const href = titleLink.href;
      if (!href || seen.has(href)) return;
      seen.add(href);

      const title = titleLink.textContent?.trim() || "";

      const containerText = container.textContent || "";
      const dateMatch = containerText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      const date = dateMatch ? dateMatch[1] : undefined;

      results.push({ url: href, title, date });
    });

    return results.slice(0, 50);
  });
}

/**
 * 获取下一页 URL。
 */
export async function getNextPageUrl(
  page: Page,
  currentUrl: string,
  currentPage: number,
  baseUrl: string,
): Promise<string | null> {
  const nextLink = await page.evaluate((cp) => {
    const pgLinks = document.querySelectorAll(".pg a, .pgs a");
    for (const link of pgLinks) {
      const text = link.textContent?.trim() || "";
      if (text === "下一页" || text === "Next" || text === "›" || text === "»") {
        return (link as HTMLAnchorElement).href;
      }
    }
    const nextNum = String(cp + 1);
    for (const link of pgLinks) {
      const text = link.textContent?.trim() || "";
      if (text === nextNum) {
        return (link as HTMLAnchorElement).href;
      }
    }
    return null;
  }, currentPage);

  if (nextLink) return nextLink;

  const isSearchPage =
    currentUrl.includes("search.php") || currentUrl.includes("searchid=");
  if (!isSearchPage) {
    const forumId = extractForumId(currentUrl);
    if (forumId) {
      return `${baseUrl}/forum-${forumId}-${currentPage + 1}.html`;
    }
  }

  return null;
}
