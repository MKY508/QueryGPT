import { act, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import type { AnalysisHistoryDialogProps } from "@/components/chat/AnalysisHistoryDialog";
import { CONVERSATION_CONTINUITY_STORAGE_KEY } from "@/lib/stores/chat";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  setCurrentConversation: vi.fn(),
  replace: vi.fn(),
  currentConversationId: null as string | null,
  sidebar: vi.fn(),
  historyQuery: vi.fn(),
  chatArea: vi.fn(),
  projectDialog: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mocks.historyQuery(...args),
}));

vi.mock("@/components/chat/AnalysisHistoryDialog", () => ({
  AnalysisHistoryDialog: (props: AnalysisHistoryDialogProps) => { mocks.sidebar(props); return <aside aria-label="项目导航" />; },
}));

vi.mock("@/components/chat/ChatArea", () => ({
  ChatArea: (props: { onVisibleReportChange?: (id: string | null) => void }) => { mocks.chatArea(props); return <main aria-label="调查工作区" />; },
}));

vi.mock("@/components/projects/ProjectSwitcherDialog", () => ({
  ProjectSwitcherDialog: (props: { onClose: () => void; onSwitched: () => void }) => {
    mocks.projectDialog(props); return <div role="dialog" aria-label="项目目录" />;
  },
}));

vi.mock("@/lib/stores/project", () => ({
  useProjectStore: () => ({
    bootstrap: mocks.bootstrap,
    currentProjectId: "project-1",
    projects: [{ id: "project-1", name: "财务分析" }],
  }),
}));

vi.mock("@/lib/stores/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/chat")>();
  return {
    ...actual,
    useChatStore: () => ({
      messages: [],
      currentConversationId: mocks.currentConversationId,
      isLoading: false,
      activeStreamId: null,
      setCurrentConversation: mocks.setCurrentConversation,
    }),
  };
});

function renderHome(locale: "en" | "zh" = "zh") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : zhMessages}
    >
      <Home />
    </NextIntlClientProvider>
  );
}

describe("home conversation continuity", () => {
  beforeEach(() => {
    mocks.bootstrap.mockReset();
    mocks.setCurrentConversation.mockReset();
    mocks.replace.mockReset();
    mocks.currentConversationId = null;
    mocks.sidebar.mockClear();
    mocks.chatArea.mockClear();
    mocks.projectDialog.mockClear();
    mocks.historyQuery.mockReset();
    window.history.replaceState(null, "", "/");
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
  });

  it("does not preload the full run history on the home page", () => {
    renderHome();
    expect(mocks.historyQuery).not.toHaveBeenCalled();
    expect(mocks.sidebar.mock.calls.at(-1)![0].open).toBe(false);
  });

  it("opens the history browser without navigating until an analysis is explicitly opened", () => {
    mocks.currentConversationId = "conversation-1";
    renderHome();
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onOpenHistory());
    expect(mocks.sidebar.mock.calls.at(-1)![0].open).toBe(true);
    expect(mocks.setCurrentConversation).not.toHaveBeenCalled();
    act(() => mocks.sidebar.mock.calls.at(-1)![0].onOpenReport("conversation-2", "run-2"));
    expect(mocks.setCurrentConversation).toHaveBeenCalledExactlyOnceWith("conversation-2", "project-1");
    act(() => mocks.sidebar.mock.calls.at(-1)![0].onClose());
    expect(mocks.sidebar.mock.calls.at(-1)![0].open).toBe(false);
  });

  it("hands ownership between project and history dialogs without a late close dismissing the new task", () => {
    const view = renderHome();
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onOpenHistory());
    const oldHistoryClose = mocks.sidebar.mock.calls.at(-1)![0].onClose;
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onOpenProjects());
    expect(mocks.sidebar.mock.calls.at(-1)![0].open).toBe(false);
    expect(view.getByRole("dialog", { name: "项目目录" })).toBeInTheDocument();
    act(oldHistoryClose);
    expect(view.getByRole("dialog", { name: "项目目录" })).toBeInTheDocument();
    const oldProjectClose = mocks.projectDialog.mock.calls.at(-1)![0].onClose;
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onOpenHistory());
    expect(view.queryByRole("dialog", { name: "项目目录" })).not.toBeInTheDocument();
    act(oldProjectClose);
    expect(mocks.sidebar.mock.calls.at(-1)![0].open).toBe(true);
    expect(mocks.setCurrentConversation).not.toHaveBeenCalled();
  });

  it("tracks visible results without reloading a conversation and ignores an old conversation callback", () => {
    mocks.currentConversationId = "conversation-1";
    const view = renderHome();
    const oldCallback = mocks.chatArea.mock.calls.at(-1)![0].onVisibleReportChange;
    act(() => oldCallback("older-result"));
    expect(mocks.sidebar.mock.calls.at(-1)![0].currentAnalysisRunId).toBe("older-result");
    act(() => oldCallback("latest-result"));
    expect(mocks.sidebar.mock.calls.at(-1)![0].currentAnalysisRunId).toBe("latest-result");
    expect(mocks.setCurrentConversation).not.toHaveBeenCalled();
    mocks.currentConversationId = "conversation-2";
    view.rerender(<NextIntlClientProvider locale="zh" messages={zhMessages}><Home /></NextIntlClientProvider>);
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onVisibleReportChange("other-result"));
    act(() => oldCallback("stale-result"));
    expect(mocks.sidebar.mock.calls.at(-1)![0].currentAnalysisRunId).toBe("other-result");
    act(() => mocks.chatArea.mock.calls.at(-1)![0].onVisibleReportChange(null));
    expect(mocks.sidebar.mock.calls.at(-1)![0].currentAnalysisRunId).toBeNull();
  });

  it("restores the saved conversation for the bootstrapped project", async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === CONVERSATION_CONTINUITY_STORAGE_KEY
        ? JSON.stringify({
            version: 1,
            conversations: { "project-1": "conversation-1" },
          })
        : null
    );

    renderHome();

    await waitFor(() =>
      expect(mocks.setCurrentConversation).toHaveBeenCalledWith(
        "conversation-1",
        "project-1"
      )
    );
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      name: "我的分析项目",
      description: "订单、门店和业务口径都保存在这里",
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("restores an explicitly carried report conversation and consumes the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?conversation=conversation-from-report"
    );

    renderHome();

    await waitFor(() =>
      expect(mocks.setCurrentConversation).toHaveBeenCalledWith(
        "conversation-from-report",
        "project-1"
      )
    );
    expect(mocks.replace).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("consumes a carried URL even when that conversation is already in memory", async () => {
    window.history.replaceState(
      null,
      "",
      "/?conversation=conversation-from-report"
    );
    mocks.currentConversationId = "conversation-from-report";

    renderHome();

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/", { scroll: false })
    );
    expect(mocks.setCurrentConversation).not.toHaveBeenCalled();
  });

  it("bootstraps a fresh English workspace with English project defaults", async () => {
    renderHome("en");

    await waitFor(() =>
      expect(mocks.bootstrap).toHaveBeenCalledWith({
        name: "My analysis project",
        description: "Keep orders, stores, and confirmed business definitions here",
      })
    );
  });
});
