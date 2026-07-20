import { fetchTextWithDomainFallback } from './domain-fallback';

export interface M3U8Segment {
  uri: string;
  fullURI: string;
  duration: number;
  index: number;
}


export interface M3U8Variant {
  uri: string;
  fullURI: string;
  resolution: string;
  bandwidth: number;
}


export interface M3U8Playlist {
  isMaster: boolean;
  segments: M3U8Segment[];
  variants: M3U8Variant[];
  targetDuration: number;
}

/**
 *
 *
 * @param uri     -
 * @returns Absolute URL
 *
 */
function resolveURI(uri: string, baseURL: string): string {
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  if (uri.startsWith('//')) {
    return 'https:' + uri;
  }

  const baseWithoutFile = baseURL
    .replace(/[?#].*$/, '')  
    .replace(/\/[^/]*$/, '/');

  if (uri.startsWith('/')) {
    const baseOrigin = baseURL.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    return baseOrigin + uri;
  }

  return baseWithoutFile + uri;
}

/**
 *
 *
 * @param url     - M3U8 file URL
 * @param referer - Optional Referer Request headers
 * @returns M3U8
 * @throws if HTTP Status codenon- 200
 */
export async function fetchM3U8Content(url: string, referer?: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  if (referer) {
    headers['Referer'] = referer;
  }

  /*
   * Use domain fallback: if the original domain (e.g., xx.knit.bid) is
   * unreachable, try mirror domains (e.g., lovecutes.com) automatically.
   */
  return fetchTextWithDomainFallback(url, headers);
}

/**
 *
 *- Scan M3U8 text line by line.
 *- On #EXT-X-STREAM-INF tag, mark as Master Playlist and extract variant info.
 *- On #EXTINF tag, log next segment duration.
 *- On non-comment line, parse to variant URI or segment URI based on Master mode.
 *- Resolve all URIs to absolute URLs.
 *
 * @param content  -
 * @returns Parseafter M3U8Playlist object
 */
export function parseM3U8(content: string, baseURL: string): M3U8Playlist {
  const lines = content.split(/\r?\n/);
  const playlist: M3U8Playlist = {
    isMaster: false,
    segments: [],
    variants: [],
    targetDuration: 10,
  };

  let segmentIndex = 0;
  let pendingDuration = 0;
  let pendingVariant: Partial<M3U8Variant> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || line === '#EXTM3U') {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:\s*([\d.]+)/);
      if (match) {
        pendingDuration = parseFloat(match[1]) || 0;
      }
      continue;
    }

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const match = line.match(/#EXT-X-TARGETDURATION:\s*(\d+)/);
      if (match) {
        playlist.targetDuration = parseInt(match[1], 10);
      }
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      playlist.isMaster = true;

      const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] || '';
      const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
      pendingVariant = { resolution, bandwidth };
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (playlist.isMaster && pendingVariant) {
      const fullURI = resolveURI(line, baseURL);
      playlist.variants.push({
        uri: line,
        fullURI,
        resolution: pendingVariant.resolution || '',
        bandwidth: pendingVariant.bandwidth || 0,
      });
      pendingVariant = null;
    }
    else if (!playlist.isMaster) {
      const fullURI = resolveURI(line, baseURL);
      playlist.segments.push({
        uri: line,
        fullURI,
        duration: pendingDuration,
        index: segmentIndex++,
      });
      pendingDuration = 0;
    }
  }

  return playlist;
}
