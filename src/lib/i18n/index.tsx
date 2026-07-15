"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { Locale } from "./types";
import { DEFAULT_LOCALE } from "./types";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import enUS from "./locales/en-US";
import jaJP from "./locales/ja-JP";
import type { TranslationDict } from "./types";

const LOCALE_MAP: Record<Locale, TranslationDict> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  "ja-JP": jaJP,
};

const STORAGE_KEY = "locale";

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: (key: string) => key,
  setLocale: () => {},
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * 从 localStorage 安全读取语言偏好
 */
function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in LOCALE_MAP) return saved;
  } catch {
    /* localStorage 不可用 */
  }

  // 尝试从浏览器语言推断
  const browserLang = navigator.language;
  if (browserLang.startsWith("zh")) {
    if (browserLang.includes("TW") || browserLang.includes("HK") || browserLang.includes("Hant")) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (browserLang.startsWith("ja")) return "ja-JP";
  if (browserLang.startsWith("en")) return "en-US";

  return DEFAULT_LOCALE;
}

/**
 * 插值：将 {param} 替换为实际值
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectInitialLocale();
    setLocaleState(detected);
    document.documentElement.lang = detected;
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = LOCALE_MAP[locale] ?? LOCALE_MAP[DEFAULT_LOCALE];
      const template = dict[key] ?? LOCALE_MAP[DEFAULT_LOCALE][key] ?? key;
      return interpolate(template, params);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t, setLocale }),
    [locale, t, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export default I18nProvider;
