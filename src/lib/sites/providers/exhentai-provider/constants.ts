import { decodeHtmlEntities } from "@/lib/utils";

/** 表站基础 URL */
export const BASE_E_URL = "https://e-hentai.org";
/** 里站基础 URL */
export const BASE_EX_URL = "https://exhentai.org";

/** 站点域名列表 */
export const SITE_DOMAINS = [BASE_E_URL, BASE_EX_URL];

/** 每批图片页请求数（防止 IP 限速） */
export const IMAGE_BATCH_SIZE = 4;

/** 图片页请求超时（毫秒） */
export const IMAGE_FETCH_TIMEOUT = 15000;

/** 每页缩略图数量（E-Hentai 默认 Compact 模式 40 个） */
export const THUMBS_PER_PAGE = 40;

/**
 * E-Hentai 分类标签位掩码映射。
 *
 * f_cats 参数为"禁用分类"的位掩码：1023 - sum(启用分类的标签值)。
 */
export const CATEGORY_LABELS: Record<string, number> = {
  Doujinshi: 2,
  Manga: 4,
  ArtistCG: 8,
  GameCG: 16,
  Western: 512,
  NonH: 256,
  ImageSet: 32,
  Cosplay: 64,
  AsianPorn: 128,
  Misc: 1,
};

/** 分类 ID → 名称映射 */
export const CATEGORY_NAMES: Record<number, string> = {
  1: "Doujinshi",
  2: "Manga",
  3: "ArtistCG",
  4: "GameCG",
  5: "Western",
  6: "NonH",
  7: "ImageSet",
  8: "Cosplay",
  9: "AsianPorn",
  10: "Misc",
};

/**
 * 从环境变量获取 exhentai Cookie。
 */
export function getExhentaiCookies(): Record<string, string> | null {
  const ipbMemberId = process.env.EXHENTAI_IPB_MEMBER_ID;
  const ipbPassHash = process.env.EXHENTAI_IPB_PASS_HASH;
  const igneous = process.env.EXHENTAI_IGNEOUS;

  if (!ipbMemberId || !ipbPassHash) {
    return null;
  }

  const cookies: Record<string, string> = {
    ipb_member_id: ipbMemberId,
    ipb_pass_hash: ipbPassHash,
  };

  if (igneous) {
    cookies.igneous = igneous;
  }

  return cookies;
}

/**
 * 判断 URL 是否为里站（exhentai.org）。
 */
export function isExUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "exhentai.org";
  } catch {
    return false;
  }
}

/**
 * 从图库 URL 中提取图库 ID。
 *
 * https://e-hentai.org/g/12345/abcdef/ → "12345"
 */
export function extractGalleryId(url: string): string | null {
  const match = url.match(/\/g\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 * 将任意域名 URL 归一化为表站 URL。
 *
 * exhentai.org → e-hentai.org
 */
export function normalizeToEhentai(url: string): string {
  return url.replace(/https?:\/\/exhentai\.org/, BASE_E_URL);
}

/**
 * 判断 URL 是否属于 E-Hentai / ExHentai。
 */
export function matchesExhentaiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "e-hentai.org" ||
      hostname === "exhentai.org" ||
      hostname.endsWith(".e-hentai.org") ||
      hostname.endsWith(".exhentai.org")
    );
  } catch {
    return false;
  }
}

/**
 * 清洗原始标题。
 */
export function cleanExhentaiTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  let title = rawTitle.trim();
  title = decodeHtmlEntities(title);
  return title.trim();
}

/**
 * 判断 URL 是否为列表页。
 */
export function isExhentaiListingPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return !parsed.pathname.startsWith("/g/");
  } catch {
    return false;
  }
}
