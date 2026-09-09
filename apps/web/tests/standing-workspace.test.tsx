import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStandingAnalyses } from "@/components/chat/useStandingAnalyses";
import type { StandingAnalysis, StandingPrepareResponse } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const mocks = vi.hoisted(() => ({
  projectId: "project-1", get: vi.fn(), post: vi.fn(), push: vi.fn(),
  chat: { currentConversationId: null as string | null, isLoading: false, activeStreamId: null as string | null,
    isConversationLoading: false, resumePreparedRun: vi.fn(), setCurrentConversation: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api/client", () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock("@/lib/stores/chat", () => ({ useChatStore: { getState: () => mocks.chat } }));
vi.mock("@/lib/stores/project", () => ({ useProjectStore: { getState: () => ({ currentProjectId: mocks.projectId }) } }));

const standing: StandingAnalysis = {
  schema_version: 1, id: "standing-1", project_id: "project-1", name: "收入变化", query: "检查本月收入",
  playbook_id: "playbook", playbook_shape_hash: "shape", watched_source_roles: [], state: "active",
  trigger_policy: "app_open_and_source_change", overdue_after_seconds: 3600,
  materiality: { version: 1, match: "any", percent_unit: "ratio", top_driver_limit: 3, rules: [] },
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-09T00:00:00Z",
};
const reply = (outcome: StandingPrepareResponse["outcome"]) => ({ data: { data: {
  outcome, standing_analysis: standing, run_id: "run-1", conversation_id: "conversation-1",
} satisfies StandingPrepareResponse } });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={messages}>{children}</NextIntlClientProvider>
  </QueryClientProvider>;
  return renderHook(({ projectId }) => useStandingAnalyses({ projectId, modelId: "model-1", modelReady: true, contextRounds: 5 }),
    { initialProps: { projectId: "project-1" }, wrapper });
}

describe("standing investigation workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.projectId = "project-1";
    Object.assign(mocks.chat, { currentConversationId: null, isLoading: false, activeStreamId: null, isConversationLoading: false });
    mocks.get.mockResolvedValue({ data: { data: [standing] } });
    mocks.post.mockResolvedValue(reply("no_change"));
    mocks.chat.resumePreparedRun.mockResolvedValue(undefined);
  });

  it("loads a cancellable project directory and checks only once per explicit action", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.standingAnalyses).toEqual([standing]));
    expect(mocks.get.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(mocks.post).not.toHaveBeenCalled();
    act(() => { view.result.current.checkStanding(standing); view.result.current.checkStanding(standing); });
    await waitFor(() => expect(view.result.current.standingFeedback[standing.id]).toBe(messages.chatArea.noChanges));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.chat.resumePreparedRun).not.toHaveBeenCalled();
  });

  it("hands a prepared run to the existing engine using the clicked context", async () => {
    mocks.post.mockResolvedValue(reply("prepared"));
    const view = setup(); act(() => view.result.current.checkStanding(standing));
    await waitFor(() => expect(mocks.chat.resumePreparedRun).toHaveBeenCalledWith({
      query: standing.query, projectId: "project-1", runId: "run-1", conversationId: "conversation-1",
    }, "model-1", 5, "zh"));
  });

  it("ignores a prepared result after switching away and returning to the same project", async () => {
    let resolve!: (value: ReturnType<typeof reply>) => void;
    mocks.post.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = setup(); act(() => view.result.current.checkStanding(standing));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    mocks.projectId = "project-2"; view.rerender({ projectId: "project-2" });
    mocks.projectId = "project-1"; view.rerender({ projectId: "project-1" });
    await act(async () => resolve(reply("prepared")));
    expect(mocks.chat.resumePreparedRun).not.toHaveBeenCalled();
    expect(view.result.current.standingFeedback).toEqual({});
  });

  it("does not replace another investigation that started while a prepare request was pending", async () => {
    let resolve!: (value: ReturnType<typeof reply>) => void;
    mocks.post.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = setup(); act(() => view.result.current.checkStanding(standing));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    mocks.chat.activeStreamId = "new-stream";
    await act(async () => resolve(reply("prepared")));
    expect(mocks.chat.resumePreparedRun).not.toHaveBeenCalled();
    act(() => view.result.current.checkStanding(standing));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(view.result.current.standingFeedback[standing.id]).toBe(messages.chatArea.waitForRun);
  });

  it("does not navigate to a running investigation after leaving the workspace", async () => {
    let resolve!: (value: { data: { data: { id: string; stage: string }[] } }) => void;
    mocks.post.mockResolvedValue(reply("already_running"));
    mocks.get.mockImplementation((url: string) => url.endsWith("/analysis-runs")
      ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: { data: [standing] } }));
    const view = setup(); act(() => view.result.current.checkStanding(standing));
    await waitFor(() => expect(resolve).toBeDefined());
    view.unmount(); await act(async () => resolve({ data: { data: [{ id: "run-1", stage: "running" }] } }));
    expect(mocks.chat.setCurrentConversation).not.toHaveBeenCalled();
    expect(mocks.chat.resumePreparedRun).not.toHaveBeenCalled();
  });
});
