"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Plus, X, XCircle } from "lucide-react";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import { ModelSettingsList } from "@/components/settings/model-settings/ModelSettingsList";
import { useModelSettingsResource } from "@/components/settings/hooks/useModelSettingsResource";
import {
  MODEL_PRESETS,
  buildModelFormData,
  buildModelPayload,
  initialModelFormData,
  type ModelFormData,
} from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";

export function ModelSettings() {
  const {
    models,
    isLoading,
    error,
    testResult,
    isSubmitting,
    testingModelId,
    deletePending,
    clearError,
    addModel,
    updateModel,
    deleteModel,
    testModel,
  } = useModelSettingsResource();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(initialModelFormData);
  const [validationError, setValidationError] = useState<string | null>(null);
  const activePreset = useMemo(
    () => MODEL_PRESETS[formData.provider] || MODEL_PRESETS.custom,
    [formData.provider]
  );
  const displayError = validationError ?? error;

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialModelFormData);
    setValidationError(null);
    clearError();
  };

  const applyPreset = (presetKey: string) => {
    const preset = MODEL_PRESETS[presetKey] || MODEL_PRESETS.custom;
    setShowForm(true);
    setValidationError(null);
    setFormData((current) => ({
      ...current,
      provider: preset.provider,
      api_format: preset.api_format,
      base_url: preset.base_url,
      api_key_optional: preset.api_key_optional,
      healthcheck_mode: preset.healthcheck_mode,
    }));
  };

  const handleEdit = (model: ConfiguredModel) => {
    setEditingId(model.id);
    setFormData(buildModelFormData(model));
    setShowForm(true);
    setValidationError(null);
    clearError();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      buildModelPayload(formData);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "高级参数格式错误");
      return;
    }

    setValidationError(null);
    try {
      if (editingId) {
        await updateModel(editingId, formData);
        resetForm();
        return;
      }
      await addModel(formData);
      resetForm();
    } catch {
      // Error state is already handled by the resource hook.
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个模型配置吗？")) {
      deleteModel(id);
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
          onClick={() => {
            if (showForm) {
              resetForm();
              return;
            }
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} />
          添加模型
        </button>
      </div>

      {displayError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between">
          <span className="text-sm text-destructive">{displayError}</span>
          <button
            onClick={() => {
              setValidationError(null);
              clearError();
            }}
            className="text-destructive/60 hover:text-destructive"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <ModelSettingsForm
          editingId={editingId}
          formData={formData}
          activePreset={activePreset}
          isSubmitting={isSubmitting}
          onChange={setFormData}
          onPresetSelect={applyPreset}
          onReset={resetForm}
          onSubmit={handleSubmit}
        />
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
            <div>
              结果: <span className="text-foreground">{testResult.message}</span>
            </div>
            <div>
              耗时: <span className="text-foreground">{testResult.response_time_ms || "-"} ms</span>
            </div>
            <div>
              解析 Provider: <span className="text-foreground">{testResult.resolved_provider || "-"}</span>
            </div>
            <div>
              API 格式: <span className="text-foreground">{testResult.api_format || "-"}</span>
            </div>
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

      <ModelSettingsList
        models={models}
        isLoading={isLoading}
        testResult={testResult}
        testingModelId={testingModelId ?? undefined}
        deletePending={deletePending}
        onTest={testModel}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
