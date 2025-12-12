"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square, History, Loader2, Database, Brain, ChevronDown, Settings } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/lib/stores/chat";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { SqlHighlight } from "./SqlHighlight";
import { ChartDisplay } from "./ChartDisplay";
import { DataTable } from "./DataTable";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Connection {
  id: string;
  name: string;
  driver: string;
  host: string;
  database_name: string;
  is_default: boolean;
}

interface Model {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  is_default: boolean;
}

interface ChatAreaProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const STORAGE_KEY_CONNECTION = "querygpt-selected-connection";
const STORAGE_KEY_MODEL = "querygpt-selected-model";

export function ChatArea({ _sidebarOpen, onToggleSidebar }: ChatAreaProps) {
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
  const { messages, isLoading, sendMessage, stopGeneration } = useChatStore();

  // 客户端初始化：从 localStorage 读取保存的选择
  useEffect(() => {
    const savedConnection = localStorage.getItem(STORAGE_KEY_CONNECTION);
    const savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
    if (savedConnection) setSelectedConnectionId(savedConnection);
    if (savedModel) setSelectedModelId(savedModel);
    setIsInitialized(true);
  }, []);

  // 点击外部关闭下拉菜单
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

  // 当对话完成时刷新历史记录列表
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      // 从 loading 变为 not loading，说明对话完成
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, queryClient]);

  // 获取数据库连接列表
  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as Connection[];
    },
  });

  // 获取模型列表
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as Model[];
    },
  });

  // 持久化选择到 localStorage
  const handleSelectConnection = (id: string) => {
    setSelectedConnectionId(id);
    localStorage.setItem(STORAGE_KEY_CONNECTION, id);
  };

  const handleSelectModel = (id: string) => {
    setSelectedModelId(id);
    localStorage.setItem(STORAGE_KEY_MODEL, id);
  };

  // 设置默认选择（仅当初始化完成后且没有有效的保存选择时）
  useEffect(() => {
    if (!isInitialized || !connections || connections.length === 0) return;

    // 检查保存的连接是否仍然存在
    const savedExists = selectedConnectionId && connections.some((c) => c.id === selectedConnectionId);
    if (!savedExists) {
      const defaultConn = connections.find((c) => c.is_default);
      const newId = defaultConn?.id || connections[0].id;
      handleSelectConnection(newId);
    }
  }, [isInitialized, connections, selectedConnectionId]);

  useEffect(() => {
    if (!isInitialized || !models || models.length === 0) return;

    // 检查保存的模型是否仍然存在
    const savedExists = selectedModelId && models.some((m) => m.id === selectedModelId);
    if (!savedExists) {
      const defaultModel = models.find((m) => m.is_default);
      const newId = defaultModel?.id || models[0].id;
      handleSelectModel(newId);
    }
  }, [isInitialized, models, selectedModelId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLoading) {
      stopGeneration();
      return;
    }

    if (!input.trim()) return;

    const query = input;
    setInput("");
    await sendMessage(query, selectedConnectionId, selectedModelId);
  };

  const selectedConnection = connections?.find((c) => c.id === selectedConnectionId);
  const selectedModel = models?.find((m) => m.id === selectedModelId);

  return (
    <div className="flex-1 flex flex-col h-full relative bg-background">
      {/* Header */}
      <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-4 justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={onToggleSidebar}
            className="p-2 hover:bg-muted rounded-lg text-muted-foreground"
          >
            <History size={20} />
          </button>
          <span className="text-sm text-muted-foreground">QueryGPT v2</span>
        </div>

        <div className="flex items-center gap-3">
          {/* 数据库连接选择器 */}
          <div className="relative" ref={connectionDropdownRef}>
            <button
              onClick={() => {
                setShowConnectionDropdown(!showConnectionDropdown);
                setShowModelDropdown(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Database size={14} className="text-muted-foreground" />
              <span className="text-foreground max-w-[120px] truncate">
                {selectedConnection?.name || "选择数据库"}
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>

            {showConnectionDropdown && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
                {connections && connections.length > 0 ? (
                  connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => {
                        handleSelectConnection(conn.id);
                        setShowConnectionDropdown(false);
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center justify-between text-foreground",
                        conn.id === selectedConnectionId && "bg-primary/10 text-primary"
                      )}
                    >
                      <div>
                        <div className="font-medium">{conn.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {conn.driver} - {conn.database_name}
                        </div>
                      </div>
                      {conn.is_default && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">默认</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    <p>暂无数据库连接</p>
                    <span
                      onClick={() => router.push("/settings")}
                      className="text-primary hover:underline mt-1 inline-block cursor-pointer"
                    >
                      去添加
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 模型选择器 */}
          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => {
                setShowModelDropdown(!showModelDropdown);
                setShowConnectionDropdown(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Brain size={14} className="text-muted-foreground" />
              <span className="text-foreground max-w-[100px] truncate">
                {selectedModel?.name || "选择模型"}
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>

            {showModelDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
                {models && models.length > 0 ? (
                  models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        handleSelectModel(model.id);
                        setShowModelDropdown(false);
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center justify-between text-foreground",
                        model.id === selectedModelId && "bg-primary/10 text-primary"
                      )}
                    >
                      <div>
                        <div className="font-medium">{model.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {model.provider} / {model.model_id}
                        </div>
                      </div>
                      {model.is_default && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">默认</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    <p>暂无模型配置</p>
                    <span
                      onClick={() => router.push("/settings")}
                      className="text-primary hover:underline mt-1 inline-block cursor-pointer"
                    >
                      去添加
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 设置按钮 */}
          <Link
            href="/settings"
            className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
          >
            <Settings size={18} />
          </Link>
        </div>
      </header>


      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6">
              <Database size={32} className="text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              欢迎使用 QueryGPT
            </h2>
            <p className="text-muted-foreground max-w-md text-center">
              用自然语言查询数据库，获取数据分析和可视化结果
            </p>

            {/* 当前选择提示 */}
            {selectedConnection && (
              <div className="mt-4 px-4 py-2 bg-primary/10 rounded-lg text-sm text-primary">
                当前数据库: {selectedConnection.name} ({selectedConnection.driver})
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mt-8 max-w-2xl w-full">
              {[
                "显示最近的销售数据",
                "分析用户增长趋势",
                "按收入统计热门产品",
                "上个月的销售趋势",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="p-4 bg-background border border-border rounded-xl text-sm text-foreground hover:border-primary/50 hover:shadow-md transition-all text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "flex gap-4 max-w-4xl mx-auto animate-in slide-in-from-bottom-2 duration-300",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Brain size={16} className="text-primary" />
              </div>
            )}

            <div
              className={cn(
                "rounded-2xl px-5 py-3.5 max-w-[85%] shadow-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-background text-foreground border border-border rounded-bl-sm"
              )}
            >
              {msg.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="animate-spin" size={16} />
                  <span>{msg.status || "正在分析..."}</span>
                </div>
              ) : (
                <ReactMarkdown className="prose prose-sm max-w-none dark:prose-invert">
                  {msg.content}
                </ReactMarkdown>
              )}

              {msg.sql && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Database size={12} /> SQL 查询
                  </div>
                  <SqlHighlight code={msg.sql} />
                </div>
              )}

              {msg.visualization && (
                <ChartDisplay
                  type={msg.visualization.type || "bar"}
                  data={msg.visualization.data || []}
                  title={msg.visualization.title}
                />
              )}

              {msg.data && Array.isArray(msg.data) && msg.data.length > 0 && (
                <DataTable data={msg.data} />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background border-t border-border relative z-20">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题，例如：查询上月销售额..."
              className="w-full pl-5 pr-14 py-4 rounded-2xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary shadow-lg shadow-black/5 transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() && !isLoading}
              className={cn(
                "absolute right-2 p-2.5 text-white rounded-xl transition-all hover:scale-105 active:scale-95 shadow-md",
                isLoading
                  ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
                  : "bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isLoading ? (
                <Square size={18} fill="currentColor" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
          <div className="text-center mt-2">
            <p className="text-xs text-muted-foreground">
              QueryGPT 可能会产生错误，请验证重要信息
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
