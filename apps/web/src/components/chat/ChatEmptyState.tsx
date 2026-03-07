"use client";

import { Brain } from "lucide-react";
import type { AppSettings } from "@/lib/types/api";
import { StatusChip } from "./StatusChip";

interface EmptyStateConnection {
  id: string;
  name: string;
}

interface EmptyStateModel {
  id: string;
  name: string;
}

interface ChatEmptyStateProps {
  selectedConnection: EmptyStateConnection | undefined;
  selectedModel: EmptyStateModel | undefined;
  readyToQuery: boolean;
  appSettings?: AppSettings;
  onOpenSettings: () => void;
  onUsePrompt: (prompt: string) => void;
}

const SAMPLE_PROMPTS = [
  "显示最近的销售数据",
  "分析用户增长趋势",
  "按收入统计热门产品",
  "上个月的销售趋势",
];

export function ChatEmptyState({
  selectedConnection,
  selectedModel,
  readyToQuery,
  appSettings: _appSettings,
  onOpenSettings,
  onUsePrompt,
}: ChatEmptyStateProps) {
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center text-center">
      <div className="rounded-[28px] border border-border bg-secondary px-8 py-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background">
          <Brain size={28} className="text-primary" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold text-foreground">开始一次可追踪的数据库对话</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          先确认模型与数据库连接，再发送问题。对话会保存模型、连接和上下文设置，方便后续重跑。
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <StatusChip tone={selectedConnection ? "success" : "warning"}>
            数据库: {selectedConnection?.name || "未选择"}
          </StatusChip>
          <StatusChip tone={selectedModel ? "success" : "warning"}>
            模型: {selectedModel?.name || "未选择"}
          </StatusChip>
        </div>

        {!readyToQuery && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-800">
            当前还不能直接提问。至少需要一个数据库连接和一个模型配置。
            <button onClick={onOpenSettings} className="ml-2 font-medium text-primary underline">
              去设置页完成配置
            </button>
          </div>
        )}

        <div className="mt-8 grid gap-3 text-left md:grid-cols-2">
          {SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample}
              onClick={() => onUsePrompt(sample)}
              className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground transition-all hover:border-primary/40 hover:shadow-sm"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
