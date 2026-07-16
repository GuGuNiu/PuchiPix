/**
 * 服务端 i18n 模块
 *
 * 为 API 路由和后端服务提供国际化支持，与客户端 React Context 方案互补。
 *
 * ## 核心特性
 *
 * 1. **模块级 locale 状态** — 默认 zh-CN，可通过 `setServerLocale()` 切换
 * 2. **`t()` 翻译函数** — 与客户端 `t()` 签名一致，支持 `{param}` 插值
 * 3. **`logT()` 日志翻译** — 专门用于日志消息模板
 * 4. **三级回退** — 当前语言 → zh-CN 基准 → 返回 key 本身
 * 5. **线程安全** — 模块级单例，适合 Node.js 单线程模型
 *
 * ## 用法
 *
 * ```typescript
 * import { t, setServerLocale, getServerLocale } from "@/lib/i18n/server";
 *
 * // 在 API 路由中根据请求头设置语言
 * export async function GET(request: NextRequest) {
 *   setServerLocaleFromRequest(request);
 *   return NextResponse.json({ error: t("api.galleryNotFound") });
 * }
 *
 * // 在后端服务中直接使用
 * console.log(t("log.taskCancelled", { id: 42 }));
 * ```
 */

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

/**
 * 插值：将 {param} 替换为实际值（与客户端逻辑一致）
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/** 模块级 locale 状态 */
let serverLocale: Locale = DEFAULT_LOCALE;

/**
 * 设置服务端 locale
 *
 * 在 API 路由中根据请求头或客户端传递的 locale 参数调用。
 */
export function setServerLocale(locale: Locale): void {
  if (locale in LOCALE_MAP) {
    serverLocale = locale;
  }
}

/**
 * 获取当前服务端 locale
 */
export function getServerLocale(): Locale {
  return serverLocale;
}

/**
 * 从 Accept-Language 头推断 locale
 */
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
  }

  return DEFAULT_LOCALE;
}

/**
 * 从自定义请求头 `X-Locale` 读取 locale（前端切换语言后发送）
 */
export function localeFromHeader(headerValue: string | null): Locale | null {
  if (!headerValue) return null;
  if (headerValue in LOCALE_MAP) return headerValue as Locale;
  return null;
}

/**
 * 服务端翻译函数
 *
 * 签名与客户端 `useI18n().t` 一致，支持 `{param}` 插值和三级回退。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = LOCALE_MAP[serverLocale] ?? LOCALE_MAP[DEFAULT_LOCALE];
  const template = dict[key] ?? LOCALE_MAP[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

/**
 * 日志翻译函数
 *
 * 与 `t()` 功能相同，语义上用于日志消息模板。
 */
export function logT(key: string, params?: Record<string, string | number>): string {
  return t(key, params);
}

/**
 * 根据请求设置服务端 locale
 *
 * 优先级：`X-Locale` 自定义头 > `Accept-Language` 标准头 > 默认 zh-CN
 *
 * 在 API 路由入口调用一次即可，后续 `t()` 调用自动使用该 locale。
 */
export function setServerLocaleFromHeaders(headers: {
  get(name: string): string | null;
}): void {
  // 优先使用前端发送的自定义 locale 头
  const customLocale = localeFromHeader(headers.get("x-locale"));
  if (customLocale) {
    setServerLocale(customLocale);
    return;
  }

  // 回退到 Accept-Language
  const acceptLang = headers.get("accept-language");
  setServerLocale(localeFromAcceptHeader(acceptLang));
}

export default {
  t,
  logT,
  setServerLocale,
  getServerLocale,
  setServerLocaleFromHeaders,
  localeFromAcceptHeader,
  localeFromHeader,
};
