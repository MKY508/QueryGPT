import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvestigationPicker } from "@/components/reports/InvestigationPicker";
import type { AnalysisArtifact, AnalysisHistoryItem, AnalysisHistoryPage } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import messages from "@/messages/zh.json";

const { list, artifacts, draft, read, bodies } = vi.hoisted(() => ({ list: vi.fn(), artifacts: vi.fn(), draft: vi.fn(), read: vi.fn(), bodies: new Map<string, unknown>() }));
vi.mock("@/lib/reports", async (original) => ({
  ...await original<typeof import("@/lib/reports")>(),
  listReportAnalysisRuns: list, requestReportDraftPlan: draft,
  listReportArtifactIndex: async (...args: unknown[]) => {
    const items = await artifacts(...args) as AnalysisArtifact[];
    for (const item of items) bodies.set(JSON.stringify([item.analysis_run_id, item.id, item.updated_at]), item);
    return items.map(({ payload: _payload, technical_details: _details, ...summary }) => summary);
  },
  readReportArtifact: read,
}));
const run = (id = "old-run"): AnalysisHistoryItem => ({
  id, project_id: "project", conversation_id: null, query: "月度收入", state: "completed", stage: "completed",
  report: { title: id === "old-run" ? "去年收入复盘" : id, summary: "直营门店增长" },
  created_at: "2025-08-01T00:00:00Z", updated_at: "2025-08-01T00:00:00Z",
});
const page = (items = [run()], overrides: Partial<AnalysisHistoryPage> = {}): AnalysisHistoryPage => ({
  items, page: 1, page_size: 12, page_count: 1, count: items.length, total: items.length, current_run_id: null, ...overrides,
});
const item = (id: string, kind: AnalysisArtifact["kind"], payload: Record<string, unknown>): AnalysisArtifact => ({
  id, project_id: "project", analysis_run_id: "old-run", kind, title: id, payload, technical_details: {},
  created_at: "2025-08-01T00:00:00Z", updated_at: "2025-08-01T00:00:00Z",
});
function open(extra: Partial<React.ComponentProps<typeof InvestigationPicker>> = {}) {
  const onAdd = vi.fn(), onClose = vi.fn(), onGenerateDraft = vi.fn();
  const props = { projectId: "project", open: true, initialMode: "manual" as const, onAdd, onClose, onGenerateDraft, ...extra };
  render(<NextIntlClientProvider locale="zh" messages={messages}><InvestigationPicker {...props} /></NextIntlClientProvider>);
  return { onAdd, onClose, onGenerateDraft };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  list.mockReset().mockResolvedValue(page()); artifacts.mockReset().mockResolvedValue([]); draft.mockReset(); bodies.clear();
  read.mockReset().mockImplementation(async (item: AnalysisArtifact) => {
    const body = bodies.get(JSON.stringify([item.analysis_run_id, item.id, item.updated_at]));
    if (!body) throw new Error("Missing test artifact body");
    return body;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("investigation selection", () => {
  it("keeps the library mounted during direct source switching and selection review without refetching its page", async () => {
    const second = run("配送复盘");
    list.mockResolvedValue(page([run(), second]));
    artifacts.mockImplementation((_project, id) => Promise.resolve([{ ...item("收入", "metric", { value: id === second.id ? "200.50" : "100.25" }), analysis_run_id: id }]));
    const { onAdd, onGenerateDraft } = open();
    const first = await screen.findByRole("button", { name: /去年收入复盘/ });
    const search = screen.getByRole("searchbox");
    fireEvent.click(first);
    fireEvent.click(await screen.findByRole("checkbox", { name: "收入" }));
    expect(first).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /配送复盘/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "调查摘要" }));
    expect(first).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    expect(search).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "调查资料库" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "继续挑选" })[0]);
    expect(screen.getByRole("searchbox")).toBe(search);
    expect(list).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled(); expect(onGenerateDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0][0].map((block: { analysis_run_id: string }) => block.analysis_run_id)).toEqual(["old-run", second.id]);
    expect(onAdd.mock.calls[0][0][0].content.value).toBe("100.25");
  });

  it("ignores a slow previous directory and smart plan after directly selecting another investigation", async () => {
    const second = run("配送复盘");
    list.mockResolvedValue(page([run(), second]));
    let finishDirectory!: (items: AnalysisArtifact[]) => void;
    artifacts.mockImplementationOnce(() => new Promise<AnalysisArtifact[]>((resolve) => { finishDirectory = resolve; }))
      .mockResolvedValueOnce([{ ...item("配送费用", "metric", { value: "200.50" }), analysis_run_id: second.id }])
      .mockResolvedValueOnce([item("收入", "metric", { value: "100.25" })]);
    let finishPlan!: (value: unknown) => void;
    draft.mockImplementationOnce(() => new Promise((resolve) => { finishPlan = resolve; }));
    const { onAdd, onGenerateDraft } = open({ initialMode: "smart" });
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    const directorySignal = artifacts.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: /配送复盘/ }));
    expect(directorySignal.aborted).toBe(true);
    await act(async () => finishDirectory([item("过期内容", "metric", { value: 999 })]));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));
    const planSignal = draft.mock.calls[0].at(-1) as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: /去年收入复盘/ }));
    expect(planSignal.aborted).toBe(true);
    await act(async () => finishPlan({ title: "过期方案", description: "", overview_text: "", sections: [] }));
    await screen.findByRole("button", { name: "生成初稿" });
    expect(screen.queryByText("过期方案")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "手动添加" }));
    expect(screen.getByRole("checkbox", { name: "收入" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "过期内容" })).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled(); expect(onGenerateDraft).not.toHaveBeenCalled();
  });

  it("arranges chosen groups and summary positions before importing exact complete content in the reviewed order", async () => {
    const second = run("配送复盘");
    const rows = Array.from({ length: 12 }, (_, index) => ({ store: `Store ${index}`, amount: "9007199254740993.0123" }));
    const details = item("门店明细", "table", { rows });
    const amount = { ...item("配送费用", "metric", { value: "200.50" }), analysis_run_id: second.id };
    list.mockResolvedValue(page([run(), second]));
    artifacts.mockResolvedValueOnce([details]).mockResolvedValueOnce([amount]);
    const { onAdd, onGenerateDraft } = open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("button", { name: "选择全部新增" }));
    fireEvent.click(await screen.findByRole("button", { name: /配送复盘/ }));
    fireEvent.click(await screen.findByRole("button", { name: "选择全部新增" }));
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入当前页面" })).toBeEnabled());
    const review = screen.getByRole("region", { name: "已选内容" });
    const first = screen.getByRole("region", { name: "去年收入复盘" });
    fireEvent.click(within(first).getByRole("button", { name: "预览：门店明细" }));
    expect(within(await screen.findByRole("table")).getAllByRole("row")).toHaveLength(9);
    const forward = within(first).getByRole("button", { name: "将门店明细前移" });
    forward.focus(); fireEvent.click(forward);
    expect(forward).toHaveFocus();
    expect(forward).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "收起预览：门店明细" })).toHaveAttribute("aria-expanded", "true");
    const groupMove = screen.getByRole("button", { name: "将调查配送复盘整组前移" });
    groupMove.focus(); fireEvent.click(groupMove);
    expect(groupMove).toHaveFocus();
    expect(within(review).getAllByRole("heading", { name: /^(配送复盘|去年收入复盘)2$/ }).map((node) => node.textContent)).toEqual(["配送复盘2", "去年收入复盘2"]);
    fireEvent.click(groupMove); // At the boundary, moving is a no-op.
    expect(within(review).getByRole("status")).toHaveTextContent("调查配送复盘，第 1 / 2 组");
    fireEvent.click(screen.getAllByRole("button", { name: messages.investigationPicker.continueSelecting })[0]);
    fireEvent.click(screen.getByRole("button", { name: "智能整理" }));
    fireEvent.click(screen.getByRole("button", { name: "手动添加" }));
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    expect(read).toHaveBeenCalledTimes(2); // Reordering and returning do not reload bodies.
    expect(onAdd).not.toHaveBeenCalled(); expect(onGenerateDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    const blocks = onAdd.mock.calls[0][0];
    expect(blocks.map((block: { source_kind: string }) => block.source_kind)).toEqual(["analysis_run", "artifact", "artifact", "analysis_run"]);
    expect(blocks.map((block: { analysis_run_id: string }) => block.analysis_run_id)).toEqual([second.id, second.id, "old-run", "old-run"]);
    expect(blocks.map((block: { order_index: number }) => block.order_index)).toEqual([0, 1, 2, 3]);
    expect(blocks[1].content.value).toBe("200.50");
    expect(blocks[2].content.rows).toEqual(rows);
    expect(blocks[2].artifact_id).toBe(details.id);
    expect(details.payload.rows).toEqual(rows);
  });

  it("retains the visible server search/page while browsing and owns search Escape but ignores composition", async () => {
    list.mockImplementation((_project, view) => Promise.resolve(page([run()], { page: view.page, page_count: 3, count: 25, total: 25 })));
    const { onClose } = open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "去年" } });
    await screen.findByRole("button", { name: /去年收入复盘/ });
    fireEvent.click(screen.getByRole("button", { name: "下一页调查" }));
    await waitFor(() => expect(screen.getByText("25 项 · 2 / 3 页")).toBeInTheDocument());
    const readsBeforeOpening = list.mock.calls.length;
    const originalSearch = screen.getByRole("searchbox");
    fireEvent.click(screen.getByRole("button", { name: /去年收入复盘/ }));
    await screen.findByRole("checkbox", { name: "调查摘要" });
    const search = screen.getByRole("searchbox");
    expect(search).toBe(originalSearch);
    expect(list).toHaveBeenCalledTimes(readsBeforeOpening);
    expect(search).toHaveValue("去年");
    search.focus();
    expect(search).toHaveFocus();
    await screen.findByText("25 项 · 2 / 3 页");
    expect(list).toHaveBeenLastCalledWith("project", { search: "去年", page: 2, currentRunId: undefined }, expect.any(AbortSignal));
    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    expect(search).toHaveValue("去年");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submits a composed search only after composition ends", async () => {
    open();
    await screen.findByRole("button", { name: /去年收入复盘/ });
    const search = screen.getByRole("searchbox");
    const reads = list.mock.calls.length;
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "收入" } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(search).toHaveValue("收入");
    expect(list).toHaveBeenCalledTimes(reads);
    fireEvent.compositionEnd(search);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("project", { search: "收入", page: 1, currentRunId: undefined }, expect.any(AbortSignal)));
  });

  it("rejects stale search results and distinguishes an error from no matching results", async () => {
    let resolveOld!: (value: AnalysisHistoryPage) => void;
    list.mockImplementationOnce(() => new Promise<AnalysisHistoryPage>((resolve) => { resolveOld = resolve; }));
    open();
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    const oldSignal = list.mock.calls[0][2] as AbortSignal;
    list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
    expect(oldSignal.aborted).toBe(true);
    await screen.findByRole("alert");
    expect(screen.queryByText("没有匹配的调查")).not.toBeInTheDocument();
    await act(async () => resolveOld(page([run("过期结果")])));
    expect(screen.queryByText("过期结果")).not.toBeInTheDocument();
    list.mockResolvedValueOnce(page([]));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("没有匹配的调查");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("previews lazily, keeps filtered selection, skips existing items in bulk and imports complete original rows", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ 门店: `门店${index + 1}`, 收入: "9007199254740993.25" }));
    artifacts.mockResolvedValue([item("已有指标", "metric", { value: "128 万元" }), item("门店明细", "table", { rows })]);
    const { onAdd, onGenerateDraft } = open({ currentReport: {
      title: "经营月报", description: "", pages: ["概览"], has_user_edits: true,
      existing_artifact_ids: ["已有指标"],
    } });
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    await screen.findByText("已在报告中");
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择全部新增" }));
    expect(screen.getByRole("checkbox", { name: "已有指标" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "门店明细" })).toBeChecked();
    expect(screen.getByText("已选择 2 项")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "内容类型" })).getByRole("button", { name: /明细/ }));
    expect(screen.queryByRole("checkbox", { name: "调查摘要" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览：门店明细" }));
    expect(within(await screen.findByRole("table")).getAllByRole("row")).toHaveLength(9);
    expect(screen.getByText("预览 8 行 · 可加入 12 行")).toBeInTheDocument();
    expect(screen.queryByText("门店12")).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    const added = onAdd.mock.calls[0][0];
    expect(added).toHaveLength(2);
    expect(added.find((block: { artifact_id: string }) => block.artifact_id === "门店明细").content.rows).toEqual(rows);
    expect(onGenerateDraft).not.toHaveBeenCalled();
  });

  it("pins an initial run and keeps artifact failure across mode changes until retry", async () => {
    list.mockResolvedValue(page([run()], { current_run_id: "old-run" }));
    artifacts.mockRejectedValueOnce(new Error("offline"));
    const { onAdd } = open({ initialRunId: "old-run" });
    await screen.findByRole("alert");
    expect(list).toHaveBeenCalledWith("project", { search: "", page: 1, currentRunId: "old-run" }, expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: "加入当前页面" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "智能整理" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成初稿" })).not.toBeInTheDocument();
    artifacts.mockResolvedValueOnce([item("收入", "metric", { value: 100 })]);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: "生成初稿" });
    fireEvent.click(screen.getByRole("button", { name: "手动添加" }));
    expect(screen.getByRole("checkbox", { name: "收入" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "加入当前页面" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("blocks partial addition while a chosen body is pending or failed, then retries only the failed body", async () => {
    const first = item("收入", "metric", { value: "100.25" });
    const second = item("毛利", "metric", { value: "20.50" });
    artifacts.mockResolvedValue([first, second]);
    let finish!: (item: AnalysisArtifact) => void;
    const pending = new Promise<AnalysisArtifact>((resolve) => { finish = resolve; });
    read.mockImplementationOnce(() => pending).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(second);
    const { onAdd } = open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    await screen.findByRole("checkbox", { name: "收入" });
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "收入" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "毛利" }));
    expect(screen.getByRole("button", { name: "加入当前页面" })).toBeDisabled();
    await screen.findByText("内容未能打开。");
    await act(async () => { finish(first); await pending; });
    expect(screen.getByRole("button", { name: "加入当前页面" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入当前页面" })).toBeEnabled());
    expect(read).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0][0].map((block: { content: { value: string } }) => block.content.value)).toEqual(["100.25", "20.50"]);
  });

  it("waits for smart content before applying and does not apply it after the window closes", async () => {
    artifacts.mockResolvedValue([item("收入", "metric", { value: 100 })]);
    draft.mockResolvedValue({ title: "初稿", description: "", overview_text: "摘要", sections: [] });
    let finish!: (item: AnalysisArtifact) => void;
    read.mockImplementation(() => new Promise<AnalysisArtifact>((resolve) => { finish = resolve; }));
    const { onAdd, onGenerateDraft, onClose } = open({ initialMode: "smart" });
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用到报告" }));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "正在加入" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await act(async () => finish(item("收入", "metric", { value: 100 })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onGenerateDraft).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("requests only bounded completed summaries and forwards cancellation", async () => {
    const actual = await vi.importActual<typeof import("@/lib/reports")>("@/lib/reports");
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { data: page() } });
    const signal = new AbortController().signal;
    expect(await actual.listReportAnalysisRuns("project", { search: "华南", page: 3, currentRunId: "old-run" }, signal)).toEqual(page());
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/v1/projects/project/analysis-history", {
      signal, params: { purpose: "report", status: "completed", q: "华南", page: 3, page_size: 12, current_run_id: "old-run" },
    });
  });

  it("collects across server pages, preserves chosen values on revisiting and adds in reviewed source order", async () => {
    const second = run("第二份调查");
    list.mockImplementation((_project, view) => Promise.resolve(page(view.page === 1 ? [run()] : [second], {
      page: view.page, page_count: 2, count: 13, total: 13,
    })));
    const original = item("收入", "metric", { value: "9007199254740993.25" });
    const later = { ...original, payload: { value: "999" } };
    const other = { ...original, analysis_run_id: second.id, payload: { value: "200.50" } };
    artifacts.mockResolvedValueOnce([original]).mockResolvedValueOnce([other]).mockResolvedValueOnce([later]);
    const { onAdd } = open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "收入" }));
    await screen.findByRole("button", { name: /去年收入复盘.*已选 1 项/ });
    fireEvent.click(screen.getByRole("button", { name: "下一页调查" }));
    fireEvent.click(await screen.findByRole("button", { name: /第二份调查/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "收入" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "调查摘要" }));
    await screen.findByRole("button", { name: /第二份调查.*已选 2 项/ });
    fireEvent.click(screen.getByRole("button", { name: "上一页调查" }));
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    expect(await screen.findByRole("checkbox", { name: "收入" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "预览：收入" }));
    expect(screen.getByText("9007199254740993.25")).toBeInTheDocument();
    expect(screen.queryByText("999")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    expect(screen.getByText("来自 2 条调查")).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "已选内容" });
    expect(within(review).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["去年收入复盘1", "第二份调查2"]);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    const blocks = onAdd.mock.calls[0][0];
    expect(blocks.map((block: { analysis_run_id: string }) => block.analysis_run_id)).toEqual(["old-run", second.id, second.id]);
    expect(blocks.map((block: { source_kind: string }) => block.source_kind)).toEqual(["artifact", "analysis_run", "artifact"]);
    expect(blocks[0].content.value).toBe("9007199254740993.25");
    expect(blocks[2].content.value).toBe("200.50");
  });

  it("clears only the current investigation and keeps focus inside review when removing its last item", async () => {
    const second = run("第二份调查");
    list.mockResolvedValue(page([run(), second]));
    artifacts.mockImplementation((_project, id) => Promise.resolve([{ ...item("收入", "metric", { value: 100 }), analysis_run_id: id }]));
    open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("button", { name: "选择全部新增" }));
    fireEvent.click(await screen.findByRole("button", { name: /第二份调查/ }));
    fireEvent.click(await screen.findByRole("button", { name: "选择全部新增" }));
    expect(screen.getByText("已选择 4 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空本调查" }));
    expect(screen.getByText("已选择 2 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    expect(screen.getByText("来自 1 条调查")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除：收入" }));
    expect(screen.getByRole("button", { name: "移除：调查摘要" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "移除：调查摘要" }));
    expect(screen.getByRole("region", { name: "已选内容" })).toHaveFocus();
    expect(screen.getByText("还没有选择内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入当前页面" })).toBeDisabled();
  });

  it("keeps prior chosen content usable when another investigation fails to load", async () => {
    list.mockResolvedValue(page([run(), run("读取失败的调查")]));
    artifacts.mockResolvedValueOnce([item("收入", "metric", { value: 100 })]).mockRejectedValueOnce(new Error("offline"));
    const { onAdd } = open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "收入" }));
    fireEvent.click(await screen.findByRole("button", { name: /读取失败的调查/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    expect(screen.getByRole("region", { name: "去年收入复盘" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0][0]).toHaveLength(1);
    expect(onAdd.mock.calls[0][0][0].analysis_run_id).toBe("old-run");
  });

  it("preserves manual selection across modes and explicitly separates it from applying a smart plan", async () => {
    artifacts.mockResolvedValue([item("收入", "metric", { value: 100 })]);
    draft.mockResolvedValue({ title: "智能初稿", description: "概览", overview_text: "摘要", sections: [] });
    const { onAdd, onGenerateDraft, onClose } = open();
    fireEvent.click(await screen.findByRole("button", { name: /去年收入复盘/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "收入" }));
    fireEvent.click(screen.getByRole("button", { name: "智能整理" }));
    fireEvent.click(screen.getByRole("button", { name: "手动添加" }));
    expect(screen.getByRole("checkbox", { name: "收入" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "智能整理" }));
    fireEvent.click(screen.getByRole("button", { name: "生成初稿" }));
    await screen.findByText("将按此方案添加，不另外加入手动已选的 1 项。");
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "仅应用整理方案" }));
    await waitFor(() => expect(onGenerateDraft).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
