"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Database,
  Gauge,
  History,
  Loader2,
  PlayCircle,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Square,
} from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppSettings, ExecutionContextSummary, ModelExtraOptions } from "@/lib/types/api";
import { useChatStore } from "@/lib/stores/chat";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { ChartDisplay } from "./ChartDisplay";
import { DataTable } from "./DataTable";
import { SqlHighlight } from "./SqlHighlight";

interface Connection {
  id: string;
  name: string;
  driver: string;
  host?: string;
  database_name?: string;
  is_default: boolean;
}

interface Model {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  is_default: boolean;
  api_key_configured?: boolean;
  extra_options?: ModelExtraOptions;
}

interface ChatAreaProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const STORAGE_KEY_CONNECTION = "querygpt-selected-connection";
const STORAGE_KEY_MODEL = "querygpt-selected-model";

function StatusChip({
  tone = "default",
  children,
}: {
  tone?: "default" | "success" | "warning";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs border",
        tone === "default" && "border-border bg-background text-muted-foreground",
        tone === "success" && "border-green-500/20 bg-green-500/10 text-green-700",
        tone === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-700"
      )}
    >
      {children}
    </span>
  );
}

function AssistantMessageCard({
  message,
  index,
  onRetry,
  onRerun,
}: {
  message: ReturnType<typeof useChatStore.getState>["messages"][number];
  index: number;
  onRetry: (index: number) => void;
  onRerun: (index: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "summary" | "sql" | "data" | "chart" | "python" | "diagnostics"
  >("summary");

  const tabs = useMemo(
    () =>
      [
        { id: "summary", label: "总结", visible: true },
        { id: "sql", label: "SQL", visible: Boolean(message.sql) },
        { id: "data", label: "数据", visible: Boolean(message.data?.length) },
        { id: "chart", label: "图表", visible: Boolean(message.visualization || message.pythonImages?.length) },
        { id: "python", label: "Python", visible: Boolean(message.pythonOutput) },
        { id: "diagnostics", label: "诊断", visible: true },
      ].filter((tab) => tab.visible) as Array<{ id: typeof activeTab; label: string }>,
    [message.data?.length, message.pythonImages?.length, message.pythonOutput, message.sql, message.visualization]
  );

  const executionContext: ExecutionContextSummary | undefined = message.executionContext;
  const diagnostics = message.diagnostics || [];
  const autoRepairCount = diagnostics.filter((entry) => entry.status === "repaired").length;

  return (
    <div className="w-full max-w-4xl rounded-[24px] border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onRerun(index)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs bg-secondary text-foreground hover:bg-muted transition-colors"
          >
            <PlayCircle size={14} />
            重新运行
          </button>
          {message.hasError && (
            <button
              onClick={() => onRetry(index)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
          <pre className="rounded-xl bg-secondary p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap">
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
              {message.errorCategory && <StatusChip tone="warning">错误分类: {message.errorCategory}</StatusChip>}
              {message.errorCode && <StatusChip tone="warning">错误代码: {message.errorCode}</StatusChip>}
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
                        {entry.status === "repaired" && <StatusChip tone="success">已修复</StatusChip>}
                        {entry.status === "error" && <StatusChip tone="warning">失败</StatusChip>}
                        {entry.error_category && <StatusChip tone="warning">{entry.error_category}</StatusChip>}
                        {entry.recoverable && <StatusChip>可自动恢复</StatusChip>}
                      </div>
                      <div className="mt-2 text-sm text-foreground">{entry.message || "-"}</div>
                      {entry.sql && (
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-secondary p-3 text-xs text-foreground whitespace-pre-wrap">
                          {entry.sql}
                        </pre>
                      )}
                      {!entry.sql && entry.python && (
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-secondary p-3 text-xs text-foreground whitespace-pre-wrap">
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

export function ChatArea({ sidebarOpen: _sidebarOpen, onToggleSidebar }: ChatAreaProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showConnectionDropdown, setShowConnectionDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevIsLoadingRef = useRef(false);
  const connectionDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    retryMessage,
    rerunMessage,
  } = useChatStore();

  useEffect(() => {
    const savedConnection = localStorage.getItem(STORAGE_KEY_CONNECTION);
    const savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
    if (savedConnection) setSelectedConnectionId(savedConnection);
    if (savedModel) setSelectedModelId(savedModel);
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (connectionDropdownRef.current && !connectionDropdownRef.current.contains(event.target as Node)) {
        setShowConnectionDropdown(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, queryClient]);

  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as Connection[];
    },
  });

  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as Model[];
    },
  });

  const { data: appSettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const response = await api.get("/api/v1/settings");
      return response.data.data as AppSettings;
    },
  });

  const effectiveContextRounds = appSettings?.context_rounds || 5;

  const handleSelectConnection = (id: string) => {
    setSelectedConnectionId(id);
    localStorage.setItem(STORAGE_KEY_CONNECTION, id);
  };

  const handleSelectModel = (id: string) => {
    setSelectedModelId(id);
    localStorage.setItem(STORAGE_KEY_MODEL, id);
  };

  useEffect(() => {
    if (!isInitialized || !connections?.length) return;
    const savedExists = selectedConnectionId && connections.some((c) => c.id === selectedConnectionId);
    if (!savedExists) {
      const preferredId = appSettings?.default_connection_id;
      const nextId =
        connections.find((c) => c.id === preferredId)?.id ||
        connections.find((c) => c.is_default)?.id ||
        connections[0].id;
      handleSelectConnection(nextId);
    }
  }, [isInitialized, connections, selectedConnectionId, appSettings?.default_connection_id]);

  useEffect(() => {
    if (!isInitialized || !models?.length) return;
    const savedExists = selectedModelId && models.some((m) => m.id === selectedModelId);
    if (!savedExists) {
      const preferredId = appSettings?.default_model_id;
      const nextId =
        models.find((m) => m.id === preferredId)?.id ||
        models.find((m) => m.is_default)?.id ||
        models[0].id;
      handleSelectModel(nextId);
    }
  }, [isInitialized, models, selectedModelId, appSettings?.default_model_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConnection = connections?.find((c) => c.id === selectedConnectionId);
  const selectedModel = models?.find((m) => m.id === selectedModelId);
  const readyToQuery = Boolean(selectedConnection && selectedModel);
  const modelReady = Boolean(
    selectedModel &&
      (selectedModel.api_key_configured || selectedModel.extra_options?.api_key_optional)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) {
      stopGeneration();
      return;
    }
    if (!input.trim()) return;
    if (!readyToQuery) return;

    const query = input;
    setInput("");
    await sendMessage(query, selectedConnectionId, selectedModelId, effectiveContextRounds);
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onToggleSidebar}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            >
              <History size={20} />
            </button>
            <div>
              <div className="text-sm font-medium text-foreground">QueryGPT</div>
              <div className="text-xs text-muted-foreground">自然语言数据库分析工作台</div>
            </div>
          </div>

          <Link
            href="/settings"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <Settings size={18} />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
          <div className="relative" ref={connectionDropdownRef}>
            <button
              onClick={() => {
                setShowConnectionDropdown((prev) => !prev);
                setShowModelDropdown(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <Database size={14} className="text-muted-foreground" />
              <span className="max-w-[180px] truncate">{selectedConnection?.name || "选择数据库"}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {showConnectionDropdown && (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-background py-1 shadow-lg">
                {connections?.length ? (
                  connections.map((connection) => (
                    <button
                      key={connection.id}
                      onClick={() => {
                        handleSelectConnection(connection.id);
                        setShowConnectionDropdown(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-muted",
                        connection.id === selectedConnectionId && "bg-primary/10 text-primary"
                      )}
                    >
                      <div>
                        <div className="font-medium">{connection.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {connection.driver} {connection.database_name ? `· ${connection.database_name}` : ""}
                        </div>
                      </div>
                      {connection.is_default && <StatusChip>默认</StatusChip>}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-sm text-muted-foreground">
                    暂无数据库连接，去设置页添加。
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => {
                setShowModelDropdown((prev) => !prev);
                setShowConnectionDropdown(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <Brain size={14} className="text-muted-foreground" />
              <span className="max-w-[180px] truncate">{selectedModel?.name || "选择模型"}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {showModelDropdown && (
              <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-border bg-background py-1 shadow-lg">
                {models?.length ? (
                  models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        handleSelectModel(model.id);
                        setShowModelDropdown(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-muted",
                        model.id === selectedModelId && "bg-primary/10 text-primary"
                      )}
                    >
                      <div>
                        <div className="font-medium">{model.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {model.provider} · {model.model_id}
                        </div>
                      </div>
                      {model.is_default && <StatusChip>默认</StatusChip>}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-sm text-muted-foreground">
                    暂无模型配置，去设置页添加。
                  </div>
                )}
              </div>
            )}
          </div>

          <StatusChip tone={modelReady ? "success" : "warning"}>
            <Sparkles size={12} />
            {modelReady ? "模型可运行" : "模型缺少可用鉴权"}
          </StatusChip>
          <StatusChip>
            <Gauge size={12} />
            上下文 {effectiveContextRounds} 轮
          </StatusChip>
          {selectedModel?.extra_options?.api_format && (
            <StatusChip>{selectedModel.extra_options.api_format}</StatusChip>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center text-center">
            <div className="rounded-[28px] border border-border bg-secondary px-8 py-10">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-background border border-border">
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
                  <button
                    onClick={() => router.push("/settings")}
                    className="ml-2 font-medium text-primary underline"
                  >
                    去设置页完成配置
                  </button>
                </div>
              )}

              <div className="mt-8 grid gap-3 text-left md:grid-cols-2">
                {[
                  "显示最近的销售数据",
                  "分析用户增长趋势",
                  "按收入统计热门产品",
                  "上个月的销售趋势",
                ].map((sample) => (
                  <button
                    key={sample}
                    onClick={() => setInput(sample)}
                    className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-foreground transition-all hover:border-primary/40 hover:shadow-sm"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "flex gap-4",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                    <Brain size={18} className="text-primary" />
                  </div>
                )}

                {message.role === "assistant" ? (
                  message.isLoading ? (
                    <div className="rounded-[24px] border border-border bg-background px-5 py-4 text-sm text-muted-foreground shadow-sm">
                      <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        {message.thinkingStage || message.status || "正在分析..."}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessageCard
                      message={message}
                      index={index}
                      onRetry={(messageIndex) => void retryMessage(messageIndex)}
                      onRerun={(messageIndex) => void rerunMessage(messageIndex)}
                    />
                  )
                ) : (
                  <div className="max-w-3xl rounded-[24px] bg-primary px-5 py-4 text-primary-foreground shadow-sm">
                    <ReactMarkdown className="prose prose-sm max-w-none prose-invert">
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border bg-background p-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-5xl">
          {!modelReady && selectedModel && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle size={16} />
              当前模型可能无法运行：未检测到 API Key，且未启用“允许不配置 API Key”。
            </div>
          )}
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题，例如：查询上月销售额..."
              className="w-full rounded-[24px] border border-input bg-background px-5 py-4 pr-16 text-foreground shadow-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={(!input.trim() && !isLoading) || !readyToQuery}
              className={cn(
                "absolute right-2 rounded-2xl p-3 text-white shadow-sm transition-all",
                isLoading
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {isLoading ? <Square size={18} fill="currentColor" /> : <Send size={18} />}
            </button>
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            QueryGPT 可能会犯错；重要结果请复核 SQL 与原始数据
          </div>
        </form>
      </div>
    </div>
  );
}
