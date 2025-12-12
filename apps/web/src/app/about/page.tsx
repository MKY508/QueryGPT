"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Database,
  Brain,
  Zap,
  Shield,
  Github,
  Mail,
  Code2,
  Layers,
  Server,
  Palette,
} from "lucide-react";

const VERSION = "2.0.0";
const BUILD_DATE = "2024-12";

const techStack = {
  frontend: [
    { name: "Next.js 15", desc: "React 框架" },
    { name: "React 19", desc: "UI 库" },
    { name: "TypeScript", desc: "类型安全" },
    { name: "Tailwind CSS", desc: "样式系统" },
    { name: "TanStack Query", desc: "数据获取" },
    { name: "Zustand", desc: "状态管理" },
    { name: "React Flow", desc: "关系可视化" },
    { name: "Recharts", desc: "图表渲染" },
  ],
  backend: [
    { name: "FastAPI", desc: "Python Web 框架" },
    { name: "SQLAlchemy 2.0", desc: "ORM" },
    { name: "PostgreSQL", desc: "主数据库" },
    { name: "SQLite", desc: "元数据存储" },
    { name: "gptme", desc: "AI 引擎" },
    { name: "Fernet", desc: "数据加密" },
  ],
};

const features = [
  {
    icon: Brain,
    title: "自然语言查询",
    desc: "用自然语言描述需求，AI 自动生成 SQL",
  },
  {
    icon: Database,
    title: "多数据库支持",
    desc: "MySQL、PostgreSQL、SQLite 一键连接",
  },
  {
    icon: Zap,
    title: "智能图表",
    desc: "AI 根据数据自动推荐最佳可视化方案",
  },
  {
    icon: Shield,
    title: "安全加密",
    desc: "敏感信息 Fernet 加密，JWT 认证",
  },
];

export default function AboutPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm">返回</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 mb-6">
            <Database size={36} className="text-primary" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-3">QueryGPT</h1>
          <p className="text-lg text-muted-foreground mb-4">
            自然语言数据库查询助手
          </p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              v{VERSION}
            </span>
            <span className="text-muted-foreground">Build {BUILD_DATE}</span>
          </div>
        </div>

        {/* 核心特性 */}
        <section className="mb-16">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-6">
            核心特性
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-4 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors"
              >
                <feature.icon
                  size={20}
                  className="text-primary mb-3"
                />
                <h3 className="font-medium text-foreground mb-1">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 技术栈 */}
        <section className="mb-16">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-6">
            技术栈
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {/* 前端 */}
            <div className="p-5 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 mb-4">
                <Palette size={18} className="text-blue-500" />
                <h3 className="font-medium text-foreground">Frontend</h3>
              </div>
              <div className="space-y-2">
                {techStack.frontend.map((tech) => (
                  <div
                    key={tech.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground">{tech.name}</span>
                    <span className="text-muted-foreground">{tech.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 后端 */}
            <div className="p-5 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 mb-4">
                <Server size={18} className="text-green-500" />
                <h3 className="font-medium text-foreground">Backend</h3>
              </div>
              <div className="space-y-2">
                {techStack.backend.map((tech) => (
                  <div
                    key={tech.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground">{tech.name}</span>
                    <span className="text-muted-foreground">{tech.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 架构 */}
        <section className="mb-16">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-6">
            系统架构
          </h2>
          <div className="p-6 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between text-sm font-mono">
              <div className="flex flex-col items-center gap-2">
                <div className="w-24 h-16 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-blue-500">Next.js</span>
                </div>
                <span className="text-muted-foreground">Frontend</span>
              </div>
              <div className="flex-1 h-px bg-border mx-4 relative">
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
                  REST + SSE
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-24 h-16 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                  <span className="text-green-500">FastAPI</span>
                </div>
                <span className="text-muted-foreground">Backend</span>
              </div>
              <div className="flex-1 h-px bg-border mx-4 relative">
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
                  SQL
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-24 h-16 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-500">Database</span>
                </div>
                <span className="text-muted-foreground">Storage</span>
              </div>
            </div>
          </div>
        </section>

        {/* 开发者信息 */}
        <section className="mb-16">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-6">
            开发者
          </h2>
          <div className="p-6 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-2xl font-bold text-primary-foreground">
                M
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">MKY508</h3>
                <p className="text-sm text-muted-foreground">
                  Full-stack Developer
                </p>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href="https://github.com/MKY508"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="GitHub"
                >
                  <Github size={20} />
                </a>
                <a
                  href="mailto:mky369258@gmail.com"
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Email"
                >
                  <Mail size={20} />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 底部 */}
        <footer className="text-center text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Code2 size={14} />
            <span>Built with passion</span>
          </div>
          <p>© 2024 QueryGPT. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
