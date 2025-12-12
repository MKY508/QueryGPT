"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import { useThemeStore } from "@/lib/stores/theme";

interface UserConfig {
  language: string;
  theme: string;
  view_mode: string;
  context_rounds: number;
}

export function PreferencesSettings() {
  const [formData, setFormData] = useState<UserConfig>({
    language: "zh",
    theme: "light",
    view_mode: "user",
    context_rounds: 3,
  });
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const setTheme = useThemeStore((state) => state.setTheme);

  // 获取当前配置
  const { data: config, isLoading } = useQuery({
    queryKey: ["user-config"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/config");
      return response.data.data as UserConfig;
    },
  });

  // 更新配置
  const updateMutation = useMutation({
    mutationFn: async (data: UserConfig) => {
      const response = await api.put("/api/v1/config/config", data);
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
      setFormData(config);
    }
  }, [config]);

  const handleChange = (key: keyof UserConfig, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
    // 主题更改时立即应用，让用户可以预览效果
    if (key === "theme") {
      setTheme(value as "light" | "dark" | "system");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">偏好设置</h2>
        <p className="text-sm text-slate-500 mt-1">
          自定义您的使用体验
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 语言设置 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            界面语言
          </label>
          <select
            value={formData.language}
            onChange={(e) => handleChange("language", e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <p className="text-sm text-slate-500 mt-1">
            AI 回复也将使用此语言
          </p>
        </div>

        {/* 主题设置 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            界面主题
          </label>
          <div className="flex gap-3">
            {[
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
              { value: "system", label: "跟随系统" },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer transition-colors ${
                  formData.theme === option.value
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={formData.theme === option.value}
                  onChange={(e) => handleChange("theme", e.target.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        {/* 视图模式 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            默认视图模式
          </label>
          <select
            value={formData.view_mode}
            onChange={(e) => handleChange("view_mode", e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="user">用户模式 (简洁)</option>
            <option value="developer">开发者模式 (详细)</option>
          </select>
          <p className="text-sm text-slate-500 mt-1">
            开发者模式会显示更多技术细节
          </p>
        </div>

        {/* 上下文轮数 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            对话上下文轮数
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={formData.context_rounds}
            onChange={(e) =>
              handleChange("context_rounds", parseInt(e.target.value))
            }
            className="w-24 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-sm text-slate-500 mt-1">
            AI 会记住最近 {formData.context_rounds} 轮对话作为上下文
          </p>
        </div>

        {/* 保存按钮 */}
        <div className="pt-4 border-t border-slate-200">
          <button
            type="submit"
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {updateMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            保存设置
          </button>
          {updateMutation.isSuccess && (
            <p className="text-sm text-green-600 mt-2">设置已保存</p>
          )}
        </div>
      </form>
    </div>
  );
}
