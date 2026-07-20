import { decodeHtmlEntities } from "@/lib/utils";

export const BASE_E_URL = "https://e-hentai.org";
export const BASE_EX_URL = "https://exhentai.org";

export const SITE_DOMAINS = [BASE_E_URL, BASE_EX_URL];

export const IMAGE_BATCH_SIZE = 4;

export const IMAGE_FETCH_TIMEOUT = 15000;

export const THUMBS_PER_PAGE = 40;


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
 * FromenvironmentvariableGet exhentai cookie。
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

export function isExUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "exhentai.org";
  } catch {
    return false;
  }
}

/**
 *
 * https://e-hentai.org/g/12345/abcdef/ → "12345"
 */
export function extractGalleryId(url: string): string | null {
  const match = url.match(/\/g\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 *
 * Exhentai.org → e-hentai.org
 */
export function normalizeToEhentai(url: string): string {
  return url.replace(/https?:\/\/exhentai\.org/, BASE_E_URL);
}


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


export function cleanExhentaiTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  let title = rawTitle.trim();
  title = decodeHtmlEntities(title);
  return title.trim();
}


export function isExhentaiListingPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return !parsed.pathname.startsWith("/g/");
  } catch {
    return false;
  }
}
