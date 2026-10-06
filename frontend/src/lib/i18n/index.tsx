import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Locale } from "./types";
import { DEFAULT_LOCALE } from "./types";
import type { TranslationDict } from "./types";
import { detectBrowserLocale } from "./detect";
import zhCN, { type TranslationKey } from "./locales/zh-CN";
import { usePreferenceStore } from "@/store/preference-store";


const dictCache = new Map<Locale, TranslationDict>();
dictCache.set("zh-CN", zhCN);


const dictLoaders: Record<Locale, () => Promise<{ default: TranslationDict }>> = {
  "zh-CN": () => import("./locales/zh-CN"),
  "zh-TW": () => import("./locales/zh-TW"),
  "en-US": () => import("./locales/en-US"),
  "ja-JP": () => import("./locales/ja-JP"),
  "ko-KR": () => import("./locales/ko-KR"),
  "ru-RU": () => import("./locales/ru-RU"),
  "de-DE": () => import("./locales/de-DE"),
  "vi-VN": () => import("./locales/vi-VN"),
  "es-ES": () => import("./locales/es-ES"),
  "pt-BR": () => import("./locales/pt-BR"),
  "fr-FR": () => import("./locales/fr-FR"),
  "id-ID": () => import("./locales/id-ID"),
};

async function loadDict(locale: Locale): Promise<TranslationDict> {
  const cached = dictCache.get(locale);
  if (cached) return cached;
  const mod = await dictLoaders[locale]();
  dictCache.set(locale, mod.default);
  return mod.default;
}


function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

interface I18nContextValue {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: (key: TranslationKey) => key,
  setLocale: () => {},
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export type { TranslationKey };

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const storeLocale = usePreferenceStore((s) => s.locale);
  const setStoreLocale = usePreferenceStore((s) => s.setLocale);
  const loaded = usePreferenceStore((s) => s.loaded);
  const loadFromServer = usePreferenceStore((s) => s.loadFromServer);

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [dict, setDict] = useState<TranslationDict>(zhCN);
  const loadingRef = useRef<Locale | null>(null);

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

  useEffect(() => {
    if (locale === DEFAULT_LOCALE) {
      setDict(zhCN);
      return;
    }
    if (loadingRef.current === locale) return;
    loadingRef.current = locale;

    loadDict(locale)
      .then((loadedDict) => {
        setDict(loadedDict);
        loadingRef.current = null;
      })
      .catch(() => {
        loadingRef.current = null;
      });
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      setStoreLocale(next);
      document.documentElement.lang = next;
    },
    [setStoreLocale]
  );

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const template = dict[key] ?? zhCN[key] ?? key;
      return interpolate(template, params);
    },
    [dict]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t, setLocale }),
    [locale, t, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export default I18nProvider;
