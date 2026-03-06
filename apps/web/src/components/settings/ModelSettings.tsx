"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  Loader2,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { ModelDiagnostics, ModelExtraOptions } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Model {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url?: string;
  extra_options?: ModelExtraOptions;
  api_key_configured?: boolean;
  is_default: boolean;
  created_at: string;
}

interface ModelFormData {
  name: string;
  provider: string;
  model_id: string;
  base_url: string;
  api_key: string;
  is_default: boolean;
  api_format: NonNullable<ModelExtraOptions["api_format"]>;
  api_key_optional: boolean;
  headersText: string;
  queryParamsText: string;
  healthcheck_mode: NonNullable<ModelExtraOptions["healthcheck_mode"]>;
}

type ModelTestResult = {
  id: string;
  success: boolean;
  message: string;
  response_time_ms?: number;
} & ModelDiagnostics;

const PRESETS: Record<
  string,
  Pick<ModelFormData, "provider" | "api_format" | "base_url" | "api_key_optional" | "healthcheck_mode">
> = {
  openai: {
    provider: "openai",
    api_format: "openai_compatible",
    base_url: "",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  deepseek: {
    provider: "deepseek",
    api_format: "openai_compatible",
    base_url: "https://api.deepseek.com",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  anthropic: {
    provider: "anthropic",
    api_format: "anthropic_native",
    base_url: "https://api.anthropic.com",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  ollama: {
    provider: "ollama",
    api_format: "ollama_local",
    base_url: "http://localhost:11434",
    api_key_optional: true,
    healthcheck_mode: "chat_completion",
  },
  custom: {
    provider: "custom",
    api_format: "openai_compatible",
    base_url: "",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
};

const initialFormData: ModelFormData = {
  name: "",
  provider: "openai",
  model_id: "gpt-4o",
  base_url: "",
  api_key: "",
  is_default: false,
  api_format: "openai_compatible",
  api_key_optional: false,
  headersText: "{}",
  queryParamsText: "{}",
  healthcheck_mode: "chat_completion",
};

function prettifyJson(value: Record<string, string> | undefined): string {
  return JSON.stringify(value || {}, null, 2);
}

function parseJsonMap(value: string, label: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    normalized[key] = String(item);
  }
  return normalized;
}

function buildPayload(formData: ModelFormData) {
  return {
    name: formData.name.trim(),
    provider: formData.provider,
    model_id: formData.model_id.trim(),
    base_url: formData.base_url.trim() || null,
    api_key: formData.api_key.trim() || null,
    is_default: formData.is_default,
    extra_options: {
      api_format: formData.api_format,
      api_key_optional: formData.api_key_optional,
      healthcheck_mode: formData.healthcheck_mode,
      headers: parseJsonMap(formData.headersText, "Headers"),
      query_params: parseJsonMap(formData.queryParamsText, "Query Params"),
    },
  };
}

export function ModelSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const queryClient = useQueryClient();

  const { data: models, isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as Model[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const response = await api.post("/api/v1/config/models", buildPayload(data));
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      resetForm();
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message || "添加模型失败，请检查配置");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ModelFormData }) => {
      const response = await api.put(`/api/v1/config/models/${id}`, buildPayload(data));
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      resetForm();
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message || "更新模型失败，请检查配置");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/models/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message || "删除模型失败");
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/v1/config/models/${id}/test`);
      return { id, ...response.data.data } as ModelTestResult;
    },
    onSuccess: (data) => {
      setTestResult(data);
      setTimeout(() => setTestResult(null), 8000);
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message || "测试失败");
    },
  });

  const activePreset = useMemo(() => PRESETS[formData.provider] || PRESETS.custom, [formData.provider]);
  const isSubmitting = addMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
    setError(null);
  };

  const applyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey] || PRESETS.custom;
    setFormData((prev) => ({
      ...prev,
      provider: preset.provider,
      api_format: preset.api_format,
      base_url: preset.base_url,
      api_key_optional: preset.api_key_optional,
      healthcheck_mode: preset.healthcheck_mode,
    }));
  };

  const handleEdit = (model: Model) => {
    setEditingId(model.id);
    setFormData({
      name: model.name,
      provider: model.provider,
      model_id: model.model_id,
      base_url: model.base_url || "",
      api_key: "",
      is_default: model.is_default,
      api_format: model.extra_options?.api_format || PRESETS[model.provider]?.api_format || "openai_compatible",
      api_key_optional: model.extra_options?.api_key_optional || model.provider === "ollama",
      headersText: prettifyJson(model.extra_options?.headers),
      queryParamsText: prettifyJson(model.extra_options?.query_params),
      healthcheck_mode: model.extra_options?.healthcheck_mode || "chat_completion",
    });
    setShowForm(true);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      buildPayload(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "高级参数格式错误");
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个模型配置吗？")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">AI 模型配置</h2>
          <p className="text-sm text-muted-foreground mt-1">
            统一管理 OpenAI-compatible、Anthropic、Ollama 与自定义网关
          </p>
        </div>
        <button
          onClick={() => setShowForm((prev) => !prev)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} />
          添加模型
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setShowForm(true);
              applyPreset(key);
            }}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              formData.provider === preset.provider && showForm
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:border-primary/40"
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles size={14} className="text-primary" />
              {key === "openai" && "OpenAI 官方"}
              {key === "deepseek" && "DeepSeek / OpenAI-Compatible"}
              {key === "anthropic" && "Anthropic 原生"}
              {key === "ollama" && "Ollama 本地模型"}
              {key === "custom" && "自定义网关"}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {preset.api_format === "anthropic_native" && "使用 Anthropic 原生协议"}
              {preset.api_format === "ollama_local" && "本地模型，可选 API Key"}
              {preset.api_format === "openai_compatible" && "兼容 OpenAI 接口规范"}
            </p>
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between">
          <span className="text-sm text-destructive">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/60 hover:text-destructive">
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-secondary p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-foreground">{editingId ? "编辑模型" : "添加模型"}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                当前适配格式：{activePreset.api_format}
              </p>
            </div>
            <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                placeholder="例如: DeepSeek V3"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Provider 标签</label>
              <select
                value={formData.provider}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
              >
                {Object.keys(PRESETS).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">模型 ID</label>
              <input
                type="text"
                value={formData.model_id}
                onChange={(e) => setFormData({ ...formData, model_id: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                placeholder="例如: gpt-4o / deepseek-chat / llama3.1"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">适配格式</label>
              <select
                value={formData.api_format}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    api_format: e.target.value as ModelFormData["api_format"],
                  })
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
              >
                <option value="openai_compatible">openai_compatible</option>
                <option value="anthropic_native">anthropic_native</option>
                <option value="ollama_local">ollama_local</option>
                <option value="custom">custom</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">Base URL</label>
              <input
                type="url"
                value={formData.base_url}
                onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">
                API Key {editingId && <span className="text-muted-foreground font-normal">(留空则不修改)</span>}
              </label>
              <input
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                placeholder={formData.api_key_optional ? "本地模型可留空" : "sk-..."}
              />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={formData.api_key_optional}
                  onChange={(e) => setFormData({ ...formData, api_key_optional: e.target.checked })}
                  className="w-4 h-4 text-primary rounded"
                />
                允许不配置 API Key
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="w-4 h-4 text-primary rounded"
                />
                设为默认模型
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">健康检查方式</label>
              <select
                value={formData.healthcheck_mode}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    healthcheck_mode: e.target.value as ModelFormData["healthcheck_mode"],
                  })
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
              >
                <option value="chat_completion">chat_completion</option>
                <option value="models_list">models_list</option>
              </select>
            </div>
            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">附加 Headers</label>
                <textarea
                  value={formData.headersText}
                  onChange={(e) => setFormData({ ...formData, headersText: e.target.value })}
                  className="h-32 w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">附加 Query Params</label>
                <textarea
                  value={formData.queryParamsText}
                  onChange={(e) => setFormData({ ...formData, queryParamsText: e.target.value })}
                  className="h-32 w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg transition-colors text-sm"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {editingId ? "更新" : "保存"}
            </button>
          </div>
        </form>
      )}

      {testResult && (
        <div className="rounded-2xl border border-border bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {testResult.success ? (
              <CheckCircle size={16} className="text-green-600" />
            ) : (
              <XCircle size={16} className="text-destructive" />
            )}
            最近一次诊断
          </div>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <div>结果: <span className="text-foreground">{testResult.message}</span></div>
            <div>耗时: <span className="text-foreground">{testResult.response_time_ms || "-"} ms</span></div>
            <div>解析 Provider: <span className="text-foreground">{testResult.resolved_provider || "-"}</span></div>
            <div>API 格式: <span className="text-foreground">{testResult.api_format || "-"}</span></div>
            <div className="md:col-span-2">
              Base URL: <span className="text-foreground">{testResult.resolved_base_url || "-"}</span>
            </div>
            {!testResult.success && (
              <div className="md:col-span-2">
                错误分类: <span className="text-foreground">{testResult.error_category || "unknown"}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      ) : models && models.length > 0 ? (
        <div className="space-y-3">
          {models.map((model) => (
            <div key={model.id} className="rounded-2xl border border-border bg-secondary p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {model.is_default && <Star size={16} className="text-yellow-500 fill-yellow-500" />}
                    <div className="font-medium text-foreground">{model.name}</div>
                    {model.api_key_configured ? (
                      <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-700">
                        Key 已配置
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                        Key 未配置
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {model.provider} / {model.model_id}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-background px-2 py-1 text-muted-foreground border border-border">
                      {model.extra_options?.api_format || "openai_compatible"}
                    </span>
                    {model.base_url && (
                      <span className="rounded-full bg-background px-2 py-1 text-muted-foreground border border-border">
                        {model.base_url}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => testMutation.mutate(model.id)}
                    disabled={testMutation.isPending}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="测试连接"
                  >
                    {testMutation.isPending && testMutation.variables === model.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <button
                    onClick={() => handleEdit(model)}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="编辑"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(model.id)}
                    disabled={deleteMutation.isPending}
                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>暂无模型配置</p>
          <p className="text-sm mt-1">先选择一个适配预设，再添加第一个模型</p>
        </div>
      )}
    </div>
  );
}
