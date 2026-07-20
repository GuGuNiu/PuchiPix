"use client";

import { useEffect } from "react";
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

export function HlsScriptLoader(): null {
  useEffect(() => {
    if (window.Hls) return;

    const script = document.createElement("script");
    script.src = "/vendor/hls.min.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return null;
}
