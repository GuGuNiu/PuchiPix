/**
 * m3u8-parser.ts — M3U8 播放列表解析器
 *
 * 职责：
 * 1. 通过 HTTP/HTTPS 获取 M3U8 播放列表文件内容（支持 Referer 防盗链）。
 * 2. 解析 M3U8 文本内容，区分 Master Playlist（多码率列表）和 Media Playlist（媒体分片列表）。
 * 3. 对于 Master Playlist，提取所有变体（variant）及其分辨率、带宽信息。
 * 4. 对于 Media Playlist，提取所有 TS 分片的 URI、时长、序号。
 * 5. 将相对 URI 解析为绝对 URL。
 *
 * M3U8 格式参考: https://datatracker.ietf.org/doc/html/rfc8216
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * M3U8 媒体分片描述。
 */
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

// ============================================================
// URI 解析工具
// ============================================================

/**
 * 将 M3U8 中的相对 URI 解析为绝对 URL。
 *
 * 处理以下情况：
 * 1. 绝对 URL（http:// 或 https://）— 直接返回。
 * 2. 协议相对 URL（//）— 补充 https: 前缀。
 * 3. 根路径相对 URL（/path）— 拼接 baseURL 的 origin。
 * 4. 相对路径 URL（path/to/file）— 拼接 baseURL 的目录部分。
 *
 * @param uri     - M3U8 中的原始 URI
 * @param baseURL - 基准 URL（通常是 M3U8 文件本身的 URL）
 * @returns 绝对 URL 字符串
 */
function resolveURI(uri: string, baseURL: string): string {
  // 情况 1：已经是绝对 URL
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  // 情况 2：协议相对 URL（以 // 开头）
  if (uri.startsWith('//')) {
    return 'https:' + uri;
  }

  // 去除 baseURL 的查询字符串和片段，并提取目录部分
  const baseWithoutFile = baseURL
    .replace(/[?#].*$/, '')      // 去除 ?query 和 #fragment
    .replace(/\/[^/]*$/, '/');   // 去除文件名部分，保留目录

  // 情况 3：根路径相对 URL（以 / 开头）
  if (uri.startsWith('/')) {
    const baseOrigin = baseURL.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    return baseOrigin + uri;
  }

  // 情况 4：相对路径 URL
  return baseWithoutFile + uri;
}

// ============================================================
// M3U8 内容获取
// ============================================================

/**
 * 通过 HTTP GET 获取 M3U8 播放列表文件内容。
 *
 * 请求头包含：
 * - User-Agent: 模拟 Chrome 浏览器，避免被 CDN 识别为爬虫。
 * - Accept: 所有内容类型。
 * - Referer: 可选，用于绕过 CDN 防盗链检查（通常为视频页面 URL）。
 *
 * @param url     - M3U8 文件的 URL
 * @param referer - 可选的 Referer 请求头
 * @returns M3U8 文件的文本内容
 * @throws 如果 HTTP 状态码非 200
 */
export async function fetchM3U8Content(url: string, referer?: string): Promise<string> {
  // 构建请求头
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  // 添加 Referer 头（用于 CDN 防盗链）
  if (referer) {
    headers['Referer'] = referer;
  }

  // 发起 HTTP 请求
  const response = await fetch(url, { headers });

  // 检查响应状态
  if (!response.ok) {
    throw new Error(`Failed to fetch M3U8: HTTP ${response.status} for ${url}`);
  }

  // 返回 M3U8 文本内容
  return response.text();
}

// ============================================================
// M3U8 解析器
// ============================================================

/**
 * 解析 M3U8 文本内容，返回结构化的播放列表对象。
 *
 * 解析流程：
 * 1. 逐行扫描 M3U8 文本。
 * 2. 遇到 #EXT-X-STREAM-INF 标签时，标记为 Master Playlist，并提取变体信息。
 * 3. 遇到 #EXTINF 标签时，记录下一个分片的时长。
 * 4. 遇到非注释行时，根据是否在 Master 模式下，解析为变体 URI 或分片 URI。
 * 5. 将所有 URI 解析为绝对 URL。
 *
 * @param content  - M3U8 文件的文本内容
 * @param baseURL  - 基准 URL（M3U8 文件本身的 URL），用于解析相对 URI
 * @returns 解析后的 M3U8Playlist 对象
 */
export function parseM3U8(content: string, baseURL: string): M3U8Playlist {
  // 按行分割（兼容 \r\n 和 \n）
  const lines = content.split(/\r?\n/);

  // 初始化播放列表对象
  const playlist: M3U8Playlist = {
    isMaster: false,
    segments: [],
    variants: [],
    targetDuration: 10, // 默认目标时长 10 秒
  };

  // 解析状态变量
  let segmentIndex = 0;       // 分片序号计数器
  let pendingDuration = 0;    // 待分配给下一个分片的时长（来自 #EXTINF）
  let pendingVariant: Partial<M3U8Variant> | null = null; // 待分配给下一个变体的元数据

  // 逐行扫描
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 空行和文件头标记跳过
    if (!line || line === '#EXTM3U') {
      continue;
    }

    // ============================================================
    // #EXTINF 标签：媒体分片时长信息
    // 格式: #EXTINF:<duration>,<title>
    // ============================================================
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:\s*([\d.]+)/);
      if (match) {
        pendingDuration = parseFloat(match[1]) || 0;
      }
      continue;
    }

    // ============================================================
    // #EXT-X-TARGETDURATION 标签：目标时长
    // 格式: #EXT-X-TARGETDURATION:<seconds>
    // ============================================================
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const match = line.match(/#EXT-X-TARGETDURATION:\s*(\d+)/);
      if (match) {
        playlist.targetDuration = parseInt(match[1], 10);
      }
      continue;
    }

    // ============================================================
    // #EXT-X-STREAM-INF 标签：Master Playlist 变体信息
    // 格式: #EXT-X-STREAM-INF:BANDWIDTH=<bw>,RESOLUTION=<wxh>,...
    // 下一行即为该变体的 Media Playlist URI
    // ============================================================
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      playlist.isMaster = true;

      // 提取分辨率
      const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] || '';
      // 提取带宽
      const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);

      pendingVariant = { resolution, bandwidth };
      continue;
    }

    // 其他注释行跳过（如 #EXT-X-VERSION, #EXT-X-PLAYLIST-TYPE 等）
    if (line.startsWith('#')) {
      continue;
    }

    // ============================================================
    // URI 行：变体 URI 或分片 URI
    // ============================================================

    // Master Playlist 模式：当前行是变体的 Media Playlist URI
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
    // Media Playlist 模式：当前行是 TS 分片的 URI
    else if (!playlist.isMaster) {
      const fullURI = resolveURI(line, baseURL);
      playlist.segments.push({
        uri: line,
        fullURI,
        duration: pendingDuration,
        index: segmentIndex++,
      });
      pendingDuration = 0; // 重置时长，等待下一个 #EXTINF
    }
  }

  return playlist;
}
