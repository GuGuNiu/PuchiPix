import { DomainHealthTracker, shuffleDomainList } from '@/lib/core/domain/domain-health-tracker';
import { parseFileSize, replaceDomain, extractDomain } from '@/lib/utils';

export { parseFileSize };
export { replaceDomain };
export { extractDomain as extractDomainFromUrl } from '@/lib/utils/url-normalizer';

export const SITE_DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

export const PLACEHOLDER_FRAGMENT = '/static/zde/timg.gif';

export const SITE_SUFFIX_PATTERNS: RegExp[] = [
  /\s*[|\-]\s*(爱妹子|爱妹子网|Aimeizizi|LoveCutes)\s*$/i,
];

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
  'AI',
];

export const BLOCKED_CATEGORIES: readonly string[] = [
  'AI',
];

export const BLOCKED_PROTAGONISTS: readonly string[] = [];

export const BLOCKED_PROTAGONISTS_ENABLED = false;
