/**
 * Pinyin-Pro 引擎适配器
 *
 * 将 pinyin-pro 库适配为拼音服务引擎接口。
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
   * 转换文本为拼音
   *
   * @param text - 待转换文本
   * @param options - 转换选项
   * @returns 拼音字符串或数组
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
   * 匹配文本拼音是否包含指定拼音
   *
   * @param text - 待匹配文本
   * @param pinyin - 拼音模式
   * @param options - 匹配选项
   * @returns 是否匹配
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
   * 获取文本的拼音变体
   *
   * @param text - 输入文本
   * @returns 拼音变体信息
   */
  getVariants(text: string): PinyinVariants {
    try {
      // 全拼音（无音调）
      const full = pinyinPro(text, {
        toneType: 'none',
        type: 'string',
        nonZh: 'consecutive',
      }).toLowerCase().replace(/\s/g, '');

      // 首字母
      const initials = pinyinPro(text, {
        pattern: 'first',
        toneType: 'none',
        type: 'string',
        nonZh: 'consecutive',
      }).toLowerCase().replace(/\s/g, '');

      // 带音调
      const withTone = pinyinPro(text, {
        toneType: 'symbol',
        type: 'string',
        nonZh: 'consecutive',
      });

      // 拼音数组
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
      // 转换失败时返回原文本
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
