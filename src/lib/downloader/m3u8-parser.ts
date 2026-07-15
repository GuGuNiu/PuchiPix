export interface M3U8Segment {
  /** 分片的原始 URI（可能是相对路径或绝对 URL） */
  uri: string;
  /** 分片的绝对完整 URL（已解析相对路径） */
  fullURI: string;
  /** 分片时长（秒），来自 #EXTINF 标签 */
  duration: number;
  /** 分片在播放列表中的顺序序号（从 0 开始递增） */
  index: number;
}

/**
 * M3U8 变体描述（仅 Master Playlist 中存在）。
 * 每个变体指向一个不同码率/分辨率的 Media Playlist。
 */
export interface M3U8Variant {
  /** 变体的原始 URI */
  uri: string;
  /** 变体的绝对完整 URL */
  fullURI: string;
  /** 分辨率，如 "1920x1080"（可能为空） */
  resolution: string;
  /** 带宽（bps），用于选择最高质量的变体 */
  bandwidth: number;
}

/**
 * 解析后的 M3U8 播放列表。
 */
export interface M3U8Playlist {
  /** 是否为 Master Playlist（多码率列表） */
  isMaster: boolean;
  /** 媒体分片列表（仅 Media Playlist 有值） */
  segments: M3U8Segment[];
  /** 变体列表（仅 Master Playlist 有值） */
  variants: M3U8Variant[];
  /** 目标时长（秒），来自 #EXT-X-TARGETDURATION 标签，用于推算总时长 */
  targetDuration: number;
}

/**
 * 将 M3U8 中的相对 URI 解析为绝对 URL。
 *
 * 处理绝对 URL、协议相对 URL、根路径相对 URL、相对路径 URL等情况。
 *
 * @param uri     - M3U8 中的原始 URI
 * @param baseURL - 基准 URL（通常是 M3U8 文件本身的 URL）
 * @returns 绝对 URL 字符串
 *
 */
function resolveURI(uri: string, baseURL: string): string {
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  if (uri.startsWith('//')) {
    return 'https:' + uri;
  }

  // 去除 baseURL 的查询字符串和片段，并提取目录部分
  const baseWithoutFile = baseURL
    .replace(/[?#].*$/, '')      // 去除 ?query 和 #fragment
    .replace(/\/[^/]*$/, '/');   // 去除文件名部分，保留目录

  if (uri.startsWith('/')) {
    const baseOrigin = baseURL.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    return baseOrigin + uri;
  }

  return baseWithoutFile + uri;
}

/**
 * 通过 HTTP GET 获取 M3U8 播放列表文件内容。
 *
 * 请求头包含 User-Agent、Accept、Referer 等字段。
 *
 * @param url     - M3U8 文件的 URL
 * @param referer - 可选的 Referer 请求头
 * @returns M3U8 文件的文本内容
 * @throws 如果 HTTP 状态码非 200
 */
export async function fetchM3U8Content(url: string, referer?: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  // 添加 Referer 头（用于 CDN 防盗链）
  if (referer) {
    headers['Referer'] = referer;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch M3U8: HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

/**
 * 解析 M3U8 文本内容，返回结构化的播放列表对象。
 *
 * 解析流程：
 - 逐行扫描 M3U8 文本。
 - 遇到 #EXT-X-STREAM-INF 标签时，标记为 Master Playlist，并提取变体信息。
 - 遇到 #EXTINF 标签时，记录下一个分片的时长。
 - 遇到非注释行时，根据是否在 Master 模式下，解析为变体 URI 或分片 URI。
 - 将所有 URI 解析为绝对 URL。
 *
 * @param content  - M3U8 文件的文本内容
 * @param baseURL  - 基准 URL（M3U8 文件本身的 URL），用于解析相对 URI
 * @returns 解析后的 M3U8Playlist 对象
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

      // 提取分辨率
      const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] || '';
      // 提取带宽
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
