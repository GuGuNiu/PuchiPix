/**
 *
 *
 * @example
 * replaceDomain('https://a.com/path', 'https://b.com')  // → "https://b.com/path"
 * decodeHtmlEntities('a&amp;b&lt;c')  // → "a&b<c"
 */

/**
 * Replace URL  domainPartial
 *
 *
 * @returns replacedomainafter  URL
 *
 * @example
 * replaceDomain('https://a.com/path/page', 'https://b.com')  // → "https://b.com/path/page"
 */
export function replaceDomain(url: string, targetDomain: string): string {
  return url.replace(/^https?:\/\/[^/]+/, targetDomain);
}

/**
 *
 *
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


export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


export function truncate(text: string, maxLength: number = 100, suffix: string = '...'): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}
