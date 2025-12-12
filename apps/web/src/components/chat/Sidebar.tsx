"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, MessageSquare, Trash2, Settings, LogOut, Database, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuthStore } from "@/lib/stores/auth";
import { useChatStore } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const PAGE_SIZE = 20;

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { currentConversationId, setCurrentConversation, clearConversation } = useChatStore();
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 无限滚动获取对话列表
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["conversations"],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await api.get("/api/v1/conversations", {
        params: { offset: pageParam, limit: PAGE_SIZE },
      });
      return response.data.data;
    },
    getNextPageParam: (lastPage) => {
      const { page, page_size, total } = lastPage;
      const nextOffset = page * page_size;
      return nextOffset < total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });

  // 合并所有页面的对话
  const conversations = data?.pages.flatMap((page) => page.items) ?? [];

  // 无限滚动观察器
  const lastItemRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  const handleNewChat = () => {
    clearConversation();
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConversation(id);
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个对话吗？")) return;

    try {
      await api.delete(`/api/v1/conversations/${id}`);
      if (currentConversationId === id) {
        clearConversation();
      }
      refetch();
    } catch (error) {
      console.error("删除失败", error);
    }
  };

  return (
    <div
      className={cn(
        "bg-slate-900 text-slate-300 flex-shrink-0 transition-all duration-300 flex flex-col border-r border-slate-800 overflow-hidden",
        isOpen ? "w-64" : "w-0"
      )}
    >
      {/* Header */}
      <div className="p-4 flex justify-between items-center h-16">
        <div className="flex items-center gap-2 font-bold text-white">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Database size={18} className="text-white" />
          </div>
          <span className="text-lg">QueryGPT</span>
        </div>
        <button
          onClick={handleNewChat}
          className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          title="新对话"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="text-xs font-medium text-slate-500 uppercase px-2 mb-2 mt-2">
          最近对话
        </div>
        {conversations.map((chat: any, index: number) => (
          <div
            key={chat.id}
            ref={index === conversations.length - 1 ? lastItemRef : null}
            onClick={() => handleSelectConversation(chat.id)}
            className={cn(
              "p-2 rounded-lg cursor-pointer truncate text-sm transition-colors flex items-center gap-2 group relative pr-8",
              currentConversationId === chat.id
                ? "bg-slate-800 text-white"
                : "hover:bg-slate-800/50"
            )}
          >
            <MessageSquare
              size={14}
              className={cn(
                "flex-shrink-0",
                currentConversationId === chat.id
                  ? "text-blue-400"
                  : "text-slate-500 group-hover:text-blue-400"
              )}
            />
            <span className="truncate">{chat.title || "未命名对话"}</span>

            <button
              onClick={(e) => handleDeleteConversation(e, chat.id)}
              className="absolute right-1 p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {/* 加载更多指示器 */}
        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Loader2 size={16} className="animate-spin text-slate-400" />
          </div>
        )}

        {conversations.length === 0 && !isFetchingNextPage && (
          <div className="text-center py-8 text-slate-500 text-sm">
            暂无对话记录
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800 space-y-1">
        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-3 text-sm w-full p-2 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <Settings size={18} /> 设置
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-3 text-sm w-full p-2 hover:bg-slate-800 rounded-lg transition-colors text-red-400"
        >
          <LogOut size={18} /> 退出登录
        </button>
        {user && (
          <div className="pt-2 px-2 text-xs text-slate-500 truncate">
            {user.email}
          </div>
        )}
      </div>
    </div>
  );
}
