"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";
import { useI18n } from "@/lib/i18n";

/**
 * 主题 + i18n 感知的 Toaster
 *
 * 订阅 useI18n() 确保语言切换时 <Toaster> 重渲染，
 * 使 toast 内部的响应式组件 <ToastMessage> 跟随 locale 变化重新翻译。
 */
export function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme();
  // 订阅 locale 变化，切换语言时触发 Toaster 重渲染
  useI18n();
  return (
    <Toaster
      richColors
      theme={theme}
      position="bottom-right"
      toastOptions={{
        style: {
          maxWidth: "500px",
          width: "auto",
        },
      }}
    />
  );
}

/**
 * HLS.js 脚本加载器
 *
 * 在客户端通过 DOM API 注入 <script> 标签加载 HLS.js，
 * 而非使用 React <script> 元素或 next/script 组件。
 *
 * 原因：Next.js 16 (Turbopack) 不允许在 React 组件树中渲染 <script> 元素，
 * 会报 "Encountered a script tag while rendering React component" 警告。
 * 使用 document.createElement 在 React 生命周期之外注入 script 可避免此问题。
 */
export function HlsScriptLoader(): null {
  useEffect(() => {
    // 如果已加载则跳过
    if (window.Hls) return;

    const script = document.createElement("script");
    script.src = "/vendor/hls.min.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // 组件卸载时移除 script（仅当加载失败时才有意义）
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return null;
}
