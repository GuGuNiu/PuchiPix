import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import { ALL_SITE_MODULES } from '@/lib/sites/site-modules';


export function cleanUrl(raw: string): string {
  if (!raw) return '';

  return raw
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/[\r\n\t]/g, '')
    .trim();
}


export function normalizeUrl(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    parsed.hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }

    parsed.hash = '';

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
      parsed.pathname = pathname;
    }

    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      const sorted = new URLSearchParams();
      const keys = [...params.keys()].sort();
      for (const key of keys) {
        const values = params.getAll(key);
        for (const value of values) {
          sorted.append(key, value);
        }
      }
      parsed.search = sorted.toString();
    }

    return parsed.toString();
  } catch {
    return cleanUrl(url);
  }
}

/**
 *
 *   https://www.lovecutes.com/post/12345 → /post/12345
 *   https://xx.knit.bid/post/12345       → /post/12345
 *
 */
export function getUrlPath(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return pathname;
  } catch {
    let path = url;
    const domainMatch = path.match(/^https?:\/\/[^/]+(.*)$/i);
    if (domainMatch) {
      path = domainMatch[1];
    }
    if (path.length > 1 && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
    return path;
  }
}

/**
 *
 * Signature = Path + Sortafter query parameter
 *
 *   https://www.lovecutes.com/post/12345 → "/post/12345"
 *   https://xx.knit.bid/post/12345       → "/post/12345"  ← Samesignature
 *
 */
export function getUrlSignature(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }

    let search = '';
    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      const sorted = new URLSearchParams();
      const keys = [...params.keys()].sort();
      for (const key of keys) {
        const values = params.getAll(key);
        for (const value of values) {
          sorted.append(key, value);
        }
      }
      search = sorted.toString();
      if (search) search = `?${search}`;
    }

    return `${pathname}${search}`;
  } catch {
    return cleanUrl(url);
  }
}

export function generateMirrorUrls(url: string): string[] {
  if (!url) return [];

    try {
      new URL(url);
      const path = getUrlSignature(url);
    const siteModule = getSiteModuleByUrl(url);

    if (!siteModule || !siteModule.domains || siteModule.domains.length <= 1) {
      return [normalizeUrl(url)];
    }

    const mirrorUrls: string[] = [];
    for (const domain of siteModule.domains) {
      try {
        const domainParsed = new URL(domain);
        const mirrorUrl = `${domainParsed.protocol}//${domainParsed.hostname}${path}`;
        mirrorUrls.push(mirrorUrl);
      } catch {
      }
    }

    return mirrorUrls;
  } catch {
    return [cleanUrl(url)];
  }
}

/**
 * Get allsitemodule alldomainList
 *
 *
 * @returns allsitemodule domainArray
 */
export function getAllSiteDomains(): string[] {
  const domains: string[] = [];
  for (const mod of ALL_SITE_MODULES) {
    if (mod.baseUrl) {
      try {
        const parsed = new URL(mod.baseUrl);
        domains.push(`${parsed.protocol}//${parsed.hostname}`);
      } catch {
      }
    }
    if (mod.domains) {
      for (const domain of mod.domains) {
        try {
          const parsed = new URL(domain);
          domains.push(`${parsed.protocol}//${parsed.hostname}`);
        } catch {
        }
      }
    }
  }
  return [...new Set(domains)];
}

export function extractDomain(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return '';
  }
}
