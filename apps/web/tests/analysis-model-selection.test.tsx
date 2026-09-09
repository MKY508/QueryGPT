import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnalysisModelSelection } from "@/components/chat/useAnalysisModelSelection";
import { api } from "@/lib/api/client";
import type { AppSettings, ModelSummary } from "@/lib/types/api";
import zhMessages from "@/messages/zh.json";

vi.mock("@/lib/api/client", () => ({
  api: { put: vi.fn() },
}));

const models: ModelSummary[] = [
  {
    id: "service-a",
    name: "日常分析",
    provider: "custom",
    model_id: "model-a",
    is_default: false,
    credential_state: "readable",
    health_status: "healthy",
  },
  {
    id: "service-b",
    name: "深度分析",
    provider: "custom",
    model_id: "model-b",
    is_default: true,
    credential_state: "readable",
    health_status: "healthy",
  },
];

const settings: AppSettings = {
  default_model_id: "service-b",
  default_connection_id: null,
  context_rounds: 5,
  python_enabled: true,
  diagnostics_enabled: true,
  auto_repair_enabled: true,
  preprocessing_enabled: true,
  self_analysis_enabled: true,
};

function createWrapper(client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })) {
  client.setQueryData(["app-settings"], settings);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

describe("useAnalysisModelSelection model selection", () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset();
    localStorage.clear();
  });

  it("uses the backend default and ignores the retired browser-sticky choice", async () => {
    localStorage.setItem("receiptbi-selected-model", "service-a");
    const { result } = renderHook(
      () => useAnalysisModelSelection(models, settings),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("service-b"));
    expect(result.current.selectedModel?.name).toBe("深度分析");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("does not silently choose the newest service when no default exists", async () => {
    const noDefaultModels = models.map((model) => ({ ...model, is_default: false }));
    const noDefaultSettings = { ...settings, default_model_id: null };
    const { result } = renderHook(
      () => useAnalysisModelSelection(noDefaultModels, noDefaultSettings),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.selectedModelId).toBeNull());
    expect(result.current.modelReady).toBe(false);
    expect(api.put).not.toHaveBeenCalled();
  });

  it("persists a new service as the backend default", async () => {
    vi.mocked(api.put).mockResolvedValue({
      data: { data: { ...settings, default_model_id: "service-a" } },
    });
    const { result } = renderHook(
      () => useAnalysisModelSelection(models, settings),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.selectedModelId).toBe("service-b"));

    act(() => result.current.selectModel("service-a"));

    await waitFor(() => expect(result.current.selectedModelId).toBe("service-a"));
    expect(api.put).toHaveBeenCalledWith(
      "/api/v1/settings",
      { default_model_id: "service-a" }
    );
  });

  it("keeps an existing investigation on its recorded service", async () => {
    const { result } = renderHook(
      () =>
        useAnalysisModelSelection(models, settings, {
          selectionLocked: true,
          lockedModelId: "service-a",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("service-a"));
    act(() => result.current.selectModel("service-b"));
    expect(result.current.selectedModelId).toBe("service-a");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("clears a locked service that no longer exists instead of reusing another investigation", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useAnalysisModelSelection(models, settings, { selectionLocked: true, lockedModelId: id }),
      { wrapper: createWrapper(), initialProps: { id: "service-a" } }
    );
    expect(result.current.selectedModelId).toBe("service-a");
    rerender({ id: "missing" });
    expect(result.current.selectedModelId).toBeNull();
    expect(result.current.modelReady).toBe(false);
  });

  it.each(["success", "failure"])("preserves concurrent preferences after save %s and deduplicates clicks", async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.put).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }) as ReturnType<typeof api.put>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAnalysisModelSelection(models, settings), { wrapper: createWrapper(client) });
    act(() => {
      result.current.selectModel("service-a");
      result.current.selectModel("service-b");
    });
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(client.getQueryData<AppSettings>(["app-settings"])?.default_model_id).toBe("service-b");
    client.setQueryData(["app-settings"], { ...settings, context_rounds: 12 });
    await act(async () => {
      if (outcome === "success") resolve({ data: { data: { ...settings, default_model_id: "service-a" } } });
      else reject(new Error("Save failed"));
    });
    await waitFor(() => expect(result.current.modelSelectionSaving).toBe(false));
    expect(client.getQueryData<AppSettings>(["app-settings"])?.context_rounds).toBe(12);
    expect(result.current.selectedModelId).toBe(outcome === "success" ? "service-a" : "service-b");
  });

  it("uses the investigation lock immediately even while a default save is pending", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.put).mockImplementation(() => new Promise((yes) => { resolve = yes; }) as ReturnType<typeof api.put>);
    const { result, rerender } = renderHook(
      ({ locked }) => useAnalysisModelSelection(models, settings, { selectionLocked: locked, lockedModelId: "service-b" }),
      { wrapper: createWrapper(), initialProps: { locked: false } }
    );
    act(() => result.current.selectModel("service-a"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    rerender({ locked: true });
    expect(result.current.selectedModelId).toBe("service-b");
    await act(async () => resolve({ data: { data: { ...settings, default_model_id: "service-a" } } }));
    await waitFor(() => expect(result.current.modelSelectionSaving).toBe(false));
    expect(result.current.selectedModelId).toBe("service-b");
  });

  it("does not report a successful selection when the server confirms a different default", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { data: settings } });
    const { result } = renderHook(() => useAnalysisModelSelection(models, settings), { wrapper: createWrapper() });
    act(() => result.current.selectModel("service-a"));
    await waitFor(() => expect(result.current.modelSelectionError).not.toBeNull());
    expect(result.current.selectedModelId).toBe("service-b");
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("releases the local choice once settings catch up so later default changes remain visible", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { data: { ...settings, default_model_id: "service-a" } } });
    const { result, rerender } = renderHook(
      ({ defaults }) => useAnalysisModelSelection(models, defaults),
      { wrapper: createWrapper(), initialProps: { defaults: settings } }
    );
    act(() => result.current.selectModel("service-a"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.modelSelectionSaving).toBe(false));
    rerender({ defaults: { ...settings, default_model_id: "service-a" } });
    expect(result.current.selectedModelId).toBe("service-a");
    rerender({ defaults: settings });
    expect(result.current.selectedModelId).toBe("service-b");
  });
});
