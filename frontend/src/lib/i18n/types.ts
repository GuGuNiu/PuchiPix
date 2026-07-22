export type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR" | "ru-RU" | "de-DE" | "vi-VN" | "es-ES" | "pt-BR" | "fr-FR" | "id-ID";

export interface LocaleMeta {
  code: Locale;
  label: string;
  shortLabel: string;
  flag: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: "zh-CN", label: "简体中文", shortLabel: "简体", flag: "" },
  { code: "zh-TW", label: "繁體中文", shortLabel: "繁體", flag: "" },
  { code: "en-US", label: "English (US)", shortLabel: "EN", flag: "" },
  { code: "ja-JP", label: "日本語", shortLabel: "日本語", flag: "" },
  { code: "ko-KR", label: "한국어", shortLabel: "KO", flag: "" },
  { code: "ru-RU", label: "Русский", shortLabel: "RU", flag: "" },
  { code: "de-DE", label: "Deutsch", shortLabel: "DE", flag: "" },
  { code: "vi-VN", label: "Tiếng Việt", shortLabel: "VI", flag: "" },
  { code: "es-ES", label: "Español", shortLabel: "ES", flag: "" },
  { code: "pt-BR", label: "Português (BR)", shortLabel: "PT", flag: "" },
  { code: "fr-FR", label: "Français", shortLabel: "FR", flag: "" },
  { code: "id-ID", label: "Bahasa Indonesia", shortLabel: "ID", flag: "" },
];

export const DEFAULT_LOCALE: Locale = "zh-CN";
export type TranslationDict = Record<string, string>;
