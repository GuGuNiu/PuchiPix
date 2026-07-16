import type { M3U8Segment } from '../m3u8-parser';

export interface ActiveDownload {
  /** 任务 ID */
  taskId: number;
  /** 当前状态：活跃/暂停/取消 */
  status: 'active' | 'paused' | 'cancelled';
  /** 全部分片列表（来自 M3U8 解析） */
  segments: M3U8Segment[];
  /** 已成功下载的分片序号集合 */
  completedSegments: Set<number>;
  /** 下载失败的分片序号 → 错误信息 */
  failedSegments: Map<number, Error>;
  /** 分片总数 */
  totalSegments: number;
  /** 分片文件保存目录 */
  segDir: string;
  /** 最终输出文件路径 */
  outputPath: string;
  /** 下载开始时间戳（毫秒） */
  startTime: number;
  /** 上次进度推送时间戳（毫秒），用于节流 */
  lastProgressTime: number;
  /** Referer 头（来自视频页面 URL，用于 CDN 防盗链） */
  referer?: string;
}

/**
 * 下载队列项：将分片加入待下载队列。
 */
export interface QueueItem {
  /** 任务 ID */
  taskId: number;
  /** 分片元数据 */
  segment: M3U8Segment;
  /** Referer 头 */
  referer?: string;
}
