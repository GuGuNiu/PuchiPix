/**
 * 类型定义文件
 *
 * 定义全应用共享的 TypeScript 接口和类型。
 */

// ============================================================
// 任务状态
// ============================================================

export type TaskStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'transcoding';

// ============================================================
// 视频信息
// ============================================================

/**
 * 视频元信息接口。
 * 与数据库 VideoInfo 表对应。
 */
export interface VideoInfo {
  ID: number;
  TaskID: number;
  /** 视频标题（纯标题，无站点后缀和前缀） */
  Title: string;
  /** 源 URL（视频播放页地址） */
  SourceURL: string;
  /** 视频文件体积（字节） */
  FileSize: number;
  /** 视频时长（分钟） */
  Duration: number;
  /** 视频标签数组 */
  Tags: string[];
  /** 视频演员/作者数组 */
  Actors: string[];
  /** 视频分类数组 */
  Categories: string[];
  /** 导演/系列 */
  Director: string;
  /** 视频分辨率（如 "1280x720"） */
  Resolution: string;
  CreatedAt: string;
}

// ============================================================
// 下载任务
// ============================================================

export type TaskType = 'video' | 'gallery';

export interface DownloadTask {
  ID: number;
  URL: string;
  M3U8URL: string;
  Status: TaskStatus;
  Progress: number;
  FilePath: string;
  Format: string;
  Priority: number;
  ErrorMsg: string;
  CreatedAt: string;
  UpdatedAt: string;
  VideoInfo?: VideoInfo;
  Segment?: number;
  TotalSegments?: number;
  /** 任务类型，默认 video；gallery 为图库任务 */
  TaskType?: TaskType;
  /** 图库标题（TaskType=gallery 时使用） */
  GalleryTitle?: string;
  /** 图片数量（TaskType=gallery 时使用） */
  ImageCount?: number;
  /** 视频数量（TaskType=gallery 时使用） */
  VideoCount?: number;
  /** 下载方式（TaskType=gallery 时使用）：pending | zip | scrape | both */
  DownloadMethod?: string;
}

// ============================================================
// 爬虫结果
// ============================================================

export interface ScrapeResult {
  m3u8_url: string;
  title: string;
  page_url: string;
  tags: string[];
  actors: string[];
  categories: string[];
  director: string;
}

export interface CapturedURL {
  url: string;
  type: string;
  timestamp: string;
  page_url: string;
  filename: string;
  tags?: string[];
  actors?: string[];
}

// ============================================================
// WebSocket 消息
// ============================================================

export interface ProgressMessage {
  type: string;
  task_id: number;
  progress: number;
  speed?: string;
  segment: number;
  total: number;
  status: string;
}

// ============================================================
// 统计信息
// ============================================================

export interface Stats {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  downloading_tasks: number;
  total_size: number;
  total_size_str: string;
  avg_speed: number;
  avg_speed_str: string;
  current_speed: number;
  current_speed_str: string;
  speed_rating: number;
}

// ============================================================
// 图库爬虫结果
// ============================================================

/** 图库中单张图片的信息 */
export interface GalleryImageItem {
  url: string;
  pageIndex: number;
  orderIndex: number;
}

/** 图库中单个视频的信息 */
export interface GalleryVideoItem {
  url: string;
}

/** ZIP 压缩包下载信息（从页面提取） */
export interface GalleryZipInfo {
  title: string;
  fileCount: number;
  fileSizeText: string;
  imageDimensions: string;
  password: string;
  downloadUrl: string;
  provider: string;
  requiresLogin: boolean;
  requiresEmail: boolean;
  /** 下载来源：ouo | mediafire | direct | unknown */
  downloadSource?: string;
  /** 原始 ouo.io 短链接 */
  ouoUrl?: string;
  /** 临时调试字段 */
  _dbg?: unknown;
}

/** 图库爬虫完整结果 */
export interface GalleryScrapeResult {
  sourceUrl: string;
  title: string;
  protagonist: string;
  description: string;
  category: string;
  tags: string[];
  coverUrl: string;
  /** 资源发布时间（YYYY-MM-DD 格式） */
  publishTime?: string;
  images: GalleryImageItem[];
  videos: GalleryVideoItem[];
  pageCount: number;
  imageCount: number;
  videoCount: number;
  /** 实际使用的域名（多域名自适应） */
  scrapedDomain?: string;
  /** ZIP 压缩包下载信息（如有） */
  zipInfo?: GalleryZipInfo;
  /** 从 TAG 中识别到的游戏角色列表 */
  gameCharacters?: string[];
}

/** 图库 ZIP 下载信息（API 响应格式） */
export interface GalleryDownloadInfoData {
  ID: number;
  GalleryID: number;
  Title: string;
  FileCount: number;
  FileSizeText: string;
  ImageDimensions: string;
  Password: string;
  DownloadURL: string;
  /** 下载来源：ouo | direct | mediafire | unknown */
  DownloadSource: string;
  /** 原始 ouo.io 短链接 */
  OuoURL: string;
  /** 中转站解析后的最终直链 */
  ResolvedDirectURL: string;
  Provider: string;
  RequiresLogin: boolean;
  RequiresEmail: boolean;
  Status: string;
  LocalPath: string;
  ExtractedPath: string;
  ActualSize: number;
  /** ZIP 压缩包英文名 */
  ZipFileName: string;
  /** 多线程并行数 */
  Parallelism: number;
  /** 平均下载速度（字节/秒） */
  AvgSpeed: number;
  /** 解压后实际文件数 */
  VerifiedCount: number;
  /** 文件数是否匹配 */
  CountMatched: boolean;
}

/** 图库数据（API 响应格式） */
export interface GalleryData {
  ID: number;
  SourceURL: string;
  SiteID: string;
  ScrapedDomain: string;
  Title: string;
  Protagonist: string;
  Description: string;
  Category: string;
  Tags: string[];
  CoverURL: string;
  /** 资源发布时间（YYYY-MM-DD 格式） */
  PublishTime?: string;
  ImageCount: number;
  VideoCount: number;
  PageCount: number;
  Status: string;
  /** 下载方式：pending | zip | scrape | both */
  DownloadMethod: string;
  /** 标题声明的预期图片数 */
  ExpectedImageCount: number;
  /** 标题声明的预期视频数 */
  ExpectedVideoCount: number;
  /** 内容是否已校验 */
  ContentVerified: boolean;
  SavePath: string;
  /** 图库总文件体积（字节） */
  TotalSize: number;
  /** 已下载文件体积（字节） */
  DownloadedSize: number;
  CreatedAt: string;
  UpdatedAt: string;
  Images?: GalleryImageData[];
  Videos?: GalleryVideoData[];
  /** ZIP 压缩包下载信息（如有） */
  DownloadInfo?: GalleryDownloadInfoData;
  /** 从 TAG 中识别到的游戏角色列表 */
  GameCharacters?: string[];
}

/** 图库图片（API 响应格式） */
export interface GalleryImageData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  PageIndex: number;
  OrderIndex: number;
  Status: string;
}

/** 图库视频（API 响应格式） */
export interface GalleryVideoData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  Status: string;
}

// ============================================================
// 系统状态
// ============================================================

export interface SystemStatus {
  memory: {
    alloc_mb: number;
    sys_mb: number;
    total_mb: number;
    gc_count: number;
  };
  goroutines?: number;
  uptime: number;
  timestamp: string;
}

export interface SniffStatus {
  running: boolean;
  target_url: string;
  captured: number;
  start_time: string;
}

export type AppConfig = Record<string, string>;

// ============================================================
// 搜索引擎
// ============================================================

/** 单个关键词的搜索结果项 */
export interface SearchItem {
  /** 视频页面 URL */
  pageUrl: string;
  /** 视频标题（从搜索结果列表提取） */
  title: string;
  /** 封面图 URL（如有） */
  coverUrl?: string;
  /** 视频发布日期（YYYY-MM-DD 格式，如有） */
  date?: string;
  /** M3U8 URL（爬取后填充） */
  m3u8Url?: string;
  /** 创建的下载任务 ID（创建后填充） */
  taskId?: number;
  /** 该项的状态 */
  status: 'pending' | 'scraping' | 'downloaded' | 'failed';
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retries: number;
}

/** 单个关键词的搜索结果 */
export interface KeywordResult {
  /** 搜索关键词 */
  keyword: string;
  /** 搜索状态 */
  status: 'pending' | 'searching' | 'completed' | 'failed';
  /** 搜索到的视频列表 */
  items: SearchItem[];
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retries: number;
}

/** 搜索任务整体状态 */
export interface SearchJob {
  /** 任务唯一 ID */
  id: string;
  /** 用户输入的原始关键词文本 */
  rawKeywords: string;
  /** 拆分后的关键词列表 */
  keywords: string[];
  /** 搜索的站点 ID（对应 SiteProvider.id） */
  siteId: string;
  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 每个关键词的搜索结果 */
  results: KeywordResult[];
  /** 创建时间 */
  createdAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 总找到视频数 */
  totalFound: number;
  /** 成功创建下载数 */
  totalDownloaded: number;
  /** 失败数 */
  totalFailed: number;
  /** 当前正在处理的关键词索引 */
  currentIndex: number;
  /** 日志 */
  logs: SearchLogEntry[];
}

/** 搜索日志条目 */
export interface SearchLogEntry {
  time: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

// ============================================================
// 批量搜索任务（按标题模糊搜索 → 自动下载）
// ============================================================

/** 批量搜索中单个标题的处理结果 */
export interface BatchTitleResult {
  /** 用户输入的视频标题 */
  title: string;
  /** 处理状态 */
  status:
    | 'pending'
    | 'searching'
    | 'found'
    | 'scraping'
    | 'completed'
    | 'not_found'
    | 'failed';
  /** 搜索到的候选视频列表 */
  searchResults: SearchItem[];
  /** 模糊匹配选中的最佳视频 */
  selectedItem?: SearchItem;
  /** 创建的下载任务 ID */
  taskId?: number;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retries: number;
  /** 匹配分数（0-1） */
  matchScore?: number;
}

/** 批量搜索任务整体状态 */
export interface BatchSearchJob {
  /** 任务唯一 ID */
  id: string;
  /** 用户输入的原始文本 */
  rawTitles: string;
  /** 拆分后的标题列表 */
  titles: string[];
  /** 搜索的站点 ID */
  siteId: string;
  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 每个标题的处理结果 */
  results: BatchTitleResult[];
  /** 创建时间 */
  createdAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 已处理数量 */
  totalProcessed: number;
  /** 成功下载的数量 */
  totalDownloaded: number;
  /** 未找到匹配的数量 */
  totalNotFound: number;
  /** 处理失败的数量 */
  totalFailed: number;
  /** 当前正在处理的标题索引 */
  currentIndex: number;
  /** 日志 */
  logs: SearchLogEntry[];
}
