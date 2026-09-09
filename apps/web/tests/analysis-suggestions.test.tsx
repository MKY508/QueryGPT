import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSuggestedQuestions, suggestionScope, readSuggestedQuestions } from "@/components/chat/useSuggestedQuestions";
import { AnalysisSuggestions } from "@/components/chat/AnalysisSuggestions";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import type { ProjectDataSource } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

vi.mock("@/lib/api/client", () => ({ api: { post: vi.fn() } }));
const source: ProjectDataSource = { id: "orders", project_id: "project-a", name: "Orders", kind: "file", status: "ready", profile_data: {}, updated_at: "today", created_at: "today" };
const options = { projectId: "project-a", modelId: "service-a", locale: "zh", sources: [source], contextRevision: 0, enabled: true };
const questions = [{ label: "比较各门店营收", prompt: "请比较各门店的营收变化。", reason: "先看看收入主要来自哪些门店。" }];
const response = (items = questions) => ({ data: { data: { items, context_signature: "fixture", generated_by: "preflight" } } });
const generate = vi.fn(), usePrompt = vi.fn();
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void, reject!: (value: unknown) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const Panel = ({ loading = false, failed = false, generated = true, items = questions, locale = "zh" }: { loading?: boolean; failed?: boolean; generated?: boolean; items?: typeof questions; locale?: "zh" | "en" }) =>
  <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><AnalysisSuggestions items={items} loading={loading} failed={failed} generated={generated}
    settingsLoaded canGenerate onGenerate={generate} onUsePrompt={usePrompt} /></NextIntlClientProvider>;

describe("manual analysis suggestions", () => {
  beforeEach(() => { client = new QueryClient(); vi.mocked(api.post).mockReset(); generate.mockClear(); usePrompt.mockClear(); });
  afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); });

  it("only generates explicitly, suppresses synchronous duplicate clicks and never queues an offline retry", async () => {
    onlineManager.setOnline(false); const pending = deferred(); vi.mocked(api.post).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSuggestedQuestions(options), { wrapper: Wrapper });
    expect(api.post).not.toHaveBeenCalled();
    act(() => { void result.current.generate(); void result.current.generate(); });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1)); expect(result.current.loading).toBe(true);
    expect(vi.mocked(api.post).mock.calls[0]).toEqual(["/api/v1/projects/project-a/suggested-questions", { model_id: "service-a", locale: "zh" }, { timeout: 20000, signal: expect.any(AbortSignal) }]);
    await act(async () => pending.reject(new Error("private provider details")));
    expect(result.current.failed).toBe(true); expect(result.current.loading).toBe(false);
    act(() => onlineManager.setOnline(true)); expect(api.post).toHaveBeenCalledTimes(1);
    expect(client.getMutationCache().getAll().every(mutation => !mutation.state.isPaused)).toBe(true);
  });

  it("keeps prior questions during refresh and failure, but distinguishes a valid empty generation", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(response());
    const { result } = renderHook(() => useSuggestedQuestions(options), { wrapper: Wrapper });
    await act(async () => result.current.generate()); expect(result.current.items).toEqual(questions);
    const pending = deferred(); vi.mocked(api.post).mockReturnValueOnce(pending.promise);
    act(() => { void result.current.generate(); }); expect(result.current.items).toEqual(questions); expect(result.current.loading).toBe(true);
    await act(async () => pending.reject({ response: { data: { detail: "raw upstream config" } } }));
    expect(result.current.items).toEqual(questions); expect(result.current.failed).toBe(true);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { data: { items: [{ prompt: "invalid" }] } } });
    await act(async () => result.current.generate()); expect(result.current.items).toEqual(questions); expect(result.current.failed).toBe(true);
    vi.mocked(api.post).mockResolvedValueOnce(response([]));
    await act(async () => result.current.generate()); expect(result.current).toMatchObject({ items: [], generated: true, loading: false, failed: false });
  });

  it("invalidates by project, service, language, sources and local knowledge revision without regenerating", async () => {
    vi.mocked(api.post).mockResolvedValue(response());
    const { result, rerender } = renderHook(props => useSuggestedQuestions(props), { initialProps: options, wrapper: Wrapper });
    await act(async () => result.current.generate()); const staleAction = result.current.generate;
    rerender({ ...options, contextRevision: 1 }); expect(result.current.items).toEqual([]); expect(result.current.generated).toBe(false);
    await act(async () => staleAction()); expect(api.post).toHaveBeenCalledTimes(1);
    for (const changed of [{ ...options, locale: "en" }, { ...options, modelId: "service-b" }, { ...options, projectId: "project-b" }, { ...options, sources: [{ ...source, updated_at: "tomorrow" }] }, { ...options, enabled: false }]) {
      rerender(changed); expect(result.current.items).toEqual([]); expect(result.current.loading).toBe(false);
    }
    await act(async () => result.current.generate()); expect(api.post).toHaveBeenCalledTimes(1);
    const two = [source, { ...source, id: "returns" }];
    expect(suggestionScope({ ...options, sources: two })).toBe(suggestionScope({ ...options, sources: [...two].reverse() }));
  });

  it("aborts abandoned requests and ignores late responses even after returning to the same project", async () => {
    const old = deferred(), fresh = deferred(); vi.mocked(api.post).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender, unmount } = renderHook(props => useSuggestedQuestions(props), { initialProps: options, wrapper: Wrapper });
    act(() => { void result.current.generate(); }); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(api.post).mock.calls[0][2]?.signal;
    rerender({ ...options, projectId: "project-b" }); expect(oldSignal?.aborted).toBe(true);
    rerender(options); act(() => { void result.current.generate(); }); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await act(async () => old.resolve(response())); expect(result.current.items).toEqual([]); expect(result.current.loading).toBe(true);
    act(() => { void result.current.generate(); }); expect(api.post).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve(response([{ ...questions[0], label: "新一组问题" }]))); expect(result.current.items[0].label).toBe("新一组问题");
    const action = result.current.generate; unmount(); await act(async () => action()); expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed responses instead of exposing partial payloads and copies only prompt display fields", () => {
    for (const value of [null, {}, { items: null }, { items: [null] }, { items: [{ ...questions[0], reason: " " }] }, { items: Array(4).fill(questions[0]) }]) expect(() => readSuggestedQuestions(value)).toThrow();
    expect(readSuggestedQuestions({ items: [{ ...questions[0], prompt: "  保留空格与\n换行  ", secret: "do-not-display" }] })).toEqual([{ ...questions[0], prompt: "  保留空格与\n换行  " }]);
  });

  it("keeps usable cards while refreshing, provides retry and exposes localized names and descriptions", () => {
    const { rerender } = render(<Panel />);
    const card = screen.getByRole("button", { name: questions[0].label }); expect(card).toHaveAccessibleDescription(questions[0].reason);
    fireEvent.click(screen.getByTestId("suggestions-generate")); expect(generate).toHaveBeenCalledTimes(1);
    rerender(<Panel loading />); expect(screen.getByTestId("suggestions-generate")).toBeDisabled(); expect(card).toBeEnabled();
    fireEvent.click(card); expect(usePrompt).toHaveBeenCalledWith(questions[0].prompt);
    rerender(<Panel failed locale="en" />); expect(screen.getByRole("alert")).toHaveTextContent(en.chatEmpty.suggestionsRefreshFailed);
    expect(screen.getByTestId("suggestions-generate")).toHaveTextContent(en.chatEmpty.retrySuggestions); expect(card).toBeEnabled();
    rerender(<Panel items={[]} locale="en" />); expect(screen.getByText(en.chatEmpty.suggestionsEmpty)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 suggested questions are ready");
  });

  it("respects the actual empty-workspace settings gate and never generates on mount or settings arrival", () => {
    const props = { sources: [source], standingAnalyses: [], suggestedQuestions: [], suggestionsLoading: false, canGenerateSuggestions: true,
      composer: null, activityLoading: false, onOpenData: vi.fn(), onOpenSettings: vi.fn(), onGenerateSuggestions: generate,
      onUsePrompt: usePrompt, onOpenReport: vi.fn(), onCheckStanding: vi.fn() };
    const tree = (enabled: boolean, loaded: boolean) => <NextIntlClientProvider locale="zh" messages={zh}><ChatEmptyState {...props} selfAnalysisEnabled={enabled} settingsLoaded={loaded} /></NextIntlClientProvider>;
    const { rerender } = render(tree(false, true)); expect(screen.queryByTestId("analysis-suggestions")).not.toBeInTheDocument();
    rerender(tree(false, false)); expect(screen.getByTestId("suggestions-generate")).toBeDisabled();
    rerender(tree(true, true)); expect(screen.getByTestId("suggestions-generate")).toBeEnabled(); expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("suggestions-generate")); expect(generate).toHaveBeenCalledTimes(1);
  });
});
