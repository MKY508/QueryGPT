"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Database,
  Gauge,
  History,
  Loader2,
  Send,
  Settings,
  Sparkles,
  Square,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppSettings, ConnectionSummary, ModelSummary } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import { useChatStore } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";
import { AssistantMessageCard } from "./AssistantMessageCard";
import { ChatEmptyState } from "./ChatEmptyState";
import { StatusChip } from "./StatusChip";

interface ChatAreaProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const STORAGE_KEY_CONNECTION = "querygpt-selected-connection";
const STORAGE_KEY_MODEL = "querygpt-selected-model";

export function ChatArea({ sidebarOpen: _sidebarOpen, onToggleSidebar }: ChatAreaProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const { messages, isLoading, sendMessage, stopGeneration, retryMessage, rerunMessage } =
    useChatStore();

  useEffect(() => {
    const savedConnection = localStorage.getItem(STORAGE_KEY_CONNECTION);
    const savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
    if (savedConnection) setSelectedConnectionId(savedConnection);
    if (savedModel) setSelectedModelId(savedModel);
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        connectionDropdownRef.current &&
        !connectionDropdownRef.current.contains(event.target as Node)
      ) {
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as ConnectionSummary[];
    },
  });

  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as ModelSummary[];
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
    const savedExists = selectedConnectionId && connections.some((item) => item.id === selectedConnectionId);
    if (!savedExists) {
      const preferredId = appSettings?.default_connection_id;
      const nextId =
        connections.find((item) => item.id === preferredId)?.id ||
        connections.find((item) => item.is_default)?.id ||
        connections[0].id;
      handleSelectConnection(nextId);
    }
  }, [appSettings?.default_connection_id, connections, isInitialized, selectedConnectionId]);

  useEffect(() => {
    if (!isInitialized || !models?.length) return;
    const savedExists = selectedModelId && models.some((item) => item.id === selectedModelId);
    if (!savedExists) {
      const preferredId = appSettings?.default_model_id;
      const nextId =
        models.find((item) => item.id === preferredId)?.id ||
        models.find((item) => item.is_default)?.id ||
        models[0].id;
      handleSelectModel(nextId);
    }
  }, [appSettings?.default_model_id, isInitialized, models, selectedModelId]);

  const selectedConnection = connections?.find((item) => item.id === selectedConnectionId);
  const selectedModel = models?.find((item) => item.id === selectedModelId);
  const readyToQuery = Boolean(selectedConnection && selectedModel);
  const modelReady = Boolean(
    selectedModel &&
      (selectedModel.api_key_configured || selectedModel.extra_options?.api_key_optional)
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) {
      stopGeneration();
      return;
    }
    if (!input.trim() || !readyToQuery) return;

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
              data-testid="chat-connection-select"
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
                      data-testid={`chat-connection-option-${connection.id}`}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-muted",
                        connection.id === selectedConnectionId && "bg-primary/10 text-primary"
                      )}
                    >
                      <div>
                        <div className="font-medium">{connection.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {connection.driver}
                          {connection.database_name ? ` · ${connection.database_name}` : ""}
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
              data-testid="chat-model-select"
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
                      data-testid={`chat-model-option-${model.id}`}
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
          <ChatEmptyState
            selectedConnection={selectedConnection}
            selectedModel={selectedModel}
            readyToQuery={readyToQuery}
            appSettings={appSettings}
            onOpenSettings={() => router.push("/settings")}
            onUsePrompt={setInput}
          />
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
              onChange={(event) => setInput(event.target.value)}
              data-testid="chat-input"
              placeholder="输入你的问题，例如：查询上月销售额..."
              className="w-full rounded-[24px] border border-input bg-background px-5 py-4 pr-16 text-foreground shadow-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={(!input.trim() && !isLoading) || !readyToQuery}
              data-testid="chat-submit"
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
