"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { Locale } from "./types";
import { DEFAULT_LOCALE } from "./types";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import enUS from "./locales/en-US";
import jaJP from "./locales/ja-JP";
import koKR from "./locales/ko-KR";
import ruRU from "./locales/ru-RU";
import deDE from "./locales/de-DE";
import viVN from "./locales/vi-VN";
import esES from "./locales/es-ES";
import ptBR from "./locales/pt-BR";
import frFR from "./locales/fr-FR";
import idID from "./locales/id-ID";
import type { TranslationDict } from "./types";
import { usePreferenceStore } from "@/store/preference-store";

const LOCALE_MAP: Record<Locale, TranslationDict> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "ru-RU": ruRU,
  "de-DE": deDE,
  "vi-VN": viVN,
  "es-ES": esES,
  "pt-BR": ptBR,
  "fr-FR": frFR,
  "id-ID": idID,
};

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

function detectBrowserLocale(): Locale {
  const browserLang = navigator.language;
  if (browserLang.startsWith("zh")) {
    if (browserLang.includes("TW") || browserLang.includes("HK") || browserLang.includes("Hant")) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (browserLang.startsWith("ja")) return "ja-JP";
  if (browserLang.startsWith("en")) return "en-US";
  if (browserLang.startsWith("ko")) return "ko-KR";
  if (browserLang.startsWith("ru")) return "ru-RU";
  if (browserLang.startsWith("de")) return "de-DE";
  if (browserLang.startsWith("vi")) return "vi-VN";
  if (browserLang.startsWith("es")) return "es-ES";
  if (browserLang.startsWith("pt")) return "pt-BR";
  if (browserLang.startsWith("fr")) return "fr-FR";
  if (browserLang.startsWith("id") || browserLang.startsWith("in")) return "id-ID";
  return DEFAULT_LOCALE;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const storeLocale = usePreferenceStore((s) => s.locale);
  const setStoreLocale = usePreferenceStore((s) => s.setLocale);
  const loaded = usePreferenceStore((s) => s.loaded);
  const loadFromServer = usePreferenceStore((s) => s.loadFromServer);

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    loadFromServer();
  }, [loadFromServer]);

  useEffect(() => {
    if (loaded) {
      const effective = storeLocale || detectBrowserLocale();
      setLocaleState(effective);
      document.documentElement.lang = effective;
    }
  }, [loaded, storeLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      setStoreLocale(next);
      document.documentElement.lang = next;
    },
    [setStoreLocale]
  );

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
