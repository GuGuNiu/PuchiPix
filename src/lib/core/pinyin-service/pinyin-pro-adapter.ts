/**
 * Pinyin-Pro engineAdapter
 *
 */

import { pinyin as pinyinPro, match as pinyinMatch } from 'pinyin-pro';
import type {
  PinyinEngine,
  PinyinConvertOptions,
  PinyinMatchOptions,
  PinyinVariants,
} from './types';

export class PinyinProAdapter implements PinyinEngine {
  /**
   *
   * @param options - Convertoption
   * @returns Pinyin string or array
   */
  convert(text: string, options?: PinyinConvertOptions): string | string[] {
    const { type = 'string', ...rest } = options ?? {};
    const baseOpts = {
      toneType: 'none' as const,
      nonZh: 'consecutive' as const,
      ...rest,
    };

    try {
      if (type === 'array') {
        return pinyinPro(text, { ...baseOpts, type: 'array' });
      }
      return pinyinPro(text, { ...baseOpts, type: 'string' });
    } catch {
      return text.toLowerCase();
    }
  }

  /**
   *
   * @param options - Matchoption
   * @returns isnoMatch
   */
  match(text: string, pinyin: string, options?: PinyinMatchOptions): boolean {
    const opts = {
      precision: 'every' as const,
      continuous: true,
      ...options,
    };

    try {
      return pinyinMatch(text, pinyin, opts) !== null;
    } catch {
      return text.toLowerCase().includes(pinyin.toLowerCase());
    }
  }

  /**
   *
   * @returns Pinyin variant info
   */
  getVariants(text: string): PinyinVariants {
    try {
      const full = pinyinPro(text, {
        toneType: 'none',
        type: 'string',
        nonZh: 'consecutive',
      }).toLowerCase().replace(/\s/g, '');

      const initials = pinyinPro(text, {
        pattern: 'first',
        toneType: 'none',
        type: 'string',
        nonZh: 'consecutive',
      }).toLowerCase().replace(/\s/g, '');

      const withTone = pinyinPro(text, {
        toneType: 'symbol',
        type: 'string',
        nonZh: 'consecutive',
      });

      // PinyinArray
      const array = pinyinPro(text, {
        toneType: 'none',
        type: 'array',
        nonZh: 'consecutive',
      }) as string[];

      return {
        original: text,
        full,
        initials,
        withTone,
        array,
      };
    } catch {
      const lower = text.toLowerCase();
      return {
        original: text,
        full: lower,
        initials: lower.replace(/[^a-z]/g, ''),
        array: [lower],
      };
    }
  }
}
