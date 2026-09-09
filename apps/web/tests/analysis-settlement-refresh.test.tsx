import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalysisSettlementRefresher } from "@/lib/analysis-settlement-refresh";
import { useAnalysisSettlementRefresh } from "@/components/chat/useAnalysisSettlementRefresh";
import type { AnalysisSettlement } from "@/lib/stores/chat";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), acknowledge: vi.fn() }));
vi.mock("@/lib/stores/project", () => ({ useProjectStore: { getState: () => ({ currentProjectId: "project-1", refreshCurrent: mocks.refresh }) } }));
vi.mock("@/lib/stores/chat", () => ({ useChatStore: { getState: () => ({ acknowledgeAnalysisSettlement: mocks.acknowledge }) } }));
const event: AnalysisSettlement = { id: "stream-1", streamId: "stream-1", projectId: "project-1", outcome: "completed" };
beforeEach(() => vi.resetAllMocks());

describe("analysis settlement refresh", () => {
  it("invalidates the affected project's query prefixes without invalidating another project", async () => {
    const client = new QueryClient();
    client.setQueryData(["analysis-runs", "project-1", "history", 1], []);
    client.setQueryData(["analysis-runs", "project-2", "history", 1], []);
    client.setQueryData(["models"], []);
    const acknowledge = vi.fn(), refreshProject = vi.fn(async () => {});
    const refresh = createAnalysisSettlementRefresher({
      invalidate: queryKey => client.invalidateQueries({ queryKey }),
      currentProject: () => "project-1", refreshProject, acknowledge,
    });
    const first = refresh(event); expect(refresh({ ...event })).toBe(first);
    await first;
    expect(client.getQueryState(["analysis-runs", "project-1", "history", 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["analysis-runs", "project-2", "history", 1])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["models"])?.isInvalidated).toBe(true);
    expect(refreshProject).toHaveBeenCalledOnce(); expect(acknowledge).toHaveBeenCalledExactlyOnceWith("stream-1");
  });

  it("rechecks the current project and continues other refreshes through synchronous reader failure", async () => {
    const invalidate = vi.fn((key: readonly string[]) => {
      if (key[0] === "analysis-corrections") throw new Error("Reader failed");
      return Promise.resolve();
    });
    const refreshProject = vi.fn(async () => {}), acknowledge = vi.fn();
    let project = "project-1";
    const refresh = createAnalysisSettlementRefresher({ invalidate, currentProject: () => project, refreshProject, acknowledge });
    const completion = refresh({ ...event, outcome: "failed" }); project = "project-2";
    await completion;
    expect(refreshProject).not.toHaveBeenCalled(); expect(invalidate).toHaveBeenCalledTimes(7);
    expect(invalidate).toHaveBeenCalledWith(["standing-analyses", "project-1"]);
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("refreshes model availability without broad project invalidation when no project was recorded", async () => {
    const invalidate = vi.fn(async () => {}), acknowledge = vi.fn(), refreshProject = vi.fn(async () => {});
    const refresh = createAnalysisSettlementRefresher({ invalidate, currentProject: () => "project-1", refreshProject, acknowledge });
    await refresh({ ...event, projectId: null, outcome: "stopped" });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(["models"]);
    expect(refreshProject).not.toHaveBeenCalled(); expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("shares an in-flight refresh across Strict Mode and a workbench remount", async () => {
    let finish!: () => void;
    mocks.refresh.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>;
    const first = renderHook(() => useAnalysisSettlementRefresh([event]), { wrapper });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    first.unmount();
    const second = renderHook(() => useAnalysisSettlementRefresh([event]), { wrapper });
    expect(invalidate).toHaveBeenCalledTimes(7); expect(mocks.acknowledge).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledExactlyOnceWith("stream-1"));
    expect(mocks.refresh).toHaveBeenCalledOnce(); second.unmount();
  });
});
