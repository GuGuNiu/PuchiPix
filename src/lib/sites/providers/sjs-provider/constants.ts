﻿import { decodeHtmlEntities, replaceDomain } from "@/lib/utils";
import { removePublisherPrefix } from "@/lib/utils/title-cleaner";

export const SITE_DOMAINS = [
  "https://xsijishe.ink",
  "https://sjs96.com",
  "https://sjs66.com",
  "https://sjs47.com",
  "https://sjs47.net",
  "https://sjslt.cc",
  "https://xsijishe.net",
];

export const PRIMARY_DOMAIN = "https://xsijishe.ink";

export const DISCUZ_COOKIE_PREFIX = "SgL6_2132_";

export const PLACEHOLDER_GIF = "/static/image/common/none.gif";

/**
 *
 * Thread-707390-1-1.html → "707390"
 * forum.php?mod=viewthread&tid=707390 → "707390"
 */
export function extractThreadId(url: string): string | null {
  const match1 = url.match(/thread-(\d+)-\d+-\d+\.html/);
  if (match1) return match1[1];

  const match2 = url.match(/[?&]tid=(\d+)/);
  if (match2) return match2[1];

  return null;
}

/**
 *
 * Forum-2-1.html → "2"
 */
export function extractForumId(url: string): string | null {
  const match = url.match(/forum-(\d+)-\d+\.html/);
  return match ? match[1] : null;
}

/**
 *
 * Sjs47.com/thread-xxx → sjs66.com/thread-xxx
 */
export function normalizeSjsUrl(url: string): string {
  const tidMatch = url.match(/[?&]tid=(\d+)/);
  if (tidMatch) {
    const fidMatch = url.match(/[?&]fid=(\d+)/);
    const fid = fidMatch ? fidMatch[1] : "1";
    return `${PRIMARY_DOMAIN}/thread-${tidMatch[1]}-1-${fid}.html`;
  }

  return replaceDomain(url, PRIMARY_DOMAIN);
}


export function matchesSjsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "sjs66.com" ||
      hostname === "www.sjs66.com" ||
      hostname === "sjs47.com" ||
      hostname === "www.sjs47.com" ||
      hostname === "sjs47.net" ||
      hostname === "www.sjs47.net" ||
      hostname === "sjslt.cc" ||
      hostname === "www.sjslt.cc" ||
      hostname === "xsijishe.net" ||
      hostname === "www.xsijishe.net" ||
      hostname.endsWith(".sjs66.com") ||
      hostname.endsWith(".sjs47.com") ||
      hostname.endsWith(".sjs47.net") ||
      hostname.endsWith(".sjslt.cc") ||
      hostname.endsWith(".xsijishe.net")
    );
  } catch {
    return false;
  }
}


export function isListingPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const query = parsed.searchParams;

    if (path.match(/thread-\d+-\d+-\d+\.html/)) return false;
    if (query.get("mod") === "viewthread") return false;

    return true;
  } catch {
    return false;
  }
}


export function cleanSjsTitle(rawTitle: string): string {
  if (!rawTitle) return "";

  let title = rawTitle.trim();

  title = removePublisherPrefix(title);

  title = title.replace(/\s*-\s*司机社\s*-\s*求出处.*$/i, "");
  title = title.replace(/\s*-\s*司机社.*$/i, "");

  title = title.replace(
    /\s*-\s*(视图写真|飙车场|求出处|国产视频|欧美视频|日本AV|网黄博主资源|VR视频|AI合成视频|图生视频|2D动漫|3D动漫|本子|PC游戏|手机游戏|悬赏区|色情文学|闲聊|GIF出处)\s*$/i,
    "",
  );

  title = decodeHtmlEntities(title);

  return title.trim();
}
