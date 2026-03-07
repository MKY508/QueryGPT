"use client";

import {
  CheckCircle,
  Loader2,
  Pencil,
  Play,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ConfiguredModel } from "@/lib/types/api";
import type { ModelTestResult } from "@/lib/settings/models";

interface ModelSettingsListProps {
  models: ConfiguredModel[];
  isLoading: boolean;
  testResult: ModelTestResult | null;
  testingModelId: string | undefined;
  deletePending: boolean;
  onTest: (id: string) => void;
  onEdit: (model: ConfiguredModel) => void;
  onDelete: (id: string) => void;
}

export function ModelSettingsList({
  models,
  isLoading,
  testResult,
  testingModelId,
  deletePending,
  onTest,
  onEdit,
  onDelete,
}: ModelSettingsListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!models.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>暂无模型配置</p>
        <p className="text-sm mt-1">先选择一个适配预设，再添加第一个模型</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {models.map((model) => (
        <div
          key={model.id}
          data-testid={`model-card-${model.id}`}
          className="rounded-2xl border border-border bg-secondary p-4"
        >
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
                onClick={() => onTest(model.id)}
                disabled={testingModelId === model.id}
                data-testid={`model-test-${model.id}`}
                className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                title="测试连接"
              >
                {testingModelId === model.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
              </button>
              <button
                onClick={() => onEdit(model)}
                className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                title="编辑"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => onDelete(model.id)}
                disabled={deletePending}
                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                title="删除"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {testResult?.id === model.id && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              {testResult.success ? (
                <CheckCircle size={16} className="text-green-600" />
              ) : (
                <XCircle size={16} className="text-destructive" />
              )}
              <span className="text-muted-foreground">{testResult.message}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
