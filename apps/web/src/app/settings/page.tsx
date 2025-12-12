"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Database, Brain, Settings as SettingsIcon, User, BookOpen, GitBranch, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth";
import { api } from "@/lib/api/client";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { ConnectionSettings } from "@/components/settings/ConnectionSettings";
import { PreferencesSettings } from "@/components/settings/PreferencesSettings";
import { SemanticSettings } from "@/components/settings/SemanticSettings";
import { SchemaSettings } from "@/components/settings/SchemaSettings";
import { cn } from "@/lib/utils";

interface Connection {
  id: string;
  name: string;
  is_default: boolean;
}

type TabType = "models" | "connections" | "schema" | "semantic" | "preferences";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("models");
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // 未登录重定向 - 使用 useEffect 避免渲染时调用 setState
  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, router]);

  // 用于 SchemaSettings 的连接 ID 状态 - 必须在条件返回之前
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

  // 获取连接列表，自动选择默认连接
  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as Connection[];
    },
    enabled: isAuthenticated,
  });

  // 自动选择默认连接
  useEffect(() => {
    if (connections && connections.length > 0 && !selectedConnectionId) {
      const defaultConn = connections.find((c) => c.is_default);
      if (defaultConn) {
        setSelectedConnectionId(defaultConn.id);
      } else {
        setSelectedConnectionId(connections[0].id);
      }
    }
  }, [connections, selectedConnectionId]);

  if (!isAuthenticated) {
    return null;
  }

  const tabs = [
    { id: "models" as TabType, label: "AI 模型", icon: Brain },
    { id: "connections" as TabType, label: "数据库连接", icon: Database },
    { id: "schema" as TabType, label: "表关系", icon: GitBranch },
    { id: "semantic" as TabType, label: "语义层", icon: BookOpen },
    { id: "preferences" as TabType, label: "偏好设置", icon: User },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-background border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} className="text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">设置</h1>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar */}
          <nav className="w-48 flex-shrink-0">
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                      activeTab === tab.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <tab.icon size={18} />
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>

            {/* 关于链接 */}
            <div className="mt-6 pt-6 border-t border-border">
              <button
                onClick={() => router.push("/about")}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <Info size={18} />
                关于
              </button>
            </div>
          </nav>

          {/* Content */}
          <main className="flex-1 bg-background rounded-xl border border-border p-6">
            {activeTab === "models" && <ModelSettings />}
            {activeTab === "connections" && <ConnectionSettings onSelectConnection={setSelectedConnectionId} />}
            {activeTab === "schema" && <SchemaSettings connectionId={selectedConnectionId} />}
            {activeTab === "semantic" && <SemanticSettings />}
            {activeTab === "preferences" && <PreferencesSettings />}
          </main>
        </div>
      </div>
    </div>
  );
}
