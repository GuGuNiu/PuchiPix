"use client";

import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";
import { useI18n } from "@/lib/i18n";

/**
 * 主题 + i18n 感知的 Toaster
 *
 * 订阅 useI18n() 确保语言切换时 <Toaster> 重渲染，
 * 使 toast 内部的响应式组件 <ToastMessage> 跟随 locale 变化重新翻译。
 */
export default function ThemedToaster(): React.JSX.Element {
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
