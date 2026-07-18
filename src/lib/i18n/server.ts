import type { Locale, TranslationDict } from "./types";
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

export function localeFromAcceptHeader(acceptLang: string | null): Locale {
  if (!acceptLang) return DEFAULT_LOCALE;

  const langs = acceptLang.split(",").map((s) => s.trim().split(";")[0]);

  for (const lang of langs) {
    if (lang.startsWith("zh")) {
      if (lang.includes("TW") || lang.includes("HK") || lang.includes("Hant")) {
        return "zh-TW";
      }
      return "zh-CN";
    }
    if (lang.startsWith("ja")) return "ja-JP";
    if (lang.startsWith("en")) return "en-US";
    if (lang.startsWith("ko")) return "ko-KR";
    if (lang.startsWith("ru")) return "ru-RU";
    if (lang.startsWith("de")) return "de-DE";
    if (lang.startsWith("vi")) return "vi-VN";
    if (lang.startsWith("es")) return "es-ES";
    if (lang.startsWith("pt")) return "pt-BR";
    if (lang.startsWith("fr")) return "fr-FR";
    if (lang.startsWith("id") || lang.startsWith("in")) return "id-ID";
  }

  return DEFAULT_LOCALE;
}

export function localeFromHeader(headerValue: string | null): Locale | null {
  if (!headerValue) return null;
  if (headerValue in LOCALE_MAP) return headerValue as Locale;
  return null;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = LOCALE_MAP[serverLocale] ?? LOCALE_MAP[DEFAULT_LOCALE];
  const template = dict[key] ?? LOCALE_MAP[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

export function logT(key: string, params?: Record<string, string | number>): string {
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

export default {
  t,
  logT,
  setServerLocale,
  getServerLocale,
  setLocaleFromHeaders,
  localeFromAcceptHeader,
  localeFromHeader,
};
