import { downloadFile, type DownloadOptions, type DownloadResult } from './file-download';
import { generateMirrorUrls, extractDomain } from '@/lib/utils';

/**
 * Download a file with automatic domain fallback.
 *
 * If the original URL fails (network error, timeout, connection reset, etc.),
 * tries alternative mirror domains by replacing the domain portion of the URL.
 * Mirror URLs are generated via `generateMirrorUrls` which looks up the site
 * module's domain list.
 *
 * This is critical for sites like aimeizizi where `xx.knit.bid` may be
 * unreachable but `lovecutes.com` / `lovecutes.net` serve the same content.
 *
 * @param url - Original download URL
 * @param filePath - Destination file path
 * @param options - Download options (headers, timeout, etc.)
 * @returns Download result from the first successful attempt, or the last
 *          failure if all mirrors fail.
 */
export async function downloadFileWithDomainFallback(
  url: string,
  filePath: string,
  options?: DownloadOptions,
): Promise<DownloadResult> {
  // Try the original URL first
  const result = await downloadFile(url, filePath, options);
  if (result.success) {
    return result;
  }

  // Get mirror URLs (includes original + all alternative domains)
  const mirrorUrls = generateMirrorUrls(url);
  const originalDomain = extractDomain(url);

  // Filter out the original URL — only try alternative domains
  const fallbackUrls = mirrorUrls.filter((mirrorUrl) => {
    const mirrorDomain = extractDomain(mirrorUrl);
    return mirrorDomain !== originalDomain;
  });

  if (fallbackUrls.length === 0) {
    return result; // No mirrors available, return original failure
  }

  console.log(
    `[DomainFallback] Original domain ${originalDomain} failed, ` +
    `trying ${fallbackUrls.length} mirror domain(s) for: ${url}`,
  );

  // Try each fallback URL
  for (const fallbackUrl of fallbackUrls) {
    const fallbackDomain = extractDomain(fallbackUrl);
    console.log(`[DomainFallback] Trying mirror: ${fallbackDomain}`);

    const fallbackResult = await downloadFile(fallbackUrl, filePath, options);
    if (fallbackResult.success) {
      console.log(`[DomainFallback] Success via mirror: ${fallbackDomain}`);
      return fallbackResult;
    }
  }

  // All domains failed — return the original failure result
  console.error(`[DomainFallback] All mirror domains failed for: ${url}`);
  return result;
}

/**
 * Fetch text content with automatic domain fallback.
 *
 * Used by the M3U8 parser to fetch playlist content when the original
 * domain is unreachable. Tries mirror domains in sequence.
 *
 * @param url - Original URL to fetch
 * @param headers - Request headers
 * @returns Response text from the first successful attempt
 * @throws Error if all mirror domains fail
 */
export async function fetchTextWithDomainFallback(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  // Try the original URL first
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Fall through to mirror domains
  }

  // Get mirror URLs
  const mirrorUrls = generateMirrorUrls(url);
  const originalDomain = extractDomain(url);

  const fallbackUrls = mirrorUrls.filter((mirrorUrl) => {
    const mirrorDomain = extractDomain(mirrorUrl);
    return mirrorDomain !== originalDomain;
  });

  if (fallbackUrls.length === 0) {
    throw new Error(`Failed to fetch ${url} and no mirror domains available`);
  }

  console.log(
    `[DomainFallback] Fetch failed on ${originalDomain}, ` +
    `trying ${fallbackUrls.length} mirror(s) for: ${url}`,
  );

  let lastError: Error | null = null;

  for (const fallbackUrl of fallbackUrls) {
    const fallbackDomain = extractDomain(fallbackUrl);
    try {
      const response = await fetch(fallbackUrl, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const text = await response.text();
        console.log(`[DomainFallback] Fetch success via mirror: ${fallbackDomain}`);
        return text;
      }
      lastError = new Error(`HTTP ${response.status} from ${fallbackDomain}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(`[DomainFallback] Mirror ${fallbackDomain} failed: ${lastError.message}`);
    }
  }

  throw lastError || new Error(`All mirror domains failed for: ${url}`);
}
