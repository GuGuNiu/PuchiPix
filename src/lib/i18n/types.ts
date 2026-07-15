export type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";

export interface LocaleMeta {
  code: Locale;
  label: string;
  shortLabel: string;
  flag: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: "zh-CN", label: "简体中文", shortLabel: "简体", flag: "🇨🇳" },
  { code: "zh-TW", label: "繁體中文", shortLabel: "繁體", flag: "🇹🇼" },
  { code: "en-US", label: "English (US)", shortLabel: "EN", flag: "🇺🇸" },
  { code: "ja-JP", label: "日本語", shortLabel: "日本語", flag: "🇯🇵" },
];

export const DEFAULT_LOCALE: Locale = "zh-CN";

/**
 * 翻译键值结构 — 扁平化 dot-notation
 *
 * 以 zh-CN 为基准，其他语言必须覆盖全部键。
 */
export type TranslationDict = Record<string, string>;
