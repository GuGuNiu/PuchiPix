"use client";

import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";

export default function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme();
  return <Toaster richColors theme={theme} position="bottom-right" />;
}
