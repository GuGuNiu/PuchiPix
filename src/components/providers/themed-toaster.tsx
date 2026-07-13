"use client";

import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";

export default function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster richColors theme={theme} position="top-right" />;
}
