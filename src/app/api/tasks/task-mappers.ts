import type { DownloadTask, TaskStatus } from '@/types';

/**
 * 将 Gallery 状态映射为 TaskStatus
 */
export function mapGalleryStatus(status: string): TaskStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'partial';
    case 'downloading':
      return 'downloading';
    case 'scraping':
      return 'scraping';
    case 'scrape_pending':
      return 'scrape_pending';
    case 'download_pending':
      return 'download_pending';
    case 'failed':
    case 'not_found':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * 将 Gallery 记录映射为统一的 DownloadTask 格式
 */
export function mapGalleryToTask(g: {
  id: number;
  seq?: string | null;
  sourceUrl: string;
  title: string;
  protagonist: string;
  description: string;
  gameCharacters: string | null;
  status: string;
  errorMsg: string;
  downloadMethod: string;
  imageCount: number;
  videoCount: number;
  totalSize: bigint;
  downloadedSize: bigint;
  savePath: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { images: number; videos: number };
  downloadInfo?: {
    id: number;
    galleryId: number;
    title: string;
    fileCount: number;
    fileSizeText: string;
    imageDimensions: string;
    password: string;
    downloadUrl: string;
    downloadSource: string;
    ouoUrl: string;
    resolvedDirectUrl: string;
    provider: string;
    requiresLogin: boolean;
    requiresEmail: boolean;
    status: string;
    localPath: string;
    extractedPath: string;
    actualSize: bigint;
    zipFileName: string;
    parallelism: number;
    avgSpeed: number;
    verifiedCount: number;
    countMatched: boolean;
  } | null;
}): DownloadTask {
  const totalFiles = g.imageCount + g.videoCount;
  const downloadedFiles = (g._count?.images ?? 0) + (g._count?.videos ?? 0);
  const progress = totalFiles > 0
    ? Math.min((downloadedFiles / totalFiles) * 100, 100)
    : 0;

  let person = g.protagonist || '';
  if (!person && g.gameCharacters) {
    try {
      const gc = JSON.parse(g.gameCharacters) as string[];
      if (Array.isArray(gc) && gc.length > 0) {
        person = gc.join('、');
      }
    } catch {
    }
  }

  return {
    ID: g.id,
    DisplayID: g.seq ?? undefined,
    URL: g.sourceUrl,
    M3U8URL: '',
    Status: mapGalleryStatus(g.status),
    Progress: progress,
    FilePath: g.savePath,
    Format: '',
    Priority: 0,
    ErrorMsg: g.errorMsg,
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    TaskType: 'gallery',
    GalleryTitle: g.title,
    Person: person || undefined,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    DownloadMethod: g.downloadMethod,
    GalleryTotalSize: Number(g.totalSize),
    DownloadInfo: g.downloadInfo ? {
      ID: g.downloadInfo.id,
      GalleryID: g.downloadInfo.galleryId,
      Title: g.downloadInfo.title,
      FileCount: g.downloadInfo.fileCount,
      FileSizeText: g.downloadInfo.fileSizeText,
      ImageDimensions: g.downloadInfo.imageDimensions,
      Password: g.downloadInfo.password,
      DownloadURL: g.downloadInfo.downloadUrl,
      DownloadSource: g.downloadInfo.downloadSource,
      OuoURL: g.downloadInfo.ouoUrl,
      ResolvedDirectURL: g.downloadInfo.resolvedDirectUrl,
      Provider: g.downloadInfo.provider,
      RequiresLogin: g.downloadInfo.requiresLogin,
      RequiresEmail: g.downloadInfo.requiresEmail,
      Status: g.downloadInfo.status,
      LocalPath: g.downloadInfo.localPath,
      ExtractedPath: g.downloadInfo.extractedPath,
      ActualSize: Number(g.downloadInfo.actualSize),
      ZipFileName: g.downloadInfo.zipFileName,
      Parallelism: g.downloadInfo.parallelism,
      AvgSpeed: g.downloadInfo.avgSpeed,
      VerifiedCount: g.downloadInfo.verifiedCount,
      CountMatched: g.downloadInfo.countMatched,
    } : undefined,
  };
}

/**
 * 将 SniffTask 记录映射为统一的 DownloadTask 格式
 */
export function mapSniffToTask(s: {
  id: number;
  seq?: string | null;
  url: string;
  status: string;
  totalFound: number;
  totalCreated: number;
  totalSkipped: number;
  errorMsg: string;
  createdAt: Date;
  updatedAt: Date;
}): DownloadTask {
  const statusMap: Record<string, TaskStatus> = {
    pending: 'pending',
    sniffing: 'scraping',
    completed: 'completed',
    failed: 'failed',
  };

  const progress = s.status === 'completed' ? 100 : s.status === 'sniffing' ? 30 : 0;

  return {
    ID: s.id,
    DisplayID: s.seq ?? undefined,
    URL: s.url,
    M3U8URL: '',
    Status: statusMap[s.status] ?? 'pending',
    Progress: progress,
    FilePath: '',
    Format: '',
    Priority: 0,
    ErrorMsg: s.errorMsg,
    CreatedAt: s.createdAt.toISOString(),
    UpdatedAt: s.updatedAt.toISOString(),
    TaskType: 'sniff',
    SniffTotalFound: s.totalFound,
    SniffTotalCreated: s.totalCreated,
    SniffTotalSkipped: s.totalSkipped,
  };
}
