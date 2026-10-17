import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportBlockCard } from "@/components/reports/ReportBlockCard";
import { useReportPanels } from "@/components/reports/useReportPanels";
import { useProjectConversationId } from "@/lib/hooks/useProjectConversationId";
import {
  CONVERSATION_CONTINUITY_STORAGE_KEY,
  forgetConversationForProject,
  rememberConversationForProject,
  useChatStore,
} from "@/lib/stores/chat";
import type { Conversation } from "@/lib/types/api";
import type { ReportBlock } from "@/lib/reports";
import messages from "@/messages/zh.json";

describe("report session state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation((key) => values.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => { values.set(key, value); });
    vi.mocked(localStorage.removeItem).mockImplementation((key) => { values.delete(key); });
    useChatStore.setState({ currentConversationId: null, currentConversationMeta: null, lastProjectId: null });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("subscribes only to the project conversation and follows same-window and storage changes", () => {
    const renders = vi.fn();
    const { result, rerender } = renderHook(({ projectId }) => {
      const id = useProjectConversationId(projectId);
      renders();
      return id;
    }, { initialProps: { projectId: "project-1" } });
    const initialRenders = renders.mock.calls.length;
    act(() => {
      useChatStore.setState({ messages: [], isLoading: true });
      rememberConversationForProject("project-2", "conversation-2");
    });
    expect(renders).toHaveBeenCalledTimes(initialRenders);
    act(() => rememberConversationForProject("project-1", "conversation-1"));
    expect(result.current).toBe("conversation-1");
    act(() => {
      localStorage.setItem(CONVERSATION_CONTINUITY_STORAGE_KEY, JSON.stringify({
        version: 1, conversations: { "project-1": "conversation-other-window" },
      }));
      window.dispatchEvent(new StorageEvent("storage", { key: CONVERSATION_CONTINUITY_STORAGE_KEY }));
    });
    expect(result.current).toBe("conversation-other-window");
    act(() => useChatStore.setState({ currentConversationId: "conversation-live", lastProjectId: "project-1" }));
    expect(result.current).toBe("conversation-live");
    act(() => useChatStore.setState({ currentConversationMeta: { project_id: "project-2" } as Conversation }));
    expect(result.current).toBe("conversation-other-window");
    act(() => forgetConversationForProject("project-1"));
    expect(result.current).toBeNull();
    rerender({ projectId: "project-2" });
    expect(result.current).toBe("conversation-live");
  });

  it("keeps navigation usable when the browser denies the localStorage getter", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get() {
      throw new DOMException("Storage denied", "SecurityError");
    } });
    try {
      const { result } = renderHook(() => useProjectConversationId("project-1", "explicit-conversation"));
      expect(result.current).toBe("explicit-conversation");
      expect(() => rememberConversationForProject("project-1", "conversation-1")).not.toThrow();
      expect(() => forgetConversationForProject("project-1")).not.toThrow();
      cleanup();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
  it("keeps desktop panes independent through resize", () => {
    const { result } = renderHook(useReportPanels, { wrapper: StrictMode });
    expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: false });
    act(() => result.current.showProperties());
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: true });
    act(() => result.current.closeOutline());
    act(() => result.current.showProperties());
    expect(result.current).toMatchObject({ outlineOpen: false, propertiesOpen: true });
    act(() => result.current.showOutline());
    expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: true });
  });

  it("dismisses block actions with Escape, outside clicks, reading mode and block identity", () => {
    const block: ReportBlock = {
      id: "block-1", block_type: "text", title: "Summary", order_index: 0,
      source_kind: "manual", analysis_run_id: null, artifact_id: null,
      content: { text: "Current result" }, config: {}, layout: { x: 0, y: 0, w: 6, h: 3 }, version: 1,
    };
    const move = vi.fn();
    const view = (editing: boolean, id = block.id) => <StrictMode>
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportBlockCard block={{ ...block, id }} editing={editing} selected
          onSelect={vi.fn()} onMove={move} onResize={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
      </NextIntlClientProvider>
    </StrictMode>;
    const { rerender } = render(view(true));
    const toggle = () => screen.getByRole("button", { name: messages.reportBlocks.blockActions });
    fireEvent.click(toggle());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveFocus();
    fireEvent.click(toggle());
    fireEvent.pointerDown(document.body);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    rerender(view(false));
    rerender(view(true));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    rerender(view(true, "block-2"));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("menuitem", { name: messages.reportBlocks.moveUpAria }));
    expect(move).toHaveBeenCalledExactlyOnceWith(-1);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
