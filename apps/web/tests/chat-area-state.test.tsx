import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatAreaState } from "@/components/chat/useChatAreaState";
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

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["app-settings"], settings);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

describe("useChatAreaState model selection", () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset();
    localStorage.clear();
  });

  it("uses the backend default and ignores the retired browser-sticky choice", async () => {
    localStorage.setItem("receiptbi-selected-model", "service-a");
    const { result } = renderHook(
      () => useChatAreaState(models, settings),
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
      () => useChatAreaState(noDefaultModels, noDefaultSettings),
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
      () => useChatAreaState(models, settings),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.selectedModelId).toBe("service-b"));

    act(() => result.current.selectModel("service-a"));

    await waitFor(() => expect(result.current.selectedModelId).toBe("service-a"));
    expect(api.put).toHaveBeenCalledWith(
      "/api/v1/settings",
      expect.objectContaining({ default_model_id: "service-a" })
    );
  });

  it("keeps an existing investigation on its recorded service", async () => {
    const { result } = renderHook(
      () =>
        useChatAreaState(models, settings, {
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
});
