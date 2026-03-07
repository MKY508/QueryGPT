"use client";

import { useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Database, Loader2, MessageSquare, Plus, Settings, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { ConversationListItem } from "@/lib/types/api";
import { useChatStore } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const PAGE_SIZE = 20;

export function Sidebar({ isOpen, onToggle: _onToggle }: SidebarProps) {
  const router = useRouter();
  const { currentConversationId, setCurrentConversation, clearConversation } = useChatStore();
  const observerRef = useRef<IntersectionObserver | null>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useInfiniteQuery({
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

  const conversations = data?.pages.flatMap((page) => page.items) ?? [];

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
        "flex flex-shrink-0 flex-col overflow-hidden border-r border-border bg-secondary text-foreground transition-all duration-300",
        isOpen ? "w-64" : "w-0"
      )}
    >
      <div className="flex h-16 items-center justify-between p-4">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Database size={18} className="text-primary-foreground" />
          </div>
          <span className="text-lg">QueryGPT</span>
        </div>
        <button
          onClick={() => clearConversation()}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="新对话"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <div className="mb-2 mt-2 px-2 text-xs font-medium uppercase text-muted-foreground">最近对话</div>
        {conversations.map((chat: ConversationListItem, index: number) => (
          <div
            key={chat.id}
            ref={index === conversations.length - 1 ? lastItemRef : null}
            onClick={() => setCurrentConversation(chat.id)}
            className={cn(
              "group relative flex cursor-pointer items-center gap-2 truncate rounded-lg p-2 pr-8 text-sm transition-colors",
              currentConversationId === chat.id
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
            )}
          >
            <MessageSquare
              size={14}
              className={cn(
                "flex-shrink-0",
                currentConversationId === chat.id
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-primary"
              )}
            />
            <span className="truncate">{chat.title || "未命名对话"}</span>

            <button
              onClick={(e) => handleDeleteConversation(e, chat.id)}
              className="absolute right-1 rounded p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {conversations.length === 0 && !isFetchingNextPage && (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无对话记录</div>
        )}
      </div>

      <div className="space-y-1 border-t border-border p-4">
        <button
          onClick={() => router.push("/settings")}
          className="flex w-full items-center gap-3 rounded-lg p-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <Settings size={18} /> 设置
        </button>
      </div>
    </div>
  );
}
