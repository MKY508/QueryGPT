"use client";

import { useState } from "react";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { useAuthStore } from "@/lib/stores/auth";

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isAuthenticated, isHydrated } = useAuthStore();

  // 等待 hydration 完成，避免闪烁
  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // 如果未登录，显示登录页面
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-primary/20">
        <div className="w-full max-w-md p-8 bg-background rounded-2xl shadow-xl border border-border">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground">QueryGPT</h1>
            <p className="text-muted-foreground mt-2">自然语言数据库查询助手</p>
          </div>
          <LoginForm />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <ChatArea sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login, register } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">{error}</div>
      )}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">邮箱</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2 border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          placeholder="your@email.com"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          placeholder="••••••••"
          required
          minLength={8}
        />
        {isRegister && (
          <p className="text-xs text-muted-foreground mt-1">至少 8 位，需包含字母和数字</p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? "处理中..." : isRegister ? "注册" : "登录"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? "已有账号？" : "没有账号？"}
        <button
          type="button"
          onClick={() => setIsRegister(!isRegister)}
          className="text-primary hover:underline ml-1"
        >
          {isRegister ? "登录" : "注册"}
        </button>
      </p>
    </form>
  );
}
