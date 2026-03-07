"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, PlayCircle, RefreshCw, Sparkles } from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types/chat";
import { ChartDisplay } from "./ChartDisplay";
import { DataTable } from "./DataTable";
import { SqlHighlight } from "./SqlHighlight";
import { StatusChip } from "./StatusChip";

type AssistantTab = "summary" | "sql" | "data" | "chart" | "python" | "diagnostics";

interface AssistantMessageCardProps {
  message: ChatMessage;
  index: number;
  onRetry: (index: number) => void;
  onRerun: (index: number) => void;
}

export function AssistantMessageCard({
  message,
  index,
  onRetry,
  onRerun,
}: AssistantMessageCardProps) {
  const [activeTab, setActiveTab] = useState<AssistantTab>("summary");
  const executionContext = message.executionContext;
  const diagnostics = message.diagnostics || [];
  const autoRepairCount = diagnostics.filter((entry) => entry.status === "repaired").length;

  const tabs = useMemo(
    () =>
      [
        { id: "summary", label: "总结", visible: true },
        { id: "sql", label: "SQL", visible: Boolean(message.sql) },
        { id: "data", label: "数据", visible: Boolean(message.data?.length) },
        {
          id: "chart",
          label: "图表",
          visible: Boolean(message.visualization || message.pythonImages?.length),
        },
        { id: "python", label: "Python", visible: Boolean(message.pythonOutput) },
        { id: "diagnostics", label: "诊断", visible: true },
      ].filter((tab) => tab.visible) as Array<{ id: AssistantTab; label: string }>,
    [
      message.data?.length,
      message.pythonImages?.length,
      message.pythonOutput,
      message.sql,
      message.visualization,
    ]
  );

  return (
    <div className="w-full max-w-4xl rounded-[24px] border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors"
                  : "rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onRerun(index)}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <PlayCircle size={14} />
            重新运行
          </button>
          {message.hasError && (
            <button
              onClick={() => onRetry(index)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw size={14} />
              重试
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {message.hasError && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {message.errorMessage || "执行出错"}
          </div>
        )}

        {activeTab === "summary" && (
          <ReactMarkdown className="prose prose-sm max-w-none dark:prose-invert">
            {message.content || "暂无总结"}
          </ReactMarkdown>
        )}

        {activeTab === "sql" && message.sql && <SqlHighlight code={message.sql} />}

        {activeTab === "data" && message.data && message.data.length > 0 && (
          <DataTable data={message.data} title={`查询结果 (${message.data.length} 行)`} />
        )}

        {activeTab === "chart" && (
          <div className="space-y-4">
            {message.visualization && (
              <ChartDisplay
                type={message.visualization.type || "bar"}
                data={message.visualization.data || []}
                title={message.visualization.title}
              />
            )}
            {message.pythonImages?.map((img, imageIndex) => (
              <Image
                key={imageIndex}
                src={`data:image/png;base64,${img}`}
                alt={`分析图表 ${imageIndex + 1}`}
                width={1280}
                height={720}
                unoptimized
                className="h-auto max-w-full rounded-xl border border-border"
              />
            ))}
            {!message.visualization && !message.pythonImages?.length && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                当前回复没有图表输出
              </div>
            )}
          </div>
        )}

        {activeTab === "python" && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-secondary p-4 text-xs text-foreground">
            {message.pythonOutput || "当前回复没有 Python 输出"}
          </pre>
        )}

        {activeTab === "diagnostics" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">模型</div>
                <div className="mt-1 text-sm text-foreground">
                  {executionContext?.model_name || executionContext?.model_identifier || "-"}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">数据库连接</div>
                <div className="mt-1 text-sm text-foreground">
                  {executionContext?.connection_name || "-"}
                </div>
                {(executionContext?.database_name || executionContext?.connection_host) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[executionContext.database_name, executionContext.connection_host]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">Provider</div>
                <div className="mt-1 text-sm text-foreground">
                  {executionContext?.provider_summary || "-"}
                </div>
                {(executionContext?.source_provider || executionContext?.resolved_provider) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    源 provider: {executionContext?.source_provider || "-"} · 运行时 provider:{" "}
                    {executionContext?.resolved_provider || "-"}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">上下文轮数</div>
                <div className="mt-1 text-sm text-foreground">
                  {executionContext?.context_rounds || "-"}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">执行耗时</div>
                <div className="mt-1 text-sm text-foreground">
                  {message.executionTime ? `${message.executionTime.toFixed(2)}s` : "-"}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-secondary p-4">
                <div className="text-xs text-muted-foreground">结果行数</div>
                <div className="mt-1 text-sm text-foreground">{message.rowsCount ?? "-"}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusChip>
                <Sparkles size={12} />
                自动修复 {autoRepairCount} 次
              </StatusChip>
              {message.errorCategory && (
                <StatusChip tone="warning">错误分类: {message.errorCategory}</StatusChip>
              )}
              {message.errorCode && (
                <StatusChip tone="warning">错误代码: {message.errorCode}</StatusChip>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-secondary/50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle size={14} />
                尝试记录
              </div>
              {diagnostics.length ? (
                <div className="space-y-3">
                  {diagnostics.map((entry, diagIndex) => (
                    <div
                      key={`${entry.attempt}-${entry.phase}-${diagIndex}`}
                      className="rounded-xl border border-border bg-background px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip>{`第 ${entry.attempt || 1} 次 · ${entry.phase || "unknown"}`}</StatusChip>
                        {entry.status === "success" && <StatusChip tone="success">成功</StatusChip>}
                        {entry.status === "repaired" && (
                          <StatusChip tone="success">已修复</StatusChip>
                        )}
                        {entry.status === "error" && <StatusChip tone="warning">失败</StatusChip>}
                        {entry.error_category && (
                          <StatusChip tone="warning">{entry.error_category}</StatusChip>
                        )}
                        {entry.recoverable && <StatusChip>可自动恢复</StatusChip>}
                      </div>
                      <div className="mt-2 text-sm text-foreground">{entry.message || "-"}</div>
                      {entry.sql && (
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs text-foreground">
                          {entry.sql}
                        </pre>
                      )}
                      {!entry.sql && entry.python && (
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs text-foreground">
                          {entry.python}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">当前没有诊断轨迹。</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
