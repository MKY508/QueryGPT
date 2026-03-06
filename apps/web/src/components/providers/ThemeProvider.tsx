"use client";

import { useEffect } from "react";
import { THEMES, useThemeStore } from "@/lib/stores/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const initTheme = useThemeStore((state) => state.initTheme);

  // 初始化时应用主题
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // 主题变化时重新应用
  useEffect(() => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      Object.keys(THEMES).forEach((themeName) => {
        root.classList.remove(`theme-${themeName}`);
      });
      root.classList.add(`theme-${theme}`);
    }
  }, [theme]);

  return <>{children}</>;
}
