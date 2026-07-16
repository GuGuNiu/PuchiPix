/**
 * 字符串处理工具模块
 *
 * 提供通用的字符串操作，包括域名替换、HTML 实体解码、文本清洗等。
 *
 * @example
 * replaceDomain('https://a.com/path', 'https://b.com')  // → "https://b.com/path"
 * decodeHtmlEntities('a&amp;b&lt;c')  // → "a&b<c"
 */

/**
 * 替换 URL 的域名部分
 *
 * 将 URL 中的 `protocol://host` 部分替换为目标域名。
 *
 * @param url - 原始 URL
 * @param targetDomain - 目标域名（如 'https://b.com'）
 * @returns 替换域名后的 URL
 *
 * @example
 * replaceDomain('https://a.com/path/page', 'https://b.com')  // → "https://b.com/path/page"
 */
export function replaceDomain(url: string, targetDomain: string): string {
  return url.replace(/^https?:\/\/[^/]+/, targetDomain);
}

/**
 * HTML 实体解码
 *
 * 将常见的 HTML 实体转换回原始字符。
 *
 * @param text - 包含 HTML 实体的文本
 * @returns 解码后的文本
 *
 * @example
 * decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;')  // → "&<>\"' "
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 清洗文本 — 去除多余空白和不可见字符
 *
 * @param text - 原始文本
 * @returns 清洗后的文本
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 截断文本到指定长度，并添加省略号
 *
 * @param text - 原始文本
 * @param maxLength - 最大长度（默认 100）
 * @param suffix - 截断后缀（默认 '...'）
 * @returns 截断后的文本
 */
export function truncate(text: string, maxLength: number = 100, suffix: string = '...'): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}
