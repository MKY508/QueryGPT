"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/stores/theme";

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
      // 移除所有主题类
      root.className = root.className.replace(/theme-\w+/g, "").trim();
      // 添加新主题类
      root.classList.add(`theme-${theme}`);
    }
  }, [theme]);

  return <>{children}</>;
}
