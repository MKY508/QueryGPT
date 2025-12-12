"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, Pencil, X, BookOpen } from "lucide-react";
import { api } from "@/lib/api/client";

interface SemanticTerm {
  id: string;
  term: string;
  expression: string;
  term_type: string;
  connection_id?: string;
  description?: string;
  examples: string[];
  is_active: boolean;
  created_at: string;
}

interface TermFormData {
  term: string;
  expression: string;
  term_type: string;
  connection_id: string;
  description: string;
  examples: string;
}

const TERM_TYPES = [
  { value: "metric", label: "指标", description: "可计算的数值，如销售额、订单数" },
  { value: "dimension", label: "维度", description: "分组依据，如地区、时间" },
  { value: "filter", label: "筛选条件", description: "常用的过滤条件" },
  { value: "alias", label: "别名", description: "表或字段的别名映射" },
];

const initialFormData: TermFormData = {
  term: "",
  expression: "",
  term_type: "metric",
  connection_id: "",
  description: "",
  examples: "",
};

export function SemanticSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TermFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // 获取术语列表
  const { data: terms, isLoading } = useQuery({
    queryKey: ["semantic-terms"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/semantic/terms");
      return response.data.data as SemanticTerm[];
    },
  });

  // 获取数据库连接列表（用于关联）
  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as { id: string; name: string }[];
    },
  });

  // 添加术语
  const addMutation = useMutation({
    mutationFn: async (data: TermFormData) => {
      const payload = {
        term: data.term,
        expression: data.expression,
        term_type: data.term_type,
        connection_id: data.connection_id || null,
        description: data.description || null,
        examples: data.examples ? data.examples.split("\n").filter(Boolean) : [],
      };
      const response = await api.post("/api/v1/config/semantic/terms", payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["semantic-terms"] });
      resetForm();
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "添加术语失败");
    },
  });

  // 更新术语
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TermFormData }) => {
      const payload = {
        term: data.term,
        expression: data.expression,
        term_type: data.term_type,
        connection_id: data.connection_id || null,
        description: data.description || null,
        examples: data.examples ? data.examples.split("\n").filter(Boolean) : [],
      };
      const response = await api.put(`/api/v1/config/semantic/terms/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["semantic-terms"] });
      resetForm();
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "更新术语失败");
    },
  });

  // 删除术语
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/semantic/terms/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["semantic-terms"] });
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "删除术语失败");
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
    setError(null);
  };

  const handleEdit = (term: SemanticTerm) => {
    setEditingId(term.id);
    setFormData({
      term: term.term,
      expression: term.expression,
      term_type: term.term_type,
      connection_id: term.connection_id || "",
      description: term.description || "",
      examples: term.examples.join("\n"),
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
    if (confirm("确定要删除这个术语吗？")) {
      deleteMutation.mutate(id);
    }
  };

  const isSubmitting = addMutation.isPending || updateMutation.isPending;

  const getTermTypeLabel = (type: string) => {
    return TERM_TYPES.find((t) => t.value === type)?.label || type;
  };

  const getTermTypeColor = (type: string) => {
    switch (type) {
      case "metric":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "dimension":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "filter":
        return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
      case "alias":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">语义层配置</h2>
          <p className="text-sm text-muted-foreground mt-1">
            定义业务术语，让 AI 更好地理解你的数据
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} />
          添加术语
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between">
          <span className="text-sm text-destructive">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/60 hover:text-destructive">
            <X size={16} />
          </button>
        </div>
      )}

      {/* 添加/编辑表单 */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 p-4 bg-secondary rounded-lg border border-border"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-foreground">
              {editingId ? "编辑术语" : "添加术语"}
            </h3>
            <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                术语名称 *
              </label>
              <input
                type="text"
                value={formData.term}
                onChange={(e) => setFormData({ ...formData, term: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder="例如: 月活用户、GMV"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                术语类型
              </label>
              <select
                value={formData.term_type}
                onChange={(e) => setFormData({ ...formData, term_type: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
              >
                {TERM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} - {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">
                SQL 表达式 *
              </label>
              <input
                type="text"
                value={formData.expression}
                onChange={(e) => setFormData({ ...formData, expression: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-sm focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder="例如: COUNT(DISTINCT user_id) 或 SUM(order_amount)"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                关联数据库 (可选)
              </label>
              <select
                value={formData.connection_id}
                onChange={(e) => setFormData({ ...formData, connection_id: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
              >
                <option value="">全局（所有数据库）</option>
                {connections?.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                描述 (可选)
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder="术语的详细说明"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">
                使用示例 (可选，每行一个)
              </label>
              <textarea
                value={formData.examples}
                onChange={(e) => setFormData({ ...formData, examples: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder="查询本月的月活用户&#10;按地区统计月活"
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
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

      {/* 术语列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      ) : terms && terms.length > 0 ? (
        <div className="space-y-3">
          {terms.map((term) => (
            <div
              key={term.id}
              className="p-4 bg-secondary rounded-lg border border-border"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground">{term.term}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${getTermTypeColor(term.term_type)}`}>
                      {getTermTypeLabel(term.term_type)}
                    </span>
                  </div>
                  <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded font-mono">
                    {term.expression}
                  </code>
                  {term.description && (
                    <p className="text-sm text-muted-foreground mt-2">{term.description}</p>
                  )}
                  {term.examples.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <BookOpen size={12} />
                      <span>示例: {term.examples.slice(0, 2).join(", ")}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button
                    onClick={() => handleEdit(term)}
                    className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="编辑"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(term.id)}
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
          <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
          <p>暂无语义术语</p>
          <p className="text-sm mt-1">添加业务术语，让 AI 更懂你的数据</p>
        </div>
      )}
    </div>
  );
}
