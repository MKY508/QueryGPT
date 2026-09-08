import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModelSettingsResource } from "@/components/settings/hooks/useModelSettingsResource";
import { api } from "@/lib/api/client";
import { initialModelFormData } from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

vi.mock("@/lib/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const savedModel: ConfiguredModel = {
  id: "service-a",
  name: "日常分析",
  provider: "custom",
  model_id: "analysis-model",
  is_default: true,
  created_at: "2026-07-19T00:00:00Z",
  credential_state: "readable",
  health_status: "unknown",
};

const failedCheck = {
  success: false,
  message: "访问凭证需要更新",
  error_category: "auth",
  health_status: "unhealthy",
  checked_at: "2026-07-19T00:01:00Z",
};

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function resourceMessages(locale: "en" | "zh") {
  const messages = locale === "zh" ? zhMessages.modelSettings : enMessages.modelSettings;
  return {
    connectionCheckFailed: messages.testFailed,
    savedButConnectionCheckFailed: messages.savedButConnectionCheckFailed,
    addModelFailed: messages.addModelFailed,
    updateModelFailed: messages.updateModelFailed,
    deleteModelFailed: messages.deleteModelFailed,
  };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("useModelSettingsResource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
  });

  it("deduplicates the same service while independent checks keep their own outcomes", async () => {
    const first = deferred(), second = deferred();
    vi.mocked(api.post).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useModelSettingsResource(resourceMessages("en")), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      result.current.testModel("first"); result.current.testModel("first"); result.current.testModel("second");
    });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(result.current.checks.first).toEqual({ status: "checking" });
    await act(async () => { second.resolve({ data: { data: { success: true, id: "wrong-response-id" } } }); });
    await act(async () => { first.reject(new Error("Raw network failure")); });
    expect(result.current.checks).toEqual({
      first: { status: "failed", afterSave: false },
      second: { status: "complete", result: { id: "second", success: true } },
    });
    expect(result.current.error).toBeNull();
  });

  it("invalidates an old check when the service is edited without losing another receipt", async () => {
    const old = deferred(), current = deferred();
    vi.mocked(api.post).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: { data: { success: true } } }).mockReturnValueOnce(current.promise);
    vi.mocked(api.put).mockResolvedValue({ data: { data: savedModel } });
    const { result } = renderHook(() => useModelSettingsResource(resourceMessages("en")), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { result.current.testModel(savedModel.id); result.current.testModel("other"); });
    await waitFor(() => expect(result.current.checks.other.status).toBe("complete"));
    await act(async () => { await result.current.updateModel(savedModel.id, initialModelFormData); });
    expect(result.current.checks[savedModel.id].status).toBe("checking");
    await act(async () => { old.resolve({ data: { data: failedCheck } }); });
    expect(result.current.checks[savedModel.id].status).toBe("checking");
    await act(async () => { current.resolve({ data: { data: { success: true } } }); });
    expect(result.current.checks[savedModel.id]).toMatchObject({ status: "complete", result: { success: true } });
    expect(result.current.checks.other.status).toBe("complete");
  });

  it("does not revive a deleted service receipt when its request finishes late", async () => {
    const pending = deferred();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    vi.mocked(api.delete).mockResolvedValue({});
    const { result, unmount } = renderHook(() => useModelSettingsResource(resourceMessages("en")), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { result.current.testModel(savedModel.id); result.current.deleteModel(savedModel.id); });
    await waitFor(() => expect(result.current.deletePending).toBe(false));
    await act(async () => { pending.resolve({ data: { data: { success: true } } }); });
    expect(result.current.checks[savedModel.id]).toBeUndefined();
    unmount();
  });

  it("checks a newly saved service without turning a failed check into a failed save", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { data: savedModel } })
      .mockResolvedValueOnce({ data: { data: failedCheck } });

    const { result } = renderHook(() => useModelSettingsResource(resourceMessages("zh")), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(
        result.current.addModel({
          ...initialModelFormData,
          name: savedModel.name,
          provider: savedModel.provider,
          model_id: savedModel.model_id,
          base_url: "https://gateway.example/v1",
          api_key: "secret",
        })
      ).resolves.toEqual(savedModel);
    });

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/api/v1/config/models/${savedModel.id}/test`)
    );
    await waitFor(() => expect(result.current.checks[savedModel.id]).toMatchObject({ status: "complete", result: failedCheck }));
    expect(result.current.error).toBeNull();
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("checks an updated service after the update is safely stored", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { data: savedModel } });
    vi.mocked(api.post).mockResolvedValue({
      data: {
        data: {
          ...failedCheck,
          success: true,
          message: "连接成功",
          error_category: null,
          health_status: "healthy",
        },
      },
    });

    const { result } = renderHook(() => useModelSettingsResource(resourceMessages("zh")), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateModel(savedModel.id, {
        ...initialModelFormData,
        name: savedModel.name,
        provider: savedModel.provider,
        model_id: savedModel.model_id,
        base_url: "https://gateway.example/v1",
      });
    });

    expect(api.put).toHaveBeenCalledWith(
      `/api/v1/config/models/${savedModel.id}`,
      expect.objectContaining({ name: savedModel.name })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/api/v1/config/models/${savedModel.id}/test`)
    );
    await waitFor(() => expect(result.current.checks[savedModel.id]).toMatchObject({ status: "complete", result: { success: true } }));
  });

  it("keeps a manual check failure on its service without exposing server prose", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { error: { message: "固定中文服务错误" } } },
    });

    const { result } = renderHook(
      () => useModelSettingsResource(resourceMessages("en")),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.testModel(savedModel.id));

    await waitFor(() => expect(result.current.checks[savedModel.id]).toEqual({ status: "failed", afterSave: false }));
    expect(result.current.error).toBeNull();
  });

  it("distinguishes a saved service with an unfinished check from a failed save", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { data: savedModel } })
      .mockRejectedValueOnce({
        response: { data: { error: { message: "Raw provider failure" } } },
      });

    const { result } = renderHook(
      () => useModelSettingsResource(resourceMessages("zh")),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addModel({
        ...initialModelFormData,
        name: savedModel.name,
        provider: savedModel.provider,
        model_id: savedModel.model_id,
      });
    });

    await waitFor(() =>
      expect(result.current.checks[savedModel.id]).toEqual({ status: "failed", afterSave: true })
    );
    expect(result.current.error).toBeNull();
  });

  it("uses a safe localized save error instead of a raw server message", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { error: { message: "服务端固定中文" } } },
    });

    const { result } = renderHook(
      () => useModelSettingsResource(resourceMessages("en")),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.addModel(initialModelFormData)).rejects.toBeDefined();
    });

    await waitFor(() =>
      expect(result.current.error).toBe("Failed to add model, please check config")
    );
    expect(result.current.error).not.toBe("服务端固定中文");
  });
});
