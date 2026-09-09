import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisHistoryDialog } from "@/components/chat/AnalysisHistoryDialog";
import { api } from "@/lib/api/client";
import messages from "@/messages/zh.json";
import type { AnalysisHistoryItem, AnalysisHistoryPage } from "@/lib/types/api";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn() } }));
const clients: QueryClient[] = [];
let rows: AnalysisHistoryItem[];
function fixture(params: Record<string, unknown> = {}): AnalysisHistoryPage {
  const current = rows.find(row => row.id === params.current_run_id)?.id ?? null;
  const terms = String(params.q ?? "").normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);
  const selected = rows.filter(row => (!params.status || params.status === "all" || row.state === params.status)
    && terms.every(term => [row.query, row.report.title, row.report.summary].join("\n").normalize("NFKC").toLowerCase().includes(term)))
    .sort((a, b) => Number(b.id === current) - Number(a.id === current));
  const pageCount = Math.max(1, Math.ceil(selected.length / 12));
  const page = Math.min(Number(params.page ?? 1), pageCount);
  return { items: selected.slice((page - 1) * 12, page * 12), count: selected.length, total: rows.length,
    page, page_count: pageCount, page_size: 12, current_run_id: current };
}
function mount(current: string | null = "run-25", enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const open = vi.fn();
  const content = (projectId: string, currentId = current, active = enabled) => <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={messages}><AnalysisHistoryDialog key={projectId} projectId={projectId}
      currentAnalysisRunId={currentId} open={active} projectName="财务分析" onClose={vi.fn()} onNewAnalysis={vi.fn()} onOpenReport={open} /></NextIntlClientProvider>
  </QueryClientProvider>;
  return { ...render(content("project-1")), content, client, open };
}
describe("server-backed analysis history", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  });
  beforeEach(() => {
    rows = Array.from({ length: 26 }, (_, i) => ({ id: `run-${i}`, project_id: "project-1", conversation_id: `c-${i}`,
      query: `收入 ${i}`, state: i === 25 ? "waiting_confirmation" : "completed", stage: "completed",
      report: { title: `历史 ${i}`, summary: i === 25 ? "华东 Ｓａｌｅｓ ２０２６" : "门店" },
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }));
    vi.mocked(api.get).mockReset().mockImplementation(async (_url, config) => ({ data: { data: fixture(config?.params) } }));
  });
  afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

  it("fetches only on opening, pages on the server and locates the current result", async () => {
    const view = mount("run-25", false);
    expect(api.get).not.toHaveBeenCalled();
    view.rerender(view.content("project-1", "run-25", true));
    await screen.findByRole("button", { name: /预览分析：历史 25/ });
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(api.get).toHaveBeenLastCalledWith("/api/v1/projects/project-1/analysis-history", expect.objectContaining({
      signal: expect.any(AbortSignal), params: expect.objectContaining({ page: 1, page_size: 12, current_run_id: "run-25" }) }));
    const next = screen.getByRole("button", { name: "下一页分析" }); next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("13–24 / 26"));
    expect(next).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "下一页分析" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("25–26 / 26"));
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("aria-disabled", "true");
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(next);
    expect(api.get).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole("button", { name: /预览分析：历史 24/ }));
    expect(view.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开这条分析" }));
    expect(view.open).toHaveBeenCalledWith("c-24", "run-24");
    fireEvent.click(screen.getByRole("button", { name: "定位当前分析" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–12 / 26"));
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("browses previews across pages in both directions while retaining focus and search", async () => {
    const view = mount(null);
    await screen.findByRole("button", { name: "预览分析：历史 0" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–12 / 25"));
    fireEvent.click(screen.getByRole("button", { name: "预览分析：历史 11" }));
    expect(screen.getByText("第 12 条分析，共 25 条").parentElement).toHaveTextContent("12 / 25");
    const next = screen.getByRole("button", { name: "预览下一条分析" });
    next.focus(); fireEvent.click(next);
    await screen.findByRole("heading", { name: "历史 12" });
    expect(screen.getByText("第 13 条分析，共 25 条").parentElement).toHaveTextContent("13 / 25");
    expect(next).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("门店");
    expect(screen.getByRole("status")).toHaveTextContent("13–24 / 25");
    const previous = screen.getByRole("button", { name: "预览上一条分析" });
    previous.focus(); fireEvent.click(previous);
    await screen.findByRole("heading", { name: "历史 11" });
    expect(screen.getByText("第 12 条分析，共 25 条").parentElement).toHaveTextContent("12 / 25");
    expect(previous).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    expect(screen.getByRole("button", { name: "预览分析：历史 11" })).toHaveFocus();
    expect(view.open).not.toHaveBeenCalled();
  });

  it("keeps the prior preview on cross-page failure and retries without opening stale content", async () => {
    const view = mount(null);
    fireEvent.click(await screen.findByRole("button", { name: "预览分析：历史 11" }));
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    const next = screen.getByRole("button", { name: "预览下一条分析" });
    next.focus(); fireEvent.click(next);
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "历史 11" })).toBeInTheDocument();
    expect(screen.getByText("第 12 条分析，共 26 条").parentElement).toHaveTextContent("12 / 26");
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "打开这条分析" })).toBeDisabled();
    fireEvent.click(next);
    expect(api.get).toHaveBeenCalledTimes(2);
    const retry = screen.getByRole("button", { name: "重新读取" });
    act(() => retry.focus()); fireEvent.click(retry);
    await screen.findByRole("heading", { name: "历史 12" });
    expect(screen.getByRole("heading", { name: "历史 12" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "打开这条分析" })).not.toBeDisabled();
    expect(view.open).not.toHaveBeenCalled();
  });

  it("cancels pending cross-page preview when returning to the directory", async () => {
    const view = mount(null);
    fireEvent.click(await screen.findByRole("button", { name: "预览分析：历史 11" }));
    let resolvePage!: (value: unknown) => void;
    let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementationOnce((_url, config) => {
      signal = config!.signal as AbortSignal;
      return new Promise(resolve => { resolvePage = resolve; });
    });
    fireEvent.click(screen.getByRole("button", { name: "预览下一条分析" }));
    await waitFor(() => expect(signal).toBeDefined());
    expect(screen.getByRole("heading", { name: "历史 11" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "预览分析：历史 11" })).toHaveFocus());
    await act(async () => resolvePage({ data: { data: fixture({ page: 2 }) } }));
    expect(screen.queryByRole("heading", { name: "历史 12" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1–12 / 26");
    expect(view.open).not.toHaveBeenCalled();
  });

  it("debounces full-history searches, keeps status and clears no-match filters", async () => {
    mount();
    await screen.findByRole("button", { name: /预览分析：历史 25/ });
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "华东" } });
    fireEvent.change(search, { target: { value: "2026 华东 sales" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "waiting_confirmation" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–1 / 1"));
    const searches = vi.mocked(api.get).mock.calls.map(([, config]) => config?.params.q).filter(Boolean);
    expect(searches).toEqual(["2026 华东 sales"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "completed" } });
    await screen.findByText("没有匹配的分析");
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–12 / 26"));
    expect(search).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("all");
  });

  it("cancels obsolete searches, waits for IME and cannot show the previous project", async () => {
    const view = mount();
    await screen.findByRole("button", { name: /预览分析：历史 25/ });
    const search = screen.getByRole("searchbox");
    let resolveOld!: (value: unknown) => void;
    let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementationOnce((_url, config) => {
      signal = config!.signal as AbortSignal;
      return new Promise(resolve => { resolveOld = resolve; });
    });
    fireEvent.change(search, { target: { value: "旧" } });
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "新项目" } });
    expect(signal.aborted).toBe(true);
    const calls = vi.mocked(api.get).mock.calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
    expect(api.get).toHaveBeenCalledTimes(calls);
    const oldPage = fixture(); rows = [];
    view.rerender(view.content("project-2", null));
    await act(async () => resolveOld({ data: { data: oldPage } }));
    await screen.findByText("尚无调查");
    expect(screen.queryByText("历史 25")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("retains a same-page failed refresh, retries and never revives an invalid page", async () => {
    const view = mount(null);
    await screen.findByRole("button", { name: /预览分析：历史 0/ });
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    await act(() => view.client.invalidateQueries({ queryKey: ["analysis-runs"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("历史分析未能更新");
    expect(screen.getByText("历史 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "下一页分析" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("13–24 / 26"));
    const all = rows; rows = rows.slice(0, 1);
    await act(() => view.client.invalidateQueries({ queryKey: ["analysis-runs"] }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–1 / 1"));
    rows = all;
    await act(() => view.client.invalidateQueries({ queryKey: ["analysis-runs"] }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1–12 / 26"));
    expect(screen.queryByRole("button", { name: /不存在的当前记录/ })).not.toBeInTheDocument();
  });

  it("distinguishes first-read and page-turn failure from empty history", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    mount("unavailable");
    await screen.findByRole("alert");
    expect(screen.queryByText("尚无调查")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await screen.findByText("历史 0");
    vi.mocked(api.get).mockRejectedValueOnce(new Error("page failed"));
    fireEvent.click(screen.getByRole("button", { name: "下一页分析" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "上一页分析" })).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(screen.getByRole("button", { name: "上一页分析" }));
    await screen.findByText("历史 0");
    expect(screen.queryByRole("button", { name: /不存在的当前记录/ })).not.toBeInTheDocument();
  });
});
