/**
 *
 *
 * @example
 * sanitizeFilename('test<>:"/\\|?*file')  // → "test_file"
 * extractFilenameFromUrl('https://a.com/path/file.zip?q=1')  // → "file.zip"
 */

import type http from 'http';

/**
 *
 *
 * @param options - optionalconfig
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
    result = result.replace(/[\s_]+/g, replacement);
    result = result.replace(/^[\s._]+|[\s._]+$/g, '');
  } else {
    result = result.replace(/\s+/g, ' ').trim();
    result = result.replace(/^\.+|\.+$/g, '');
  }

  // Limitlength
  result = result.slice(0, maxLength);

  return result || placeholder;
}

/**
 *
 *
 * @param headers - HTTP Response headersobject
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
 *
 *
 * @returns Extractto Filename
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
