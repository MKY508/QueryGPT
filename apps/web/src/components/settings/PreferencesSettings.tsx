"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { useThemeStore, THEMES, ThemeId } from "@/lib/stores/theme";
import { cn } from "@/lib/utils";

interface UserConfig {
  language: string;
  theme: string;
  context_rounds: number;
}

export function PreferencesSettings() {
  const [formData, setFormData] = useState<UserConfig>({
    language: "zh",
    theme: "dawn",
    context_rounds: 5,
  });
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const { theme: currentTheme, setTheme } = useThemeStore();

  // 获取当前配置
  const { data: config, isLoading } = useQuery({
    queryKey: ["user-config"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config");
      return response.data.data as UserConfig;
    },
  });

  // 更新配置
  const updateMutation = useMutation({
    mutationFn: async (data: UserConfig) => {
      const response = await api.put("/api/v1/config", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-config"] });
      setHasChanges(false);
    },
  });

  // 同步服务器配置到表单
  useEffect(() => {
    if (config) {
      setFormData({
        ...config,
        context_rounds: config.context_rounds || 5,
      });
      // 同步主题到 store
      if (config.theme && config.theme in THEMES) {
        setTheme(config.theme as ThemeId);
      }
    }
  }, [config, setTheme]);

  // 同步当前主题到表单
  useEffect(() => {
    setFormData((prev) => ({ ...prev, theme: currentTheme }));
  }, [currentTheme]);

  const handleChange = (key: keyof UserConfig, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleThemeChange = (themeId: ThemeId) => {
    setTheme(themeId);
    setFormData((prev) => ({ ...prev, theme: themeId }));
    setHasChanges(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">偏好设置</h2>
        <p className="text-sm text-muted-foreground mt-1">
          自定义您的使用体验
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* 语言设置 */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            界面语言
          </label>
          <select
            value={formData.language}
            onChange={(e) => handleChange("language", e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <p className="text-sm text-muted-foreground mt-1">
            AI 回复也将使用此语言
          </p>
        </div>

        {/* 主题设置 */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">
            界面主题
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(THEMES).map(([id, theme]) => (
              <button
                key={id}
                type="button"
                onClick={() => handleThemeChange(id as ThemeId)}
                className={cn(
                  "relative p-4 border rounded-xl text-left transition-all hover:shadow-md",
                  currentTheme === id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-input hover:border-primary/50"
                )}
              >
                {currentTheme === id && (
                  <div className="absolute top-2 right-2">
                    <Check size={16} className="text-primary" />
                  </div>
                )}
                <div className="font-medium text-foreground">{theme.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {theme.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 上下文轮数 */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            对话上下文轮数
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={formData.context_rounds}
            onChange={(e) =>
              handleChange("context_rounds", parseInt(e.target.value) || 5)
            }
            className="w-24 px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <p className="text-sm text-muted-foreground mt-1">
            AI 会记住最近 {formData.context_rounds} 轮对话作为上下文（1-20）
          </p>
        </div>

        {/* 保存按钮 */}
        <div className="pt-4 border-t border-border">
          <button
            type="submit"
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {updateMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            保存设置
          </button>
          {updateMutation.isSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-2">设置已保存</p>
          )}
          {updateMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">保存失败，请重试</p>
          )}
        </div>
      </form>
    </div>
  );
}
