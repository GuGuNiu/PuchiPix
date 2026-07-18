﻿import { DomainHealthTracker, shuffleDomainList } from '@/lib/core/domain/domain-health-tracker';
import { parseFileSize, replaceDomain, extractDomain } from '@/lib/utils';

export { parseFileSize };
export { replaceDomain };
export { extractDomain as extractDomainFromUrl } from '@/lib/utils/url-normalizer';

export const SITE_DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

/** 鍗犱綅鍥?URL 鐗囨 */
export const PLACEHOLDER_FRAGMENT = '/static/zde/timg.gif';

/** 绔欑偣鍚庣紑妯″紡 */
export const SITE_SUFFIX_PATTERN = /\s*[-鈥斺€揮\s*[^-]+[-鈥斺€揮\s*鐖卞瀛怽s*$/;

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
 * 浠庢枃绔?URL 涓彁鍙栨枃绔?ID
 */
export function extractArticleId(url: string): string | null {
  const match = url.match(/\/article\/(\d+)/);
  return match ? match[1] : null;
}

export const domainHealthTracker = new DomainHealthTracker();

export function shuffleDomains(): string[] {
  return shuffleDomainList([...SITE_DOMAINS]);
}

export const BLOCKED_TITLE_KEYWORDS: readonly string[] = [
  'AI Nudes',
  'AI Porn',
  'AI 生成',
  'AI生成',
  '人工智能生成',
  'AI绘图',
  'AI 绘图',
];

export const BLOCKED_CATEGORIES: readonly string[] = [
  'AI美女',
  'AI 美女',
  'AI生成',
];

export const BLOCKED_PROTAGONISTS: readonly string[] = [];

export const BLOCKED_PROTAGONISTS_ENABLED = false;
