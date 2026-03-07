"use client";

import type { FormEvent } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MODEL_PRESETS,
  type ModelFormData,
  type ModelPreset,
} from "@/lib/settings/models";

interface ModelSettingsFormProps {
  editingId: string | null;
  formData: ModelFormData;
  activePreset: ModelPreset;
  isSubmitting: boolean;
  onChange: (next: ModelFormData) => void;
  onPresetSelect: (presetKey: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ModelSettingsForm({
  editingId,
  formData,
  activePreset,
  isSubmitting,
  onChange,
  onPresetSelect,
  onReset,
  onSubmit,
}: ModelSettingsFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      data-testid="model-form"
      className="rounded-2xl border border-border bg-secondary p-5 space-y-5"
    >
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(MODEL_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetSelect(key)}
            data-testid={`model-preset-${key}`}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              formData.provider === preset.provider
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

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-foreground">{editingId ? "编辑模型" : "添加模型"}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            当前适配格式：{activePreset.api_format}
          </p>
        </div>
        <button type="button" onClick={onReset} className="text-muted-foreground hover:text-foreground">
          <X size={18} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">名称</label>
          <input
            type="text"
            value={formData.name}
            onChange={(event) => onChange({ ...formData, name: event.target.value })}
            data-testid="model-name-input"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            placeholder="例如: DeepSeek V3"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Provider 标签</label>
          <select
            value={formData.provider}
            onChange={(event) => onPresetSelect(event.target.value)}
            data-testid="model-provider-select"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
          >
            {Object.keys(MODEL_PRESETS).map((key) => (
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
            onChange={(event) => onChange({ ...formData, model_id: event.target.value })}
            data-testid="model-id-input"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            placeholder="例如: gpt-4o / deepseek-chat / llama3.1"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">适配格式</label>
          <select
            value={formData.api_format}
            onChange={(event) =>
              onChange({
                ...formData,
                api_format: event.target.value as ModelFormData["api_format"],
              })
            }
            data-testid="model-api-format-select"
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
            onChange={(event) => onChange({ ...formData, base_url: event.target.value })}
            data-testid="model-base-url-input"
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
            onChange={(event) => onChange({ ...formData, api_key: event.target.value })}
            data-testid="model-api-key-input"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
            placeholder={formData.api_key_optional ? "本地模型可留空" : "sk-..."}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
            <input
              type="checkbox"
              checked={formData.api_key_optional}
              onChange={(event) =>
                onChange({ ...formData, api_key_optional: event.target.checked })
              }
              data-testid="model-api-key-optional-checkbox"
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
              onChange={(event) => onChange({ ...formData, is_default: event.target.checked })}
              data-testid="model-default-checkbox"
              className="w-4 h-4 text-primary rounded"
            />
            设为默认模型
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">健康检查方式</label>
          <select
            value={formData.healthcheck_mode}
            onChange={(event) =>
              onChange({
                ...formData,
                healthcheck_mode: event.target.value as ModelFormData["healthcheck_mode"],
              })
            }
            data-testid="model-healthcheck-mode-select"
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
              onChange={(event) => onChange({ ...formData, headersText: event.target.value })}
              data-testid="model-headers-textarea"
              className="h-32 w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">附加 Query Params</label>
            <textarea
              value={formData.queryParamsText}
              onChange={(event) =>
                onChange({ ...formData, queryParamsText: event.target.value })
              }
              data-testid="model-query-params-textarea"
              className="h-32 w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg transition-colors text-sm"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          data-testid="model-submit-button"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm"
        >
          {isSubmitting && <Loader2 size={16} className="animate-spin" />}
          {editingId ? "更新" : "保存"}
        </button>
      </div>
    </form>
  );
}
