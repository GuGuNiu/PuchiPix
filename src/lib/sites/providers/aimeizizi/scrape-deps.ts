import type { BlockCheckResult } from '../../types';

export interface ScrapeDeps {
  resolveUrl(url: string): string;
  cleanTitle(rawTitle: string): string;
  extractProtagonist(title: string, tags: string[]): Promise<string>;
  extractDescription(title: string, protagonist: string): string;
  checkContentBlockedAsync(
    title: string,
    category: string,
    protagonist?: string,
  ): Promise<BlockCheckResult>;
}
