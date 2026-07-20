import type { Locale, TranslationDict } from "./types";
import { DEFAULT_LOCALE } from "./types";
import { localeFromAcceptHeader, localeFromHeader } from "./detect";
import zhCN, { type TranslationKey } from "./locales/zh-CN";
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

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

let serverLocale: Locale = DEFAULT_LOCALE;

export function setServerLocale(locale: Locale): void {
  if (locale in LOCALE_MAP) {
    serverLocale = locale;
  }
}

export function getServerLocale(): Locale {
  return serverLocale;
}


export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = LOCALE_MAP[serverLocale] ?? LOCALE_MAP[DEFAULT_LOCALE];
  const template = dict[key] ?? LOCALE_MAP[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

export function logT(key: TranslationKey, params?: Record<string, string | number>): string {
  return t(key, params);
}

export function setLocaleFromHeaders(headers: {
  get(name: string): string | null;
}): void {
  const customLocale = localeFromHeader(headers.get("x-locale"));
  if (customLocale) {
    setServerLocale(customLocale);
    return;
  }

  const acceptLang = headers.get("accept-language");
  setServerLocale(localeFromAcceptHeader(acceptLang));
}

export type { TranslationKey };

const i18nServerApi = {
  t,
  logT,
  setServerLocale,
  getServerLocale,
  setLocaleFromHeaders,
  localeFromAcceptHeader,
  localeFromHeader,
};

export default i18nServerApi;
