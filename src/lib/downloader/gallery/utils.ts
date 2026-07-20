import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from '@/lib/utils';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { randomProfile, buildStealthHeaders, DEFAULT_ACCEPT_LANGUAGE } from '@/lib/core/stealth/anti-crawler';

const DEFAULT_GALLERY_PATH = './data/galleries';
export const MAX_RETRIES = 3;

export function getGalleryConcurrency(): number {
  return taskQueueManager.getDownloadConcurrency().galleryImageConcurrent;
}

export function getGalleryRoot(): string {
  return process.env.GALLERY_PATH || DEFAULT_GALLERY_PATH;
}

export function buildGalleryFolderName(
  galleryId: number,
  title: string,
  protagonist: string,
  description: string,
): string {
  const parts: string[] = [];

  if (protagonist) {
    parts.push(sanitizeFilename(protagonist));
  }

  if (description) {
    parts.push(sanitizeFilename(description));
  }

  if (parts.length === 0 && title) {
    parts.push(sanitizeFilename(title));
  }

  if (parts.length === 0) {
    return `gallery_${galleryId}`;
  }

  return parts.join(' - ');
}

export function extractExtension(url: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.ts'].includes(ext)) {
      return ext;
    }
  } catch {
  }
  return '.jpg';
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 *
 *
 * @param url - file URL
 */
export function buildDownloadHeaders(
  url: string,
  referer?: string,
): Record<string, string> {
  const profile = randomProfile();
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff?)(\?|#|$)/i.test(url);

  if (isImage) {
    let imageReferer = '';
    try {
      const parsed = new URL(url);
      imageReferer = `${parsed.protocol}//${parsed.host}/`;
    } catch {
      imageReferer = referer || '';
    }

    const headers: Record<string, string> = {
      'User-Agent': profile.ua,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Encoding': profile.acceptEncoding,
      'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
      'Connection': 'keep-alive',
      'sec-fetch-dest': 'image',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'same-origin',
      'Referer': imageReferer,
    };

    if (profile.secChUa) {
      headers['sec-ch-ua'] = profile.secChUa;
      headers['sec-ch-ua-mobile'] = profile.secChUaMobile;
      headers['sec-ch-ua-platform'] = profile.secChUaPlatform;
    }

    return headers;
  }

  return buildStealthHeaders(profile, referer);
}
