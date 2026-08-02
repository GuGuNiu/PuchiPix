"use client";

import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";
import { useI18n } from "@/lib/i18n";

export function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme();
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
