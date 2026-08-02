import type { Locale } from "./types";
import { DEFAULT_LOCALE } from "./types";

const PREFIX_MAP: ReadonlyArray<[string, Locale]> = [
  ["zh", "zh-CN"],
  ["ja", "ja-JP"],
  ["en", "en-US"],
  ["ko", "ko-KR"],
  ["ru", "ru-RU"],
  ["de", "de-DE"],
  ["vi", "vi-VN"],
  ["es", "es-ES"],
  ["pt", "pt-BR"],
  ["fr", "fr-FR"],
  ["id", "id-ID"],
  ["in", "id-ID"],
];

const SUPPORTED_LOCALES = new Set<string>([
  "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR",
  "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID",
]);


export function parseLangTag(lang: string): Locale | null {
  const trimmed = lang.trim();
  if (!trimmed) return null;

  if (SUPPORTED_LOCALES.has(trimmed)) {
    return trimmed as Locale;
  }

  if (trimmed.startsWith("zh")) {
    if (trimmed.includes("TW") || trimmed.includes("HK") || trimmed.includes("Hant")) {
      return "zh-TW";
    }
    return "zh-CN";
  }

  const lower = trimmed.toLowerCase();
  for (const [prefix, locale] of PREFIX_MAP) {
    if (lower.startsWith(prefix)) {
      return locale;
    }
  }

  return null;
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;

  const result = parseLangTag(navigator.language);
  return result ?? DEFAULT_LOCALE;
}
