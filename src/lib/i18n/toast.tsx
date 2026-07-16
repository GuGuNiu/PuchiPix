"use client";

/**
 * i18n-aware Toast 工具
 *
 * 基于 sonner 的 toast API 封装，解决切换语言后已显示的 toast 不跟随更新的问题。
 *
 * ## 核心原理
 *
 * 传统调用 `toast.success(t("key"))` 在调用时就完成了翻译，toast 内容是静态字符串，
 * 切换语言后不会更新。
 *
 * 本封装改为将 **i18n key + params** 传递给一个 React 组件 `<ToastMessage>`，
 * 该组件内部通过 `useI18n()` 订阅 locale 变化。当 `ThemedToaster`（已订阅 `useI18n()`）
 * 因 locale 变更而重渲染时，`<Toaster>` 会重渲染其内部 toast 列表，
 * `<ToastMessage>` 随之用新 locale 重新翻译，实现 **已显示 toast 的语言实时跟随**。
 *
 * ## 智能判断
 *
 * - 第一个参数存在于 zh-CN 基准字典中 → 视为 i18n key，渲染响应式组件
 * - 否则 → 视为原始字符串（如动态错误消息），直接传递给 sonner
 *
 * ## 用法
 *
 * ```tsx
 * import { toast } from "@/lib/i18n/toast";
 *
 * // i18n key（响应式 — 切换语言后自动更新）
 * toast.success("gallery.deleted", { id: 42 });
 * toast.error("tasks.clipboardNoLinks");
 *
 * // 原始字符串（非响应式 — 用于动态消息）
 * toast.error(err.message);
 * toast.success("任务已创建");
 *
 * // 原始字符串 + sonner 选项
 * toast.warning("自定义消息", { duration: 8000 });
 * ```
 */

import { toast as sonnerToast } from "sonner";
import type { ExternalToast, ToastT } from "sonner";
import React from "react";

import { useI18n } from "./index";
import zhCN from "./locales/zh-CN";

const baseDict = zhCN;

/**
 * 判断字符串是否为已注册的 i18n key
 */
function isI18nKey(s: unknown): s is string {
  return typeof s === "string" && s in baseDict;
}

/**
 * 响应式 Toast 消息组件
 *
 * 在 toast 内部渲染，通过 useI18n() 订阅 locale 变化，
 * 当语言切换时自动重新翻译。
 */
function ToastMessage({
  k,
  params,
}: {
  k: string;
  params?: Record<string, string | number>;
}): React.JSX.Element {
  const { t } = useI18n();
  return <>{t(k, params)}</>;
}

type ToastParams = Record<string, string | number>;

/**
 * 创建 i18n-aware 的 toast 方法
 *
 * - message 是已注册 i18n key → 第二参数视为插值 params，渲染响应式组件
 * - message 是原始字符串 → 第二参数视为 sonner 选项，直接传递
 */
function createMethod(
  type: "success" | "error" | "info" | "warning" | "loading",
): (message: string, paramsOrOptions?: ToastParams | ExternalToast) => string | number {
  return (message: string, paramsOrOptions?: ToastParams | ExternalToast) => {
    if (isI18nKey(message)) {
      // i18n key 模式 — 渲染响应式组件，paramsOrOptions 作为插值参数
      const element = React.createElement(ToastMessage, {
        k: message,
        params: paramsOrOptions as ToastParams | undefined,
      });
      return sonnerToast[type](element as React.ReactNode);
    }
    // 原始字符串模式 — 直接传递给 sonner，paramsOrOptions 作为 sonner 选项
    return sonnerToast[type](
      message as React.ReactNode,
      paramsOrOptions as ExternalToast | undefined,
    );
  };
}

export const toast = {
  ...sonnerToast,
  success: createMethod("success"),
  error: createMethod("error"),
  info: createMethod("info"),
  warning: createMethod("warning"),
  loading: createMethod("loading"),
};

export type { ExternalToast, ToastT };
