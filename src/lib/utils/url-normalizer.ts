import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import { ALL_SITE_MODULES } from '@/lib/sites/site-modules';

/**
 * 清洗 URL — 去除首尾空白和不可见字符
 *
 * 处理用户粘贴 URL 时可能带入的：
 * - 首尾空格
 * - 零宽字符（U+200B, U+200C, U+200D, U+FEFF）
 * - BOM 字符
 * - 换行符和制表符
 *
 * @param raw - 原始 URL 字符串
 * @returns 清洗后的 URL
 */
export function cleanUrl(raw: string): string {
  if (!raw) return '';

  return raw
    // 去除所有零宽字符和 BOM
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    // 去除换行符和制表符
    .replace(/[\r\n\t]/g, '')
    // 去除首尾空白
    .trim();
}

/**
 * 规范化 URL — 统一格式以便精确匹配
 *
 * 规则：
 * - 小写化 hostname（路径区分大小写，保持原样）
 * - 统一为 https 协议（http → https）
 * - 去除 URL 尾部的斜杠（根路径 / 除外）
 * - 排序 query 参数（确保 ?a=1&b=2 和 ?b=2&a=1 等价）
 * - 去除 fragment（#hash）
 *
 * @param url - 原始或清洗后的 URL
 * @returns 规范化后的 URL
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    // 小写化 hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // 统一为 https
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }

    // 去除 fragment
    parsed.hash = '';

    // 去除尾部斜杠（但保留根路径 /）
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
      parsed.pathname = pathname;
    }

    // 排序 query 参数
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
 * 提取 URL 的路径部分（不含协议、域名、query、fragment）
 *
 * 示例：
 *   https://www.lovecutes.com/post/12345 → /post/12345
 *   https://xx.knit.bid/post/12345       → /post/12345
 *
 * @param url - 完整 URL
 * @returns 路径部分（以 / 开头），解析失败返回空字符串
 */
export function getUrlPath(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    // 去除尾部斜杠
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return pathname;
  } catch {
    let path = url;
    // 去除可能的域名前缀
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
 * 生成域名无关的 URL 签名
 *
 * 签名 = 路径 + 排序后的 query 参数
 * 不包含协议和域名，因此可以跨镜像域名匹配同一内容。
 *
 * 示例：
 *   https://www.lovecutes.com/post/12345 → "/post/12345"
 *   https://xx.knit.bid/post/12345       → "/post/12345"  ← 相同签名
 *
 * @param url - 完整 URL
 * @returns URL 签名（路径 + 排序 query）
 */
export function getUrlSignature(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    // 路径
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }

    // 排序 query 参数
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
 * 获取所有站点模块的所有域名列表
 *
 * 用于数据库扫描时生成 SQL 查询的域名变体。
 *
 * @returns 所有站点模块的域名数组
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
