import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/stealth/anti-crawler';
import { extractFilenameFromHeaders } from '@/lib/utils';
import { MAX_REDIRECTS, type ProbeResult } from './types';

export function probeUrl(
  url: string,
  headers: Record<string, string>,
  redirects: number = 0,
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const req = client.request(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': randomUA(),
          ...headers,
        },
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          probeUrl(absoluteRedirect, headers, redirects + 1).then(resolve, reject);
          return;
        }

        if (response.statusCode === 403 || response.statusCode === 405) {
          response.resume();
          probeUrlWithGet(url, headers, redirects).then(resolve, reject);
          return;
        }

        const contentLength = parseInt(
          response.headers['content-length'] || '0',
          10,
        );
        const acceptsRanges =
          (response.headers['accept-ranges'] || '').toLowerCase() === 'bytes';
        const filename = extractFilenameFromHeaders(response.headers);

        resolve({
          statusCode: response.statusCode || 0,
          contentLength,
          acceptsRanges,
          finalUrl: url,
          filename,
          headers: response.headers,
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HEAD request timeout'));
    });

    req.end();
  });
}

export function probeUrlWithGet(
  url: string,
  headers: Record<string, string>,
  redirects: number = 0,
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          Range: 'bytes=0-0',
          ...headers,
        },
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          probeUrlWithGet(absoluteRedirect, headers, redirects + 1).then(resolve, reject);
          return;
        }

        response.resume();

        const contentRange = response.headers['content-range'] || '';
        let contentLength = 0;
        const rangeMatch = contentRange.match(/\/(\d+)/);
        if (rangeMatch) {
          contentLength = parseInt(rangeMatch[1], 10);
        }

        const acceptsRanges =
          response.statusCode === 206 || !!contentRange;

        const filename = extractFilenameFromHeaders(response.headers);

        resolve({
          statusCode: 200,
          contentLength,
          acceptsRanges,
          finalUrl: url,
          filename,
          headers: response.headers,
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GET Range probe timeout'));
    });
  });
}
