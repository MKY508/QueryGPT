import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisHistoryDialog, type AnalysisHistoryDialogProps } from "@/components/chat/AnalysisHistoryDialog";
import { inspectAnalysisHistoryPage } from "@/lib/analysis-history";
import { api } from "@/lib/api/client";
import type { AnalysisHistoryItem, AnalysisHistoryPage } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn() } }));
const clients: QueryClient[] = [];
let rows: AnalysisHistoryItem[];
function page(): AnalysisHistoryPage {
  return { items: rows, count: rows.length, total: rows.length, page: 1, page_count: 1, page_size: 12, current_run_id: "run-1" };
}
function mount(overrides: Partial<AnalysisHistoryDialogProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const props: AnalysisHistoryDialogProps = { open: true, projectId: "project-1", projectName: "财务分析", currentAnalysisRunId: "run-1",
    onClose: vi.fn(), onOpenReport: vi.fn(), onNewAnalysis: vi.fn(), ...overrides };
  const content = (patch: Partial<AnalysisHistoryDialogProps> = {}, locale = "zh") => <QueryClientProvider client={client}>
    <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><AnalysisHistoryDialog {...props} {...patch} /></NextIntlClientProvider>
  </QueryClientProvider>;
  return { ...render(content()), content, client, props };
}
describe("analysis history preview navigation", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    rows = ["营收增长", "配送费用", "毛利下降"].map((title, index) => ({ id: `run-${index + 1}`, project_id: "project-1", conversation_id: `conversation-${index + 1}`,
      query: `分析${title}的原因`, report: { title, summary: `${title}，需要结合门店结构观察。` }, state: "completed", stage: "completed",
      created_at: "2026-08-01T01:00:00Z", updated_at: "2026-09-01T01:00:00Z" }));
    vi.mocked(api.get).mockReset().mockImplementation(async () => ({ data: { data: page() } }));
  });
  afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

  it("shows bounded search context from summaries or original questions without opening a report", async () => {
    rows[0].report.summary = "背景。".repeat(100) + "Ｃａｆｅ́ <script>观察</script>" + "补充。".repeat(100);
    rows[1].query = "比较Ｃａｆｅ́的费用";
    const view = mount();
    await screen.findByRole("button", { name: "预览分析：营收增长" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "café" } });
    await waitFor(() => expect(view.container.querySelectorAll("mark")).toHaveLength(2));
    const summary = screen.getByRole("button", { name: "预览分析：营收增长" });
    expect(summary).toHaveAccessibleDescription(expect.stringContaining("Ｃａｆｅ́"));
    const marked = summary.querySelector("mark")!;
    expect(marked.parentElement!.textContent!.length).toBeLessThan(80);
    expect(marked.parentElement).toHaveTextContent("<script>观察</script>");
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.getByRole("button", { name: "预览分析：配送费用" })).toHaveTextContent("分析问题 · 比较Ｃａｆｅ́的费用");
    expect(view.props.onOpenReport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await waitFor(() => expect(view.container.querySelectorAll("mark")).toHaveLength(0));
  });

  it("previews before opening, browses adjacent summaries and retains names and selection across language changes", async () => {
    const view = mount();
    const row = await screen.findByRole("button", { name: "预览分析：配送费用" });
    row.focus(); fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "配送费用" })).toBeInTheDocument();
    expect(view.props.onOpenReport).not.toHaveBeenCalled(); expect(api.get).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "预览下一条分析" }));
    expect(screen.getByRole("heading", { name: "毛利下降" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    expect(screen.getByRole("button", { name: "预览分析：毛利下降" })).toHaveFocus();
    fireEvent.click(row);
    view.rerender(view.content({}, "en"));
    expect(screen.getByRole("heading", { name: "配送费用" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Analysis preview" })).getByText("分析配送费用的原因")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open this analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Open this analysis" }));
    expect(view.props.onOpenReport).toHaveBeenCalledExactlyOnceWith("conversation-2", "run-2");
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps focused preview paging controls available at boundaries without opening reports", async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "预览分析：配送费用" }));
    const next = screen.getByRole("button", { name: "预览下一条分析" });
    next.focus(); fireEvent.click(next);
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAccessibleDescription("毛利下降");
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "毛利下降" })).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: "预览上一条分析" });
    previous.focus(); fireEvent.click(previous); fireEvent.click(previous);
    expect(previous).toHaveFocus();
    expect(previous).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(previous);
    expect(previous).toHaveAccessibleDescription("营收增长");
    expect(screen.getByRole("heading", { name: "营收增长" })).toHaveAttribute("aria-live", "polite");
    expect(view.props.onOpenReport).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledOnce();
  });

  it("allows preview while busy, blocks unavailable targets and returns to the current result without loading it", async () => {
    rows[2].conversation_id = null;
    const view = mount({ disabled: true });
    fireEvent.click(await screen.findByRole("button", { name: "预览分析：配送费用" }));
    expect(screen.getByRole("heading", { name: "配送费用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开这条分析" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "打开这条分析" }));
    expect(view.props.onOpenReport).not.toHaveBeenCalled();
    view.rerender(view.content({ disabled: false }));
    fireEvent.click(screen.getByRole("button", { name: "预览下一条分析" }));
    expect(screen.getByText("原分析已无法打开。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开这条分析" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    fireEvent.click(screen.getByRole("button", { name: "预览分析：营收增长" }));
    fireEvent.click(screen.getByRole("button", { name: "返回当前分析" }));
    expect(view.props.onOpenReport).not.toHaveBeenCalled(); expect(view.props.onClose).toHaveBeenCalledOnce();
  });

  it("owns keyboard shortcuts and IME Escape, keeps search on reopen and restores the invoking control", async () => {
    const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
    const outside = vi.fn(); window.addEventListener("keydown", outside);
    try {
      const view = mount();
      const search = screen.getByRole("searchbox");
      await waitFor(() => expect(search).toHaveFocus());
      const row = await screen.findByRole("button", { name: "预览分析：配送费用" });
      fireEvent.keyDown(search, { key: "ArrowDown", ctrlKey: true }); expect(search).toHaveFocus();
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(screen.getByRole("button", { name: "预览分析：营收增长" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "End", isComposing: true });
      expect(screen.getByRole("button", { name: "预览分析：营收增长" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "End" });
      expect(screen.getByRole("button", { name: "预览分析：毛利下降" })).toHaveFocus();
      expect(view.props.onOpenReport).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: "毛利下降" })).not.toBeInTheDocument();
      fireEvent.keyDown(document.activeElement!, { key: "Home" });
      expect(screen.getByRole("button", { name: "预览分析：营收增长" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); expect(row).toHaveFocus();
      fireEvent.click(row);
      fireEvent.keyDown(screen.getByRole("button", { name: "返回列表" }), { key: "Escape", isComposing: true });
      expect(screen.getByRole("heading", { name: "配送费用" })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("button", { name: "返回列表" }), { key: "k", metaKey: true });
      expect(search).toHaveFocus(); expect(view.props.onClose).not.toHaveBeenCalled();
      fireEvent.change(search, { target: { value: "门店" } });
      fireEvent.keyDown(search, { key: "Escape", keyCode: 229 }); expect(search).toHaveValue("门店");
      fireEvent.keyDown(search, { key: "Escape" }); expect(search).toHaveValue("");
      fireEvent.keyDown(search, { key: "Escape" }); expect(view.props.onClose).toHaveBeenCalledOnce();
      fireEvent.change(search, { target: { value: "尚未完成的搜索" } });
      view.rerender(view.content({ open: false })); expect(trigger).toHaveFocus();
      expect(document.querySelector('[aria-modal="true"]')).toBeNull();
      view.rerender(view.content()); await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
      expect(screen.getByRole("searchbox")).toHaveValue("尚未完成的搜索");
      expect(outside).not.toHaveBeenCalled(); expect(view.props.onOpenReport).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", outside); trigger.remove(); }
  });

  it("respects the composition session when keyboard events omit the native IME flag", async () => {
    const view = mount();
    const search = screen.getByRole("searchbox");
    await waitFor(() => expect(search).toHaveFocus());
    await screen.findByRole("button", { name: "预览分析：配送费用" });
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "门店" } });
    expect(fireEvent.keyDown(search, { key: "ArrowDown" })).toBe(true);
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(search).toHaveValue("门店");
    expect(view.props.onClose).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    // Some input methods blur without a final compositionend event.
    fireEvent.compositionStart(search);
    fireEvent.blur(search);
    await screen.findByRole("button", { name: "预览分析：配送费用" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(view.props.onClose).toHaveBeenCalledOnce();
    expect(view.props.onOpenReport).not.toHaveBeenCalled();
  });

  it("blocks opening after a failed refresh and drops a removed preview without leaving focus hidden", async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "预览分析：配送费用" }));
    const open = screen.getByRole("button", { name: "打开这条分析" }); open.focus();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "刷新分析记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("历史分析未能更新");
    expect(open).toBeDisabled(); expect(screen.getByRole("heading", { name: "配送费用" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(open).not.toBeDisabled());
    open.focus(); rows = rows.filter(row => row.id !== "run-2");
    await act(() => view.client.invalidateQueries({ queryKey: ["analysis-runs"] }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "配送费用" })).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toHaveFocus(); expect(view.props.onOpenReport).not.toHaveBeenCalled();
    rows.push({ ...rows[0], id: "run-2", report: { title: "配送费用" } });
    await act(() => view.client.invalidateQueries({ queryKey: ["analysis-runs"] }));
    expect(screen.queryByRole("heading", { name: "配送费用" })).not.toBeInTheDocument();
  });

  it("validates project identity, unique targets, count bounds and summary types before rendering", () => {
    expect(inspectAnalysisHistoryPage(page(), "project-1", "run-1").items).toHaveLength(3);
    for (const broken of [
      { ...page(), items: [{ ...rows[0], project_id: "project-2" }, ...rows.slice(1)] },
      { ...page(), items: [rows[0], rows[0], rows[2]] },
      { ...page(), items: [{ ...rows[0], report: { summary: {} } }, ...rows.slice(1)] },
      { ...page(), count: 999 }, { ...page(), page_size: 500 }, { ...page(), current_run_id: "foreign" },
    ]) expect(() => inspectAnalysisHistoryPage(broken, "project-1", "run-1")).toThrow();
  });
});
