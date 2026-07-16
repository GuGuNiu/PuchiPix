/**
 * 文件名处理工具模块
 *
 * 提供文件名清洗、文件名提取等功能。
 * 统一了之前散落在 download-manager / gallery-downloader / parallel-downloader / zip-downloader 中的重复实现。
 *
 * @example
 * sanitizeFilename('test<>:"/\\|?*file')  // → "test_file"
 * extractFilenameFromUrl('https://a.com/path/file.zip?q=1')  // → "file.zip"
 */

import type http from 'http';

/**
 * 将文件名中的不安全字符替换为安全字符
 *
 * 处理规则：
 * - Windows 禁止字符 (< > : " / \ | ? *) 替换为 replacement 字符
 * - 合并连续的空格和替换符
 * - 去除首尾空格、点号、下划线、替换符
 * - 限制长度（默认 100 字符，UTF-8 安全截断）
 *
 * @param name - 原始文件名
 * @param options - 可选配置
 * @param options.maxLength - 最大长度（默认 100）
 * @param options.placeholder - 空名时的占位符（默认 'unnamed'）
 * @param options.replacement - 禁止字符的替换符（默认 '_'，设为 '' 则直接删除）
 * @returns 安全的文件名字符串
 *
 * @example
 * sanitizeFilename('test<>:"/\\|?*file')  // → "test_file"
 * sanitizeFilename('test<>:"file', { replacement: '' })  // → "testfile"
 */
export function sanitizeFilename(
  name: string,
  options?: {
    maxLength?: number;
    placeholder?: string;
    replacement?: string;
  },
): string {
  const {
    maxLength = 100,
    placeholder = 'unnamed',
    replacement = '_',
  } = options ?? {};

  if (!name || name.trim() === '') {
    return placeholder;
  }

  let result = name
    .replace(/[<>:"/\\|?*]/g, replacement);

  if (replacement) {
    // 有替换符时：合并连续的空格和替换符为单个替换符
    result = result.replace(/[\s_]+/g, replacement);
    // 去除首尾空格、点号、下划线、替换符
    result = result.replace(/^[\s._]+|[\s._]+$/g, '');
  } else {
    // 无替换符时（删除模式）：合并连续空格为单个空格
    result = result.replace(/\s+/g, ' ').trim();
    // 去除首尾点号
    result = result.replace(/^\.+|\.+$/g, '');
  }

  // 限制长度
  result = result.slice(0, maxLength);

  return result || placeholder;
}

/**
 * 从 Content-Disposition 响应头中提取文件名
 *
 * 支持 RFC 5987 格式（filename*=UTF-8''xxx）和传统格式（filename="xxx"）。
 *
 * @param headers - HTTP 响应头对象
 * @returns 提取到的文件名，提取失败返回 null
 *
 * @example
 * extractFilenameFromHeaders({ 'content-disposition': 'attachment; filename="test.zip"' })
 * // → "test.zip"
 */
export function extractFilenameFromHeaders(
  headers: http.IncomingHttpHeaders,
): string | null {
  const cd = headers['content-disposition'];
  if (!cd) return null;

  const match = cd.match(
    /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i,
  );
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

/**
 * 从 URL 中提取文件名
 *
 * 解析 URL 的 pathname，取最后一段作为文件名。
 * 自动去除 query string 和 fragment。
 *
 * @param url - 完整 URL 或路径
 * @param fallback - 提取失败时的回退文件名（默认 `file_${timestamp}`）
 * @returns 提取到的文件名
 *
 * @example
 * extractFilenameFromUrl('https://a.com/path/file.zip?q=1')  // → "file.zip"
 * extractFilenameFromUrl('https://a.com/path/')              // → "file_1234567890"
 */
export function extractFilenameFromUrl(
  url: string,
  fallback?: string,
): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const pathname = new URL(cleanUrl).pathname;
    const segments = pathname.split('/');
    const last = segments[segments.length - 1];
    if (last && last.length > 0) {
      return decodeURIComponent(last);
    }
  } catch {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const segments = cleanUrl.split('/');
    const last = segments[segments.length - 1];
    if (last && last.length > 0) {
      return last;
    }
  }
  return fallback || `file_${Date.now()}`;
}
