"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Database,
  Gauge,
  GitBranch,
  Layers,
  Palette,
  Shield,
} from "lucide-react";

const VERSION = "2.0.0";

const providers = [
  ["OpenAI-compatible", "OpenAI、DeepSeek、自建兼容网关"],
  ["Anthropic", "原生协议调用"],
  ["Ollama", "本地模型 / 无 key 场景"],
  ["Custom", "通过高级参数补 headers 与 query params"],
];

const capabilities = [
  ["自然语言 -> SQL", "结合 schema、语义层、表关系生成只读 SQL"],
  ["执行可追踪", "保留 SQL、数据、图表、Python 输出和执行诊断"],
  ["自动修复", "SQL / Python 可恢复错误会在单轮内自动修正并续跑"],
  ["工作区配置", "单用户默认模型、默认连接、上下文轮数与能力开关"],
];

const currentLimits = [
  "当前产品定位是单用户、本地优先，不包含团队账号和权限管理",
  "查询停止仍按单实例语义工作，不支持多实例共享取消状态",
  "数据库执行保持只读策略，不支持写操作",
];

export default function AboutPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={18} />
            返回
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="rounded-[28px] border border-border bg-secondary p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                <Gauge size={12} />
                Single-User Workspace
              </div>
              <h1 className="mt-4 text-4xl font-semibold text-foreground">QueryGPT</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                一个面向个人和自托管场景的数据库分析工作台。重点是把模型适配、执行诊断、语义层和 schema 管理做扎实，而不是做成多租户平台。
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-5 py-4 text-sm">
              <div className="text-muted-foreground">Version</div>
              <div className="mt-1 font-medium text-foreground">{VERSION}</div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Bot size={16} className="text-primary" />
              支持的模型适配
            </div>
            <div className="mt-4 space-y-3">
              {providers.map(([name, desc]) => (
                <div key={name} className="rounded-xl border border-border bg-secondary px-4 py-3">
                  <div className="text-sm font-medium text-foreground">{name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers size={16} className="text-primary" />
              当前核心能力
            </div>
            <div className="mt-4 space-y-3">
              {capabilities.map(([name, desc]) => (
                <div key={name} className="rounded-xl border border-border bg-secondary px-4 py-3">
                  <div className="text-sm font-medium text-foreground">{name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Database size={16} className="text-primary" />
              数据源
            </div>
            <div className="mt-3 text-sm text-muted-foreground">MySQL / PostgreSQL / SQLite</div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <GitBranch size={16} className="text-primary" />
              关系与语义
            </div>
            <div className="mt-3 text-sm text-muted-foreground">支持表关系、语义术语、布局快照与导入导出</div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Palette size={16} className="text-primary" />
              界面
            </div>
            <div className="mt-3 text-sm text-muted-foreground">聊天检查面板、工作区设置、多主题</div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-background p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Shield size={16} className="text-primary" />
            已知约束
          </div>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            {currentLimits.map((item) => (
              <li key={item} className="rounded-xl border border-border bg-secondary px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
