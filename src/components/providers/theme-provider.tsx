"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { usePreferenceStore, type Theme } from "@/store/preference-store";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const theme = usePreferenceStore((s) => s.theme);
  const setTheme = usePreferenceStore((s) => s.setTheme);
  const loaded = usePreferenceStore((s) => s.loaded);
  const loadFromServer = usePreferenceStore((s) => s.loadFromServer);

  useEffect(() => {
    loadFromServer();
  }, [loadFromServer]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme }),
    [theme, toggleTheme]
  );

  // 在服务端渲染和客户端加载前，避免闪烁：先用 cookie 中的 theme 初始化
  // 此处 Provider 本身不阻塞渲染，由全局 CSS [data-theme] 处理
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
