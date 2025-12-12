"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// 主题定义
export const THEMES = {
  dawn: { id: "dawn", name: "晨曦", description: "清新明亮的浅色主题" },
  midnight: { id: "midnight", name: "深夜", description: "经典深色主题" },
  monet: { id: "monet", name: "莫奈", description: "印象派蓝绿色调" },
  vangogh: { id: "vangogh", name: "梵高", description: "星夜深蓝金黄" },
  sakura: { id: "sakura", name: "樱花", description: "日式粉色" },
  forest: { id: "forest", name: "森林", description: "自然绿色" },
  aurora: { id: "aurora", name: "极光", description: "北欧深色" },
} as const;

export type ThemeId = keyof typeof THEMES;

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  initTheme: () => void;
}

// 应用主题到 HTML
const applyTheme = (theme: ThemeId) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // 移除所有主题类
  Object.keys(THEMES).forEach((t) => {
    root.classList.remove(`theme-${t}`);
  });

  // 添加新主题类
  root.classList.add(`theme-${theme}`);
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dawn",

      setTheme: (theme: ThemeId) => {
        applyTheme(theme);
        set({ theme });
      },

      initTheme: () => {
        const { theme } = get();
        applyTheme(theme);
      },
    }),
    {
      name: "querygpt-theme",
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);
