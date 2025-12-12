"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Star, Loader2, Pencil, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Model {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url?: string;
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
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama (本地)" },
  { value: "custom", label: "自定义" },
];

const initialFormData: ModelFormData = {
  name: "",
  provider: "openai",
  model_id: "gpt-4o",
  base_url: "",
  api_key: "",
  is_default: false,
};

export function ModelSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // 获取模型列表
  const { data: models, isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as Model[];
    },
  });

  // 添加模型
  const addMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const response = await api.post("/api/v1/config/models", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      resetForm();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || "添加模型失败，请检查配置");
    },
  });

  // 更新模型
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ModelFormData }) => {
      const response = await api.put(`/api/v1/config/models/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      resetForm();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || "更新模型失败，请检查配置");
    },
  });

  // 删除模型
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/models/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || "删除模型失败");
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
    setError(null);
  };

  const handleEdit = (model: Model) => {
    setEditingId(model.id);
    setFormData({
      name: model.name,
      provider: model.provider,
      model_id: model.model_id,
      base_url: model.base_url || "",
      api_key: "", // API key 不回显，留空表示不修改
      is_default: model.is_default,
    });
    setShowForm(true);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

  const isSubmitting = addMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI 模型配置</h2>
          <p className="text-sm text-slate-500 mt-1">
            配置用于数据分析的 AI 模型
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus size={16} />
          添加模型
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-600">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* 添加/编辑表单 */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-slate-900">
              {editingId ? "编辑模型" : "添加模型"}
            </h3>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                名称
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例如: GPT-4o"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                提供商
              </label>
              <select
                value={formData.provider}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                模型 ID
              </label>
              <input
                type="text"
                value={formData.model_id}
                onChange={(e) =>
                  setFormData({ ...formData, model_id: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例如: gpt-4o, claude-3-opus"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Base URL (可选)
              </label>
              <input
                type="url"
                value={formData.base_url}
                onChange={(e) =>
                  setFormData({ ...formData, base_url: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                API Key {editingId && <span className="text-slate-400 font-normal">(留空则不修改)</span>}
              </label>
              <input
                type="password"
                value={formData.api_key}
                onChange={(e) =>
                  setFormData({ ...formData, api_key: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={editingId ? "••••••••" : "sk-..."}
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) =>
                    setFormData({ ...formData, is_default: e.target.checked })
                  }
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">设为默认模型</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
            >
              {isSubmitting && (
                <Loader2 size={16} className="animate-spin" />
              )}
              {editingId ? "更新" : "保存"}
            </button>
          </div>
        </form>
      )}

      {/* 模型列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      ) : models && models.length > 0 ? (
        <div className="space-y-3">
          {models.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200"
            >
              <div className="flex items-center gap-3">
                {model.is_default && (
                  <Star size={16} className="text-yellow-500 fill-yellow-500" />
                )}
                <div>
                  <div className="font-medium text-slate-900">{model.name}</div>
                  <div className="text-sm text-slate-500">
                    {model.provider} / {model.model_id}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(model)}
                  className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                  title="编辑"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(model.id)}
                  disabled={deleteMutation.isPending}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500">
          <p>暂无模型配置</p>
          <p className="text-sm mt-1">点击上方按钮添加第一个模型</p>
        </div>
      )}
    </div>
  );
}
