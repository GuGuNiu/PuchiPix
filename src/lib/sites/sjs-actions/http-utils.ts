import { createHash } from 'crypto';
import { USER_AGENT, CookieJar } from './types';

/**
 * 生成随机字母字符串（用于 loginhash 参数）。
 */
export function getRandomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * MD5 哈希。
 *
 * Discuz AJAX 登录需要将密码 MD5 哈希后提交。
 */
export function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/**
 * 从 HTML 中提取 input[name] 的 value 属性。
 */
export function extractInputValue(html: string, name: string): string {
  const regex = new RegExp(
    `<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    'i',
  );
  const match = html.match(regex);
  if (match) return match[1];

  const regex2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i',
  );
  const match2 = html.match(regex2);
  return match2 ? match2[1] : '';
}

/**
 * 从 HTML 中提取 a#id 的 href 属性。
 */
export function extractAnchorHref(html: string, id: string): string | null {
  const regex = new RegExp(`<a[^>]*id=["']${id}["'][^>]*href=["']([^"']*)["']`, 'i');
  const match = html.match(regex);
  if (match) return match[1];

  const regex2 = new RegExp(`<a[^>]*href=["']([^"']*)["'][^>]*id=["']${id}["']`, 'i');
  const match2 = html.match(regex2);
  return match2 ? match2[1] : null;
}

/**
 * 从 HTML 中提取 #id 元素的 innerHTML（简单实现）。
 */
export function extractElementText(html: string, selector: string): string {
  const idMatch = selector.match(/id=['"]([^'"]+)['"]/);
  if (idMatch) {
    const id = idMatch[1];
    const tag = selector.match(/^(\w+)/)?.[1] || '\\w+';
    const regex = new RegExp(`<${tag}[^>]*id=["']${id}["'][^>]*>(.*?)</${tag}>`, 'is');
    const match = html.match(regex);
    return match ? match[1].trim() : '';
  }
  return '';
}

/**
 * 从 HTML 中提取 class 匹配的元素内容。
 */
export function extractClassContent(html: string, className: string): string | null {
  const regex = new RegExp(
    `<div[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)</div>`,
    'i',
  );
  const match = html.match(regex);
  return match ? match[1] : null;
}

/**
 * 发送 HTTP 请求并自动管理 Cookie。
 */
export async function httpRequest(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: URLSearchParams | string;
    cookieJar: CookieJar;
    referer?: string;
  },
): Promise<{ text: string; status: number; url: string; setCookieHeaders: string[] }> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
  };

  const cookieHeader = options.cookieJar.toHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  if (options.referer) {
    headers['Referer'] = options.referer;
  }

  if (options.method === 'POST' && options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.method === 'POST' ? options.body : undefined,
    redirect: 'manual',
  });

  const setCookieHeaders: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      setCookieHeaders.push(value);
    }
  });

  const location = res.headers.get('location');
  let finalUrl = url;
  let text = '';

  if (res.status >= 300 && res.status < 400 && location) {
    let redirectUrl = location;
    if (redirectUrl.startsWith('/')) {
      const parsed = new URL(url);
      redirectUrl = `${parsed.origin}${redirectUrl}`;
    }
    const redirectRes = await httpRequest(redirectUrl, {
      method: 'GET',
      cookieJar: options.cookieJar,
      referer: url,
    });
    text = redirectRes.text;
    finalUrl = redirectRes.url;
    redirectRes.setCookieHeaders.forEach((h) => setCookieHeaders.push(h));
  } else {
    text = await res.text();
    finalUrl = res.url || url;
  }

  return { text, status: res.status, url: finalUrl, setCookieHeaders };
}
