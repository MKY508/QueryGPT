"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Star, Loader2, CheckCircle, XCircle, Play, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Connection {
  id: string;
  name: string;
  driver: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  is_default: boolean;
  created_at: string;
}

interface ConnectionFormData {
  name: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  is_default: boolean;
}

const DRIVERS = [
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "sqlite", label: "SQLite", defaultPort: 0 },
];

const defaultFormData: ConnectionFormData = {
  name: "",
  driver: "mysql",
  host: "localhost",
  port: 3306,
  database: "",
  username: "",
  password: "",
  is_default: false,
};

export function ConnectionSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState<ConnectionFormData>(defaultFormData);
  const queryClient = useQueryClient();

  // 获取连接列表
  const { data: connections, isLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as Connection[];
    },
  });

  // 添加连接
  const addMutation = useMutation({
    mutationFn: async (data: ConnectionFormData) => {
      const response = await api.post("/api/v1/config/connections", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      resetForm();
    },
  });

  // 更新连接
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ConnectionFormData }) => {
      const response = await api.put(`/api/v1/config/connections/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      resetForm();
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(defaultFormData);
  };

  // 删除连接
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  // 测试连接
  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/v1/config/connections/${id}/test`);
      return { id, ...response.data.data };
    },
    onSuccess: (data) => {
      setTestResult({
        id: data.id,
        success: data.connected,
        message: data.message,
      });
      setTimeout(() => setTestResult(null), 5000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  const handleEdit = (conn: Connection) => {
    setEditingId(conn.id);
    setFormData({
      name: conn.name,
      driver: conn.driver,
      host: conn.host,
      port: conn.port,
      database: conn.database_name,
      username: conn.username,
      password: "", // 密码不回显，留空表示不修改
      is_default: conn.is_default,
    });
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("确定要删除这个数据库连接吗？")) {
      deleteMutation.mutate(id);
    }
  };

  const handleDriverChange = (driver: string) => {
    const driverInfo = DRIVERS.find((d) => d.value === driver);
    setFormData({
      ...formData,
      driver,
      port: driverInfo?.defaultPort || 3306,
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">数据库连接</h2>
          <p className="text-sm text-muted-foreground mt-1">
            配置要查询的数据库连接
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} />
          添加连接
        </button>
      </div>

      {/* 添加/编辑表单 */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 p-4 bg-secondary rounded-lg border border-border"
        >
          <h3 className="text-sm font-medium text-foreground mb-4">
            {editingId ? "编辑连接" : "添加连接"}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                连接名称
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder="例如: 生产数据库"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                数据库类型
              </label>
              <select
                value={formData.driver}
                onChange={(e) => handleDriverChange(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
              >
                {DRIVERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            {formData.driver !== "sqlite" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    主机地址
                  </label>
                  <input
                    type="text"
                    value={formData.host}
                    onChange={(e) =>
                      setFormData({ ...formData, host: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                    placeholder="localhost"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    端口
                  </label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) =>
                      setFormData({ ...formData, port: parseInt(e.target.value) })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                    required
                  />
                </div>
              </>
            )}
            <div className={formData.driver === "sqlite" ? "col-span-2" : ""}>
              <label className="block text-sm font-medium text-foreground mb-1">
                {formData.driver === "sqlite" ? "数据库文件路径" : "数据库名"}
              </label>
              <input
                type="text"
                value={formData.database}
                onChange={(e) =>
                  setFormData({ ...formData, database: e.target.value })
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder={formData.driver === "sqlite" ? "/path/to/database.db" : "mydb"}
                required
              />
            </div>
            {formData.driver !== "sqlite" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData({ ...formData, username: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                    placeholder="root"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    密码
                    {editingId && (
                      <span className="text-muted-foreground font-normal ml-2">
                        （留空保持不变）
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                    placeholder={editingId ? "留空保持原密码" : "••••••••"}
                  />
                </div>
              </>
            )}
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) =>
                    setFormData({ ...formData, is_default: e.target.checked })
                  }
                  className="w-4 h-4 text-primary rounded focus:ring-ring"
                />
                <span className="text-sm text-foreground">设为默认连接</span>
              </label>
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
              disabled={addMutation.isPending || updateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm"
            >
              {(addMutation.isPending || updateMutation.isPending) && (
                <Loader2 size={16} className="animate-spin" />
              )}
              {editingId ? "更新" : "保存"}
            </button>
          </div>
        </form>
      )}

      {/* 连接列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      ) : connections && connections.length > 0 ? (
        <div className="space-y-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center justify-between p-4 bg-secondary rounded-lg border border-border"
            >
              <div className="flex items-center gap-3">
                {conn.is_default && (
                  <Star size={16} className="text-yellow-500 fill-yellow-500" />
                )}
                <div>
                  <div className="font-medium text-foreground">{conn.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {conn.driver}://{conn.username}@{conn.host}:{conn.port}/{conn.database_name}
                  </div>
                  {testResult?.id === conn.id && (
                    <div
                      className={cn(
                        "flex items-center gap-1 text-sm mt-1",
                        testResult.success ? "text-green-600" : "text-destructive"
                      )}
                    >
                      {testResult.success ? (
                        <CheckCircle size={14} />
                      ) : (
                        <XCircle size={14} />
                      )}
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testMutation.mutate(conn.id)}
                  disabled={testMutation.isPending}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  title="测试连接"
                >
                  {testMutation.isPending && testMutation.variables === conn.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                </button>
                <button
                  onClick={() => handleEdit(conn)}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  title="编辑"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(conn.id)}
                  disabled={deleteMutation.isPending}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>暂无数据库连接</p>
          <p className="text-sm mt-1">点击上方按钮添加第一个连接</p>
        </div>
      )}
    </div>
  );
}
