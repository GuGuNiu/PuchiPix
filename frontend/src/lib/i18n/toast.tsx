import { toast as sonnerToast } from "sonner";
import type { ExternalToast } from "sonner";
import React from "react";

import { useI18n } from "./index";
import zhCN from "./locales/zh-CN";
import type { TranslationKey } from "./locales/zh-CN";

const baseDict = zhCN;

function isI18nKey(s: unknown): s is TranslationKey {
  return typeof s === "string" && s in baseDict;
}

function ToastMessage({
  k,
  params,
}: {
  k: TranslationKey;
  params?: Record<string, string | number>;
}): React.JSX.Element {
  const { t } = useI18n();
  return <>{t(k, params)}</>;
}

type ToastParams = Record<string, string | number>;

function createMethod(
  type: "success" | "error" | "info" | "warning" | "loading",
): (message: string, paramsOrOptions?: ToastParams | ExternalToast) => string | number {
  return (message: string, paramsOrOptions?: ToastParams | ExternalToast) => {
    if (isI18nKey(message)) {
      const element = React.createElement(ToastMessage, {
        k: message,
        params: paramsOrOptions as ToastParams | undefined,
      });
      return sonnerToast[type](element as React.ReactNode);
    }
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
