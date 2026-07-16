import { DomainHealthTracker, shuffleDomainList } from '@/lib/core/domain-health-tracker';
import { parseFileSize, replaceDomain } from '@/lib/utils';

export { parseFileSize };
export { replaceDomain };

/**
 * 从完整 URL 中提取域名（协议 + 主机名，含端口）
 *
 * 用于从文章 URL 提取域名，传给 DomainHealthTracker。
 */
export function extractDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export const SITE_DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

/** 占位图 URL 片段（懒加载时 src 中的占位 GIF） */
export const PLACEHOLDER_FRAGMENT = '/static/zde/timg.gif';

/** 站点后缀模式（用于标题清洗） */
export const SITE_SUFFIX_PATTERN = /\s*[-—–]\s*[^-]+[-—–]\s*爱妹子\s*$/;

// 从共享工具模块重新导出
export { removePublisherPrefix } from '@/lib/utils/title-cleaner';

export interface GalleryPageMetadata {
  h1Title: string;
  rawTitle: string;
  tags: string[];
  category: string;
  coverUrl: string;
  publishTime: string;
  currentPage: number;
  totalPages: number;
  images: { url: string; pageIndex: number }[];
  videos: string[];
}

/**
 * 从文章 URL 中提取文章 ID
 */
export function extractArticleId(url: string): string | null {
  const match = url.match(/\/article\/(\d+)/);
  return match ? match[1] : null;
}

export const domainHealthTracker = new DomainHealthTracker();

export function shuffleDomains(): string[] {
  return shuffleDomainList([...SITE_DOMAINS]);
}
