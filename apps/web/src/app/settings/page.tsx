"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Database, Brain, Settings as SettingsIcon, User } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { ConnectionSettings } from "@/components/settings/ConnectionSettings";
import { PreferencesSettings } from "@/components/settings/PreferencesSettings";
import { cn } from "@/lib/utils";

type TabType = "models" | "connections" | "preferences";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("models");
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // 未登录重定向
  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const tabs = [
    { id: "models" as TabType, label: "AI 模型", icon: Brain },
    { id: "connections" as TabType, label: "数据库连接", icon: Database },
    { id: "preferences" as TabType, label: "偏好设置", icon: User },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} className="text-slate-600" />
            <h1 className="text-lg font-semibold text-slate-900">设置</h1>
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
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    <tab.icon size={18} />
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content */}
          <main className="flex-1 bg-white rounded-xl border border-slate-200 p-6">
            {activeTab === "models" && <ModelSettings />}
            {activeTab === "connections" && <ConnectionSettings />}
            {activeTab === "preferences" && <PreferencesSettings />}
          </main>
        </div>
      </div>
    </div>
  );
}
