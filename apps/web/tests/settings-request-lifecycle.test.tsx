import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSettings } from "@/components/settings/ConnectionSettings";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { useConnectionSettingsResource } from "@/components/settings/hooks/useConnectionSettingsResource";
import { useModelSettingsResource } from "@/components/settings/hooks/useModelSettingsResource";
import { createWorkspaceQueryClient } from "@/lib/api/query-client";
import { api } from "@/lib/api/client";
import messages from "@/messages/zh.json";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

let client: ReturnType<typeof createWorkspaceQueryClient>;
let restoreDialogs: () => void;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><NextIntlClientProvider locale="zh" messages={messages}>
    {children}
  </NextIntlClientProvider></QueryClientProvider>;
}

const modelCopy = {
  connectionCheckFailed: messages.modelSettings.testFailed,
  savedButConnectionCheckFailed: messages.modelSettings.savedButConnectionCheckFailed,
  addModelFailed: messages.modelSettings.addModelFailed,
  updateModelFailed: messages.modelSettings.updateModelFailed,
  deleteModelFailed: messages.modelSettings.deleteModelFailed,
};
const connectionCopy = {
  success: messages.connectionSettings.testResultSuccess,
  failure: messages.connectionSettings.testResultFailed,
  requestFailure: messages.connectionSettings.testRequestFailed,
};

describe("settings request lifecycle", () => {
  beforeEach(() => {
    restoreDialogs = mockSemanticDialogs();
    client = createWorkspaceQueryClient();
    vi.mocked(api.get).mockReset().mockResolvedValue({ data: { data: [] } });
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
  });
  afterEach(() => { cleanup(); restoreDialogs(); client.clear(); onlineManager.setOnline(true); vi.restoreAllMocks(); });

  it.each(["model", "connection"] as const)("protects the actual %s form before closing and never submits on discard", async kind => {
    render(kind === "model" ? <ModelSettings /> : <ConnectionSettings />, { wrapper: Wrapper });
    await screen.findByText(kind === "model" ? messages.modelSettings.noModels : messages.connectionSettings.noConnections);
    fireEvent.click(screen.getByTestId(`${kind}-add-button`));
    const name = screen.getByTestId(`${kind}-name-input`);
    const secret = screen.getByTestId(kind === "model" ? "model-api-key-input" : "connection-password-input");
    fireEvent.change(name, { target: { value: "Unfinished configuration" } });
    fireEvent.change(secret, { target: { value: "fixture-not-a-real-secret" } });
    fireEvent.click(screen.getByTestId(`${kind}-add-button`));
    expect(name).toHaveValue("Unfinished configuration");
    fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(messages.settingsUnsaved[kind === "model" ? "models" : "connections"]);
    fireEvent.click(screen.getByRole("button", { name: messages.settingsUnsaved.continueEditing }));
    expect(secret).toHaveValue("fixture-not-a-real-secret");
    fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
    fireEvent.click(screen.getByRole("button", { name: messages.settingsUnsaved.discardClose }));
    expect(screen.queryByTestId(`${kind}-form`)).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
  });

  it.each(["models", "connections"] as const)("shows %s read failure instead of an empty list while internet is offline", async (kind) => {
    onlineManager.setOnline(false);
    vi.mocked(api.get).mockRejectedValue(new Error("Local API unavailable"));
    render(kind === "models" ? <ModelSettings /> : <ConnectionSettings />, { wrapper: Wrapper });
    const copy = kind === "models" ? messages.modelSettings : messages.connectionSettings;
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadError);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(screen.queryByText(messages.modelSettings.noModels)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.connectionSettings.noConnections)).not.toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
    fireEvent.click(screen.getByRole("button", { name: messages.common.refresh }));
    await screen.findByText(kind === "models" ? messages.modelSettings.noModels : messages.connectionSettings.noConnections);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await client.invalidateQueries({ queryKey: [kind], exact: true, refetchType: "none" });
    await act(async () => { onlineManager.setOnline(true); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("preserves database input on a failed offline save, rejects double submit and never logs its credentials", async () => {
    onlineManager.setOnline(false);
    const pending = deferred<unknown>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ConnectionSettings />, { wrapper: Wrapper });
    await screen.findByText(messages.connectionSettings.noConnections);
    fireEvent.click(screen.getByTestId("connection-add-button"));
    const name = screen.getByTestId("connection-name-input");
    const password = screen.getByTestId("connection-password-input");
    fireEvent.change(name, { target: { value: "Monthly warehouse" } });
    fireEvent.change(screen.getByTestId("connection-database-input"), { target: { value: "monthly_orders" } });
    fireEvent.change(screen.getByTestId("connection-username-input"), { target: { value: "fixture_reader" } });
    fireEvent.change(password, { target: { value: "example-sensitive-input" } });
    const form = screen.getByTestId("connection-form");
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(name).toBeDisabled();
    expect(password).toBeDisabled();
    expect(screen.getByTestId("connection-add-button")).toBeDisabled();
    await act(async () => { pending.reject({ config: { data: "example-sensitive-input" } }); });
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.connectionSettings.saveFailed);
    expect(name).toHaveValue("Monthly warehouse");
    expect(password).toHaveValue("example-sensitive-input");
    expect(name).toBeEnabled();
    expect(log).not.toHaveBeenCalled();
    await act(async () => { onlineManager.setOnline(true); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(client.getMutationCache().getAll().every((mutation) => !mutation.state.isPaused)).toBe(true);
  });

  it.each(["models", "connections"] as const)("keeps the latest %s check when an older result arrives last", async (kind) => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    vi.mocked(api.post).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    function useChecks() {
      const model = useModelSettingsResource(modelCopy);
      const connection = useConnectionSettingsResource(connectionCopy);
      return kind === "models" ? { check: model.testModel, result: model.checks.second?.status === "complete" ? model.checks.second.result : null } : { check: connection.testConnection, result: connection.testResult };
    }
    const { result } = renderHook(useChecks, { wrapper: Wrapper });
    act(() => { result.current.check("first"); result.current.check("second"); });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve({ data: { data: { connected: true, success: true } } }); });
    await waitFor(() => expect(result.current.result?.id).toBe("second"));
    await act(async () => { first.resolve({ data: { data: { connected: false, success: false } } }); });
    expect(result.current.result).toMatchObject({ id: "second", success: true });
  });

  it("aborts a settings list read when its last consumer leaves", async () => {
    const pending = deferred<unknown>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const { unmount } = render(<ConnectionSettings />, { wrapper: Wrapper });
    const signal = vi.mocked(api.get).mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ data: { data: [] } }); });
    expect(client.getQueryState(["connections"])?.data).toBeUndefined();
  });

  it.each(["models", "connections"] as const)("retains the %s draft while hidden without refetching its directory", async kind => {
    const model = kind === "models";
    const content = (active: boolean) => model ? <ModelSettings active={active} /> : <ConnectionSettings active={active} />;
    const view = render(content(true), { wrapper: Wrapper });
    await screen.findByText(model ? messages.modelSettings.noModels : messages.connectionSettings.noConnections);
    const prefix = model ? "model" : "connection";
    fireEvent.click(screen.getByTestId(`${prefix}-add-button`));
    fireEvent.change(screen.getByTestId(`${prefix}-name-input`), { target: { value: "未完成的配置" } });
    view.rerender(content(false));
    const reads = vi.mocked(api.get).mock.calls.length;
    await act(async () => { await client.invalidateQueries({ queryKey: [kind], exact: true }); });
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(screen.getByTestId(`${prefix}-name-input`)).toHaveValue("未完成的配置");
    view.rerender(content(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(reads + 1));
    expect(screen.getByTestId(`${prefix}-name-input`)).toHaveValue("未完成的配置");
    expect(api.post).not.toHaveBeenCalled();
  });
});
