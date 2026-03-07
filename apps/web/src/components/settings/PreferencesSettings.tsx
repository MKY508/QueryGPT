"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import type { AppSettings, SystemCapabilities } from "@/lib/types/api";
import { useThemeStore, THEMES, ThemeId } from "@/lib/stores/theme";
import { cn } from "@/lib/utils";

interface OptionItem {
  id: string;
  name: string;
}

const defaultSettings: AppSettings = {
  context_rounds: 5,
  default_model_id: null,
  default_connection_id: null,
  python_enabled: true,
  diagnostics_enabled: true,
  auto_repair_enabled: true,
};

function ToggleCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-secondary p-4">
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
      />
    </label>
  );
}

export function PreferencesSettings() {
  const [formData, setFormData] = useState<AppSettings>(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const { theme: currentTheme, setTheme } = useThemeStore();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const response = await api.get("/api/v1/settings");
      return response.data.data as AppSettings;
    },
  });

  const { data: capabilities } = useQuery({
    queryKey: ["system-capabilities"],
    queryFn: async () => {
      const response = await api.get("/api/v1/system/capabilities");
      return response.data.data as SystemCapabilities;
    },
  });

  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as OptionItem[];
    },
  });

  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as OptionItem[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: AppSettings) => {
      const response = await api.put("/api/v1/settings", data);
      return response.data.data as AppSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["system-capabilities"] });
      setHasChanges(false);
    },
  });

  useEffect(() => {
    if (!settings) return;
    setFormData({ ...defaultSettings, ...settings });
  }, [settings]);

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleThemeChange = (themeId: ThemeId) => {
    setTheme(themeId);
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
        <h2 className="text-lg font-semibold text-foreground">工作区设置</h2>
        <p className="mt-1 text-sm text-muted-foreground">单用户模式下的默认执行配置与能力开关。</p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-secondary p-4">
          <div className="text-xs text-muted-foreground">安装模式</div>
          <div className="mt-2 text-sm font-medium text-foreground">{capabilities?.install_profile || "core"}</div>
        </div>
        <div className="rounded-xl border border-border bg-secondary p-4">
          <div className="text-xs text-muted-foreground">Python 能力</div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {capabilities?.available_python_libraries?.join(", ") || "pandas, numpy, matplotlib"}
          </div>
          {capabilities?.missing_optional_libraries?.length ? (
            <div className="mt-2 text-xs text-muted-foreground">
              可选扩展未安装: {capabilities.missing_optional_libraries.join(", ")}
            </div>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <label className="mb-3 block text-sm font-medium text-foreground">界面主题</label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(THEMES).map(([id, theme]) => (
              <button
                key={id}
                type="button"
                onClick={() => handleThemeChange(id as ThemeId)}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition-all hover:shadow-md",
                  currentTheme === id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-input hover:border-primary/50"
                )}
              >
                {currentTheme === id && (
                  <div className="absolute right-2 top-2">
                    <Check size={16} className="text-primary" />
                  </div>
                )}
                <div className="font-medium text-foreground">{theme.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{theme.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">对话上下文轮数</label>
          <input
            type="number"
            min={1}
            max={20}
            value={formData.context_rounds}
            onChange={(e) => handleChange("context_rounds", parseInt(e.target.value, 10) || 5)}
            className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1 text-sm text-muted-foreground">新对话默认带入最近 1-20 轮上下文。</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">默认模型</label>
            <select
              value={formData.default_model_id || ""}
              onChange={(e) => handleChange("default_model_id", e.target.value || null)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
            >
              <option value="">跟随模型页默认项</option>
              {models?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">默认数据库连接</label>
            <select
              value={formData.default_connection_id || ""}
              onChange={(e) => handleChange("default_connection_id", e.target.value || null)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
            >
              <option value="">跟随连接页默认项</option>
              {connections?.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4">
          <ToggleCard
            title="启用 Python 分析"
            description="允许模型返回 Python 代码并在结果页展示 Python 输出与图表。"
            checked={formData.python_enabled}
            onChange={(value) => handleChange("python_enabled", value)}
          />
          <ToggleCard
            title="启用自动修复"
            description="SQL 或 Python 失败时，允许 agent 在同一轮内自动修正并继续。"
            checked={formData.auto_repair_enabled}
            onChange={(value) => handleChange("auto_repair_enabled", value)}
          />
          <ToggleCard
            title="启用开发者诊断"
            description="在聊天结果中展示 provider、连接、尝试轨迹和错误分类。"
            checked={formData.diagnostics_enabled}
            onChange={(value) => handleChange("diagnostics_enabled", value)}
          />
        </div>

        <div className="border-t border-border pt-4">
          <button
            type="submit"
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            保存设置
          </button>
          {updateMutation.isSuccess && <p className="mt-2 text-sm text-green-600">设置已保存</p>}
          {updateMutation.isError && <p className="mt-2 text-sm text-red-600">保存失败，请重试</p>}
        </div>
      </form>
    </div>
  );
}
