export const DEFAULT_ZIP_PATH = './data/gallery_zips';
export const MAX_RETRIES = 3;
export const DOWNLOAD_TIMEOUT = 300000;
export const MEDIAFIRE_COUNTDOWN_MAX = 30;
export const PARALLEL_CHUNK_COUNT = 8;

export const ouoCache = new Map<string, { directUrl: string; filename: string; expires: number }>();
export const OUO_CACHE_TTL = 10 * 60 * 1000;
export const OUO_CACHE_MAX_SIZE = 50;

export function cleanExpiredOuoCache(): void {
  const now = Date.now();
  for (const [key, val] of ouoCache) {
    if (val.expires <= now) {
      ouoCache.delete(key);
    }
  }
  if (ouoCache.size > OUO_CACHE_MAX_SIZE) {
    const entries = [...ouoCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = entries.slice(0, ouoCache.size - OUO_CACHE_MAX_SIZE);
    for (const [key] of toRemove) {
      ouoCache.delete(key);
    }
  }
}

export function getZipRoot(): string {
  return process.env.GALLERY_ZIP_PATH || DEFAULT_ZIP_PATH;
}


