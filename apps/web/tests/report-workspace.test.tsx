import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import * as nextNavigation from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportWorkspace, reconcileReportAfterSave } from "@/components/reports/ReportWorkspace";
import * as reportImages from "@/lib/report-image";
import * as reportRecovery from "@/lib/report-recovery";
import * as reportApi from "@/lib/reports";
import * as reportVersions from "@/lib/report-versions";
import { ReportPrintView } from "@/components/reports/ReportPrintView";
import { ReportRecoveryPanel } from "@/components/reports/ReportRecoveryPanel";
import { ReportPropertyPanel } from "@/components/reports/ReportPropertyPanel";
import {
  balanceMetricWidths,
  createInvestigationReportDraft,
  createInvestigationReportDraftFromPlan,
} from "@/components/reports/report-draft";
import {
  applyReportBlockUpdates,
  applyStaticReportFilters,
  artifactToReportBlock as convertArtifactToReportBlock,
  createReportBlocksCopy,
} from "@/lib/report-blocks";
import {
  ReportDraftUnavailableError,
  ReportConflictError,
  ReportSaveUnconfirmedError,
  ReportRefreshError,
  type ReportDocument,
  type ReportDraftPlan,
} from "@/lib/reports";
import { api } from "@/lib/api/client";
import { useChatStore } from "@/lib/stores/chat";
import { subscribeToDesktopClose, type DesktopCloseCommand, type DesktopCloseState } from "@/lib/desktop-app-info";
import messages from "@/messages/zh.json";
import enMessages from "@/messages/en.json";
import { configureCrossFilter } from "@/lib/report-interactions";
import { configureReportFilter } from "@/lib/report-filter-connections";
import * as csv from "@/lib/csv";
import type { AnalysisArtifact, AnalysisRunSummary } from "@/lib/types/api";

const reportBlocksCopy = createReportBlocksCopy((key, values) => {
  const template = messages.reportBlocks[key as keyof typeof messages.reportBlocks];
  return Object.entries(values ?? {}).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template
  );
});

const reportBlocksCopyEn = createReportBlocksCopy((key, values) => {
  const template = enMessages.reportBlocks[key as keyof typeof enMessages.reportBlocks];
  return Object.entries(values ?? {}).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template
  );
});

const reportDraftCopy = {
  ...messages.reportDraft,
  blocks: reportBlocksCopy,
  locale: "zh",
};

function artifactToReportBlock(artifact: AnalysisArtifact) {
  return convertArtifactToReportBlock(artifact, reportBlocksCopy, "zh");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function historyPage(items: unknown[]) {
  return { items, total: items.length, count: items.length, page: 1, page_size: 12,
    page_count: 1, current_run_id: null };
}

function reportAction(name: string) {
  const trigger = screen.getByRole("button", { name: messages.reportWorkspace.moreActions });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  return screen.getByRole("menuitem", { name });
}

function mockRecoveryDialog() {
  const prototype = HTMLDialogElement.prototype;
  const show = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) {
      this.open = false;
      queueMicrotask(() => this.dispatchEvent(new Event("close")));
    } },
  });
  return () => {
    if (show) Object.defineProperty(prototype, "showModal", show); else Reflect.deleteProperty(prototype, "showModal");
    if (close) Object.defineProperty(prototype, "close", close); else Reflect.deleteProperty(prototype, "close");
  };
}

function mockViewportWidth(width: number) {
  vi.mocked(window.matchMedia).mockImplementation((query) => {
    const minimum = query.match(/min-width:\s*(\d+)px/);
    const maximum = query.match(/max-width:\s*(\d+)px/);
    const matches =
      (!minimum || width >= Number(minimum[1])) &&
      (!maximum || width <= Number(maximum[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

const {
  getReport,
  refreshReportBlock,
  refreshReportPage,
  inspectReportRefreshSources,
  updateReport,
  exportReportExcel,
  listReportAnalysisRuns,
  listRunArtifacts,
  requestReportDraftPlan,
} = vi.hoisted(() => ({
  getReport: vi.fn(),
  refreshReportBlock: vi.fn(),
  refreshReportPage: vi.fn(),
  inspectReportRefreshSources: vi.fn(),
  updateReport: vi.fn(),
  exportReportExcel: vi.fn(),
  listReportAnalysisRuns: vi.fn(),
  listRunArtifacts: vi.fn(),
  requestReportDraftPlan: vi.fn(),
}));

vi.mock("@/lib/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports")>();
  const bodies = new Map<string, AnalysisArtifact>();
  return {
    ...actual,
    getReport,
    refreshReportBlock,
    refreshReportPage,
    inspectReportRefreshSources,
    updateReport,
    exportReportExcel,
    listReportAnalysisRuns,
    listRunArtifacts,
    listReportArtifactIndex: async (...args: Parameters<typeof actual.listReportArtifactIndex>) => {
      const items = await listRunArtifacts(...args) as AnalysisArtifact[];
      for (const item of items) bodies.set(JSON.stringify([item.project_id, item.analysis_run_id, item.id, item.updated_at]), item);
      return items.map(({ payload: _payload, technical_details: _details, ...summary }) => summary);
    },
    readReportArtifact: async (item: AnalysisArtifact) => {
      const body = bodies.get(JSON.stringify([item.project_id, item.analysis_run_id, item.id, item.updated_at]));
      if (!body) throw new Error("Missing test artifact body");
      return body;
    },
    requestReportDraftPlan,
  };
});

const report: ReportDocument = {
  id: "report-1",
  project_id: "project-1",
  title: "经营概览",
  description: "本月经营重点",
  status: "draft",
  version: 1,
  created_at: "2026-07-19T01:00:00Z",
  updated_at: "2026-07-19T02:00:00Z",
  pages: [
    {
      id: "page-1",
      title: "概览",
      order_index: 0,
      config: {},
      version: 1,
      blocks: [
        {
          id: "block-1",
          block_type: "text",
          title: "本月结论",
          order_index: 0,
          source_kind: "manual",
          analysis_run_id: null,
          artifact_id: null,
          content: { text: "收入稳步增长" },
          config: {},
          layout: { x: 0, y: 0, w: 6, h: 3 },
          version: 1,
        },
      ],
    },
  ],
};

function reportWithBlock(
  block: ReportDocument["pages"][number]["blocks"][number]
): ReportDocument {
  return {
    ...structuredClone(report),
    pages: [
      {
        ...structuredClone(report.pages[0]),
        blocks: [block],
      },
    ],
  };
}

function crossFilterReport(configured = true): ReportDocument {
  const document = structuredClone(report);
  const base = document.pages[0].blocks[0];
  document.pages[0].blocks = [
    { ...base, id: "region-chart", block_type: "chart", title: "区域收入",
      content: { rows: [{ region: "华东", amount: 10 }, { region: "华西", amount: 20 }] },
      config: { chart_type: "bar", x_key: "region", y_key: "amount" } },
    { ...base, id: "order-table", block_type: "table", title: "订单明细",
      content: { rows: [{ territory: "华东", order: "东区订单" }, { territory: "华西", order: "西区订单" }] } },
    { ...base, id: "other-table", block_type: "table", title: "其他明细",
      content: { rows: [{ region: "华西", order: "无关联订单" }] } },
  ];
  if (configured) document.pages[0] = configureCrossFilter(document.pages[0], "region-chart", "region", "order-table", "territory");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600, height: 280, top: 0, left: 0, bottom: 280, right: 600, x: 0, y: 0, toJSON: () => ({}),
  });
  return document;
}

function connectedFilterReport(configured = true): ReportDocument {
  let document = crossFilterReport(false);
  const first = document.pages[0];
  const filter = { ...first.blocks[0], id: "report-filter", block_type: "filter" as const, title: "跨页地区筛选",
    content: {}, config: { field: "region", operator: "equals" }, layout: { x: 0, y: 0, w: 6, h: 2 } };
  document.pages = [
    { ...first, blocks: [filter, first.blocks[0]] },
    { ...first, id: "page-2", title: "经营明细", order_index: 1, blocks: first.blocks.slice(1) },
    { ...first, id: "page-3", title: "说明", order_index: 2, blocks: [] },
  ];
  if (configured) {
    document = configureReportFilter(document, filter.id, { scope: "report" });
    document = configureReportFilter(document, filter.id, { targetId: "region-chart", field: "region" });
    document = configureReportFilter(document, filter.id, { targetId: "order-table", field: "territory" });
  }
  return document;
}

describe("ReportWorkspace", () => {
  it("opens saved version history from the toolbar and reloads after explicit restoration", async () => {
    getReport.mockResolvedValue({ ...structuredClone(report), version: 2 });
    vi.spyOn(reportVersions, "listReportVersions").mockResolvedValue({ report_id: "report-1", current_version: 2,
      items: [{ version: 1, title: "早期报告", saved_at: "2026-09-06T00:00:00Z", reason: "saved", page_count: 1, block_count: 1 }], next_before: null });
    vi.spyOn(reportVersions, "getReportVersion").mockResolvedValue({ ...structuredClone(report), title: "早期报告", version: 1 });
    const restored = { ...structuredClone(report), title: "早期报告", version: 3 };
    const restore = vi.spyOn(reportVersions, "restoreReportVersion").mockImplementation(async () => { getReport.mockResolvedValue(restored); return restored; });
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByRole("button", { name: messages.reportWorkspace.moreActions });
    fireEvent.click(reportAction(messages.reportWorkspace.versionHistory));
    fireEvent.click(await screen.findByRole("button", { name: /第 1 版/ }));
    await screen.findByText("早期报告");
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.reportVersions.restore }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: messages.reportVersions.title })).not.toBeInTheDocument());
    expect(restore).toHaveBeenCalledWith("project-1", "report-1", 1, 2, expect.any(Object));
    expect(screen.getByRole("heading", { name: "早期报告" })).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledTimes(2);
  });
  let restoreRefreshDialog: () => void;
  beforeEach(() => {
    restoreRefreshDialog = mockRecoveryDialog();
    inspectReportRefreshSources.mockReset();
    inspectReportRefreshSources.mockImplementation(async (projectId, reportId, pageId, expectedVersion, blockId) => ({
      project_id: projectId, report_id: reportId, page_id: pageId, block_id: blockId ?? null,
      expected_version: expectedVersion, source_plan: "a".repeat(64), blocks: [{
        block_id: blockId ?? "page-refresh-table", title: "区域明细", previous_source: null, refreshed_at: null,
        next_source: { source_id: "source-current", name: "九月订单.csv", kind: "file", data_version: 2 },
      }],
    }));
    getReport.mockReset();
    refreshReportBlock.mockReset();
    refreshReportPage.mockReset();
    updateReport.mockReset();
    exportReportExcel.mockReset();
    listReportAnalysisRuns.mockReset();
    listRunArtifacts.mockReset();
    requestReportDraftPlan.mockReset();
    mockViewportWidth(1024);
    getReport.mockResolvedValue(structuredClone(report));
    exportReportExcel.mockResolvedValue(
      new Blob(["report"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    useChatStore.setState({
      currentConversationId: null,
      currentConversationMeta: null,
      lastProjectId: null,
    });
    updateReport.mockImplementation(async (_projectId, _reportId, input) => ({
      ...structuredClone(report),
      ...input,
      version: 2,
      updated_at: "2026-07-19T03:00:00Z",
    }));
  });

  afterEach(() => {
    cleanup();
    restoreRefreshDialog();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("focused writing uses report history and recovery and retains edits made during a save", async () => {
    const checkpoint = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint");
    const prepared = structuredClone(report);
    prepared.pages[0].blocks[0] = { ...prepared.pages[0].blocks[0], source_kind: "artifact", artifact_id: "artifact-1", analysis_run_id: "run-1",
      source_ref: { retained: true }, content: { value: "旧版正文", items: [{ label: "保留依据" }], keep: "metadata" } };
    getReport.mockResolvedValue(prepared);
    const pending = deferred<ReportDocument>();
    updateReport.mockImplementationOnce(() => pending.promise);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: messages.reportWorkspace.editReport }));
    fireEvent.click(screen.getByRole("button", { name: "专注编辑：本月结论" }));
    const dialog = screen.getByRole("dialog", { name: "专注写作" });
    const body = within(dialog).getByRole("textbox", { name: "正文" });
    expect(body).toHaveValue("旧版正文");
    fireEvent.change(body, { target: { value: "  第一版\n结论  " } });
    fireEvent.keyDown(body, { key: "z", metaKey: true });
    expect(body).toHaveValue("旧版正文");
    fireEvent.keyDown(body, { key: "z", metaKey: true, shiftKey: true });
    expect(body).toHaveValue("  第一版\n结论  ");
    fireEvent.keyDown(body, { key: "s", metaKey: true });
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    const sent = updateReport.mock.calls[0][2];
    expect(sent.pages[0].blocks[0]).toMatchObject({ artifact_id: "artifact-1", analysis_run_id: "run-1", source_ref: { retained: true },
      config: { manual_override: true }, content: { value: "旧版正文", text: "  第一版\n结论  ", items: [{ label: "保留依据" }], keep: "metadata" } });
    fireEvent.change(body, { target: { value: "保存期间的最新正文" } });
    expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ pages: expect.arrayContaining([expect.objectContaining({ blocks: expect.arrayContaining([expect.objectContaining({ content: expect.objectContaining({ text: "保存期间的最新正文" }) })]) })]) }));
    await act(async () => pending.resolve({ ...prepared, ...sent, version: 2 }));
    expect(body).toHaveValue("保存期间的最新正文");
    fireEvent.keyDown(body, { key: "s", metaKey: true });
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2].pages[0].blocks[0].content.text).toBe("保存期间的最新正文");
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent(messages.reportWorkspace.saved));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "返回报告" })[0]);
    expect(screen.queryByRole("dialog", { name: "专注写作" })).not.toBeInTheDocument();
    expect(screen.getByText("保存期间的最新正文", { selector: "p" })).toBeInTheDocument();
  });

  it.each([false, true])("focused writing follows newly saved identities with concurrent typing %s and resets on navigation", async (continued) => {
    const local = structuredClone(report); local.pages[0].id = "local-page-writing"; local.pages[0].blocks[0].id = "local-block-writing";
    getReport.mockResolvedValue(local);
    const pending = deferred<ReportDocument>();
    let acknowledgement!: ReportDocument;
    updateReport.mockImplementationOnce(async (_project, _report, input) => {
      acknowledgement = { ...local, ...input, version: 2,
        pages: input.pages.map((page: reportApi.ReportPage) => ({ ...page, id: "saved-page-writing", blocks: page.blocks.map(block => ({ ...block, id: "saved-block-writing" })) })) };
      return pending.promise;
    });
    const view = (id = "report-1") => <NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId={id} /></NextIntlClientProvider>;
    const { rerender } = render(view());
    fireEvent.click(await screen.findByRole("button", { name: messages.reportWorkspace.editReport }));
    fireEvent.click(screen.getByRole("button", { name: "专注编辑：本月结论" }));
    const dialog = screen.getByRole("dialog", { name: "专注写作" });
    const body = within(dialog).getByRole("textbox", { name: "正文" });
    fireEvent.change(body, { target: { value: "首次保存正文" } });
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportWorkspace.save }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    if (continued) fireEvent.change(body, { target: { value: "首次保存期间继续写" } });
    await act(async () => pending.resolve(acknowledgement));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent(messages.reportWorkspace[continued ? "unsavedChanges" : "saved"]));
    expect(screen.getByRole("dialog", { name: "专注写作" })).toBe(dialog);
    expect(body).toHaveValue(continued ? "首次保存期间继续写" : "首次保存正文");
    fireEvent.change(body, { target: { value: "继续编写" } });
    fireEvent.keyDown(body, { key: "s", ctrlKey: true });
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2].pages[0]).toMatchObject({ id: "saved-page-writing", blocks: [expect.objectContaining({ id: "saved-block-writing", content: { text: "继续编写" } })] });
    getReport.mockResolvedValue({ ...structuredClone(report), id: "report-2" });
    rerender(view("report-2"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "专注写作" })).not.toBeInTheDocument());
  });

  it("focused writing exposes save failures and retries the same attempt without dropping newer text", async () => {
    let notifyStorage!: (failed: boolean) => void;
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "subscribe").mockImplementation(listener => { notifyStorage = listener; return () => {}; });
    updateReport.mockRejectedValueOnce(new Error("offline"));
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: messages.reportWorkspace.editReport }));
    const open = () => fireEvent.click(screen.getByRole("button", { name: "专注编辑：本月结论" }));
    open();
    let dialog = screen.getByRole("dialog", { name: "专注写作" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "正文" }), { target: { value: "等待保存的正文" } });
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportWorkspace.save }));
    expect(await within(dialog).findByRole("alert")).not.toBeEmptyDOMElement();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "正文" }), { target: { value: "离线时继续写的正文" } });
    act(() => notifyStorage(true));
    expect(within(dialog).getByText(messages.reportRecovery.storageFailed)).toBeVisible();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "返回报告" })[0]); open();
    dialog = screen.getByRole("dialog", { name: "专注写作" });
    const body = within(dialog).getByRole("textbox", { name: "正文" });
    expect(body).toHaveValue("离线时继续写的正文");
    expect(within(dialog).getByText(messages.reportRecovery.storageFailed)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportWorkspace.save }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent(messages.reportWorkspace.unsavedChanges));
    expect(updateReport.mock.calls[1][2]).toMatchObject({ save_request_id: updateReport.mock.calls[0][2].save_request_id, retry_save: true });
    expect(updateReport.mock.calls[1][2].pages[0].blocks[0].content.text).toBe("等待保存的正文");
    expect(body).toHaveValue("离线时继续写的正文");
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportWorkspace.save }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent(messages.reportWorkspace.saved));
    expect(updateReport.mock.calls[2][2].save_request_id).not.toBe(updateReport.mock.calls[0][2].save_request_id);
    expect(updateReport.mock.calls[2][2].pages[0].blocks[0].content.text).toBe("离线时继续写的正文");
  });

  it("connected report filters follow page navigation and clear from a destination without saving", async () => {
    getReport.mockResolvedValue(connectedFilterReport());
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "跨页地区筛选" }), { target: { value: "华东" } });
    expect(screen.getAllByRole("textbox", { name: "跨页地区筛选" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "下一页：经营明细" }));
    expect(screen.getByRole("textbox", { name: "跨页地区筛选" })).toHaveValue("华东");
    expect(screen.getByRole("cell", { name: "东区订单" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "西区订单" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "无关联订单" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页：说明" }));
    expect(screen.queryByRole("textbox", { name: "跨页地区筛选" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一页：经营明细" }));
    fireEvent.click(screen.getByRole("button", { name: "清除跨页地区筛选" }));
    expect(screen.getByRole("cell", { name: "西区订单" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "选择报告页面" }), { target: { value: "page-1" } });
    expect(screen.getByRole("textbox", { name: "跨页地区筛选" })).toHaveValue("");
    expect(updateReport).not.toHaveBeenCalled();
    expect(refreshReportBlock).not.toHaveBeenCalled();
    expect(refreshReportPage).not.toHaveBeenCalled();
  });

  it("connected report filters save only the explicitly chosen chart fields through the editor", async () => {
    getReport.mockResolvedValue(connectedFilterReport(false));
    const { container } = render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByRole("textbox", { name: "跨页地区筛选" });
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(container.querySelector('[data-report-block="report-filter"]')!);
    fireEvent.change(screen.getByRole("combobox", { name: "影响范围" }), { target: { value: "report" } });
    expect(screen.getByRole("textbox", { name: "跨页地区筛选" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "概览 · 区域收入的对应字段" }), { target: { value: "region" } });
    fireEvent.change(screen.getByRole("combobox", { name: "经营明细 · 订单明细的对应字段" }), { target: { value: "territory" } });
    expect(screen.getByRole("combobox", { name: "经营明细 · 其他明细的对应字段" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    const pages = updateReport.mock.calls[0][2].pages;
    expect(pages[0].blocks[0].config.filter_targets).toEqual([
      { key: pages[0].blocks[1].config.filter_target_key, field: "region" },
      { key: pages[1].blocks[0].config.filter_target_key, field: "territory" },
    ]);
    expect(pages[1].blocks[0].config.manual_override).toBeUndefined();
    expect(pages[1].blocks[1].config.filter_target_key).toBeUndefined();
  });

  it("connected report filters freeze destination rows and captions in print and image views", async () => {
    const original = connectedFilterReport();
    getReport.mockResolvedValue(original);
    const ready = deferred<void>();
    const assets = vi.spyOn(reportImages, "waitForReportAssets").mockReturnValueOnce(ready.promise);
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      const snapshot = document.querySelector(".report-print-view")!;
      const second = snapshot.querySelectorAll(".report-print-page")[1];
      expect(second).toHaveTextContent("跨页地区筛选");
      expect(second).toHaveTextContent("华东");
      expect(second).toHaveTextContent("东区订单");
      expect(second).not.toHaveTextContent("西区订单");
      expect(second).toHaveTextContent("无关联订单");
      expect(snapshot.querySelector("input,select,button")).toBeNull();
    });
    const view = render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "跨页地区筛选" }), { target: { value: "华东" } });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(assets).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "清除跨页地区筛选" }));
    await act(async () => ready.resolve());
    expect(print).toHaveBeenCalledOnce();
    expect(updateReport).not.toHaveBeenCalled();
    view.unmount();
    const image = render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportPrintView report={original} filterValues={{ "report-filter": "华西" }} imagePageId="page-2" />
    </NextIntlClientProvider>);
    expect(image.container.querySelectorAll(".report-print-page")).toHaveLength(1);
    expect(image.container).toHaveTextContent("跨页地区筛选");
    expect(image.container).toHaveTextContent("西区订单");
    expect(image.container).not.toHaveTextContent("东区订单");
  });

  it("cross-filters named targets in reading mode without saving, and clears via controls or Escape", async () => {
    const document = crossFilterReport();
    const original = structuredClone(document);
    getReport.mockResolvedValue(document);
    const { container } = render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    const select = await screen.findByRole("combobox", { name: "按region筛选联动区块" });
    const table = within(container.querySelector('[data-report-block="order-table"]') as HTMLElement);
    fireEvent.change(select, { target: { value: JSON.stringify("华东") } });
    expect(table.getByRole("cell", { name: "东区订单" })).toBeInTheDocument();
    expect(table.queryByRole("cell", { name: "西区订单" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "无关联订单" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "华西" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    expect(screen.getByRole("menuitem", { name: "导出完整报告（Excel）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    fireEvent.keyDown(select, { key: "Escape" });
    expect(select).toHaveValue(JSON.stringify("华东"));
    fireEvent.keyDown(container.querySelector(".report-layout-grid")!, { key: "Escape" });
    expect(table.getByRole("cell", { name: "西区订单" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: JSON.stringify("华东") } });
    fireEvent.click(screen.getByRole("button", { name: "清除region：华东" }));
    expect(select).toHaveValue("");
    fireEvent.change(select, { target: { value: JSON.stringify("华西") } });
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "阅读报告" }));
    expect(screen.getByRole("combobox", { name: "按region筛选联动区块" })).toHaveValue("");
    expect(table.getByRole("cell", { name: "东区订单" })).toBeInTheDocument();
    expect(document).toEqual(original);
    expect(updateReport).not.toHaveBeenCalled();
    expect(refreshReportBlock).not.toHaveBeenCalled();
  });

  it("opens a cross-filtered data view and exports only those rows without saving the report", async () => {
    const restore = mockRecoveryDialog();
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    getReport.mockResolvedValue(crossFilterReport());
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      fireEvent.change(await screen.findByRole("combobox", { name: "按region筛选联动区块" }), { target: { value: JSON.stringify("华东") } });
      fireEvent.click(screen.getByRole("button", { name: "查看订单明细的数据" }));
      const dialog = screen.getByRole("dialog", { name: "订单明细 · 数据" });
      expect(within(dialog).getByRole("cell", { name: "东区订单" })).toBeInTheDocument();
      expect(within(dialog).queryByRole("cell", { name: "西区订单" })).not.toBeInTheDocument();
      expect(within(dialog).getByText("筛选后 1 行（基于报告保留的 2 行）")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "导出当前结果 CSV" }));
      expect(download).toHaveBeenCalledWith([{ territory: "华东", order: "东区订单" }], "订单明细.csv", ["territory", "order"]);
      fireEvent.click(within(dialog).getByRole("button", { name: "关闭数据窗口" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("combobox", { name: "按region筛选联动区块" })).toHaveValue(JSON.stringify("华东"));
      expect(updateReport).not.toHaveBeenCalled();
      expect(refreshReportBlock).not.toHaveBeenCalled();
    } finally { cleanup(); restore(); }
  });

  it("cross-filter settings save the chosen source and target fields through the normal editor", async () => {
    getReport.mockResolvedValue(crossFilterReport(false));
    const { container } = render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("东区订单");
    expect(screen.queryByRole("combobox", { name: "按region筛选联动区块" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(container.querySelector('[data-report-block="region-chart"]')!);
    fireEvent.click(screen.getByRole("button", { name: "图表联动" }));
    fireEvent.change(screen.getByRole("combobox", { name: "筛选字段" }), { target: { value: "region" } });
    fireEvent.change(screen.getByRole("combobox", { name: "订单明细的对应字段" }), { target: { value: "territory" } });
    expect(screen.getByRole("combobox", { name: "其他明细的对应字段" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    const blocks = updateReport.mock.calls[0][2].pages[0].blocks;
    expect(blocks[0].config.filter_action).toEqual({ field: "region", targets: [{ key: blocks[1].config.interaction_key, field: "territory" }] });
    expect(blocks[0].config.interaction_key).toBeTruthy();
    expect(blocks[2].config.interaction_key).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "阅读报告" }));
    fireEvent.change(screen.getByRole("combobox", { name: "按region筛选联动区块" }), { target: { value: JSON.stringify("华西") } });
    expect(screen.queryByRole("cell", { name: "东区订单" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "西区订单" })).toBeInTheDocument();
  });

  it("cross-filter printing freezes the selected rows and caption while reading selection changes", async () => {
    getReport.mockResolvedValue(crossFilterReport());
    const ready = deferred<void>();
    const assets = vi.spyOn(reportImages, "waitForReportAssets").mockReturnValueOnce(ready.promise);
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      const snapshot = document.querySelector(".report-print-view")!;
      expect(snapshot).toHaveTextContent("图表筛选：区域收入 · region：华东");
      expect(snapshot).toHaveTextContent("东区订单");
      expect(snapshot).not.toHaveTextContent("西区订单");
      expect(snapshot).toHaveTextContent("无关联订单");
      expect(snapshot.querySelector("select")).toBeNull();
    });
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.change(await screen.findByRole("combobox", { name: "按region筛选联动区块" }), { target: { value: JSON.stringify("华东") } });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(assets).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("cell", { name: "西区订单" })).toBeInTheDocument();
    await act(async () => ready.resolve());
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".report-print-view")).toBeNull();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it.each([2, 4])("checks a restarted save without writing and restores later edits against report version %i", async (latestVersion) => {
    const restoreDialog = mockRecoveryDialog();
    const sent = structuredClone(report);
    sent.title = "已提交的标题";
    sent.pages[0].blocks.push({ ...structuredClone(sent.pages[0].blocks[0]), id: "local-block-new" });
    const saved = structuredClone(sent);
    saved.version = 2;
    saved.pages[0].blocks[1].id = "canonical-new-block";
    const latest = { ...structuredClone(saved), version: latestVersion, description: latestVersion > 2 ? "之后更新的说明" : saved.description };
    getReport.mockResolvedValue(latest);
    let draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "pending-1", projectId: report.project_id, reportId: report.id,
      baseVersion: 1, updatedAt: Date.now(), document: { ...structuredClone(sent), title: "关闭前的后续修改" },
      pendingSave: { schema: 1, requestId: crypto.randomUUID(), snapshot: sent,
        copy: { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" } },
    };
    let items = [reportRecovery.reportRecoverySummary(draft)];
    vi.spyOn(reportRecovery, "listReportRecoveryDrafts").mockImplementation(async () => ({ items, total: items.length, next: null }));
    vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockImplementation(async () => draft);
    const resolve = vi.spyOn(reportApi, "resolveReportSave").mockResolvedValue(saved);
    const acknowledge = vi.spyOn(reportRecovery, "acknowledgeReportRecoverySave").mockImplementation(async () => {
      draft = { ...draft, revision: "confirmed-2", baseVersion: 2, baseline: saved, pendingSave: undefined,
        document: { ...structuredClone(saved), title: draft.document.title } };
      items = [reportRecovery.reportRecoverySummary(draft)];
      return true;
    });
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "adopt").mockImplementation(async () => { items = []; return true; });
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "flush").mockResolvedValue(true);
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "查看草稿" }));
      fireEvent.click(await screen.findByRole("button", { name: "核对保存结果" }));
      await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
      expect(resolve.mock.calls[0][2]).toMatchObject({ title: sent.title, expected_version: 1 });
      expect(updateReport).not.toHaveBeenCalled();
      const restore = await screen.findByRole("button", { name: "恢复草稿" });
      expect(restore).toBeEnabled();
      fireEvent.click(restore);
      await waitFor(() => expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("关闭前的后续修改"));
      if (latestVersion > 2) {
        expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "比较并合并" }));
        const comparison = await screen.findByRole("dialog", { name: "合并报告修改" });
        await within(comparison).findByText(messages.reportConflict.noConflicts);
        fireEvent.click(within(comparison).getByRole("button", { name: "应用并继续编辑" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "合并报告修改" })).not.toBeInTheDocument());
      }
      expect(updateReport).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
      expect(updateReport.mock.calls[0][2]).toMatchObject({ title: "关闭前的后续修改", expected_version: latestVersion, description: latest.description });
      expect(updateReport.mock.calls[0][2].pages[0].blocks.map((block: { id: string }) => block.id)).toEqual(["block-1", "canonical-new-block"]);
    } finally { cleanup(); restoreDialog(); }
  });

  it("keeps a restarted save draft untouched when its receipt is absent or the check fails", async () => {
    const restoreDialog = mockRecoveryDialog();
    const draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "pending-1", projectId: report.project_id, reportId: report.id,
      baseVersion: 1, updatedAt: Date.now(), document: structuredClone(report),
      pendingSave: { schema: 1, requestId: crypto.randomUUID(), snapshot: structuredClone(report),
        copy: { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" } },
    };
    vi.spyOn(reportRecovery, "listReportRecoveryDrafts").mockResolvedValue({ items: [reportRecovery.reportRecoverySummary(draft)], total: 1, next: null });
    vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockResolvedValue(draft);
    const resolve = vi.spyOn(reportApi, "resolveReportSave").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Offline"));
    const acknowledge = vi.spyOn(reportRecovery, "acknowledgeReportRecoverySave");
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "查看草稿" }));
      fireEvent.click(await screen.findByRole("button", { name: "核对保存结果" }));
      await screen.findByText(messages.reportRecovery.saveStillUnconfirmed);
      expect(screen.queryByRole("button", { name: "恢复草稿" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "核对保存结果" }));
      await screen.findByText(messages.reportRecovery.saveCheckFailed);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(acknowledge).not.toHaveBeenCalled();
      expect(updateReport).not.toHaveBeenCalled();
    } finally { cleanup(); restoreDialog(); }
  });

  it("waits for pending-save preservation before sending while allowing a save if browser storage fails", async () => {
    const write = deferred<boolean>();
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "beginSave").mockReturnValue(write.promise);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "等待存储的提交" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(updateReport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "等待期间继续编辑" } });
    await act(async () => write.resolve(false));
    expect(updateReport).toHaveBeenCalledTimes(1);
    expect(updateReport.mock.calls[0][2].title).toBe("等待存储的提交");
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("等待期间继续编辑");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("restores a recovery draft only after confirmation and saves through the usual report API", async () => {
    const restoreDialog = mockRecoveryDialog();
    const draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "draft-1", projectId: report.project_id, reportId: report.id,
      baseVersion: report.version, updatedAt: Date.now(), document: { ...structuredClone(report), title: "找回的标题" },
    };
    let items = [reportRecovery.reportRecoverySummary(draft)];
    vi.spyOn(reportRecovery, "listReportRecoveryDrafts").mockImplementation(async () => ({ items, total: items.length, next: null }));
    vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockResolvedValue(draft);
    const adopt = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "adopt").mockImplementation(async () => { items = []; return true; });
    try {
      render(<StrictMode><NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider></StrictMode>);
      await screen.findByRole("button", { name: "查看草稿" });
      expect(updateReport).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "查看草稿" }));
      expect(await screen.findByRole("dialog", { name: "未保存的草稿" })).toBeInTheDocument();
      expect(await screen.findByText("找回的标题")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
      await waitFor(() => expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("找回的标题"));
      expect(adopt).toHaveBeenCalledOnce();
      expect(updateReport).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
      expect(updateReport.mock.calls[0][2]).toMatchObject({ title: "找回的标题", expected_version: 1 });
    } finally { cleanup(); restoreDialog(); }
  });

  it("keeps a conflicting recovery draft reviewable without allowing it to overwrite a newer report", async () => {
    const restoreDialog = mockRecoveryDialog();
    const draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "draft-1", projectId: report.project_id, reportId: report.id,
      baseVersion: report.version, updatedAt: Date.now(), document: { ...structuredClone(report), title: "旧草稿" },
    };
    getReport.mockResolvedValue({ ...structuredClone(report), version: 2 });
    vi.spyOn(reportRecovery, "listReportRecoveryDrafts").mockResolvedValue({ items: [reportRecovery.reportRecoverySummary(draft)], total: 1, next: null });
    vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockResolvedValue(draft);
    const remove = vi.spyOn(reportRecovery, "removeReportRecoveryDraft").mockResolvedValue(true);
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "查看草稿" }));
      expect(await screen.findByText("旧草稿")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      expect(screen.getByText(/这份报告在草稿之后已有更新/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "删除草稿" }));
      expect(remove).not.toHaveBeenCalled();
      expect(screen.getByText(/删除这份未保存的草稿/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "保留草稿" }));
      expect(remove).not.toHaveBeenCalled();
      expect(updateReport).not.toHaveBeenCalled();
    } finally { cleanup(); restoreDialog(); }
  });

  it("keeps recovery review available while the saved report is pending and after it fails", async () => {
    const restoreDialog = mockRecoveryDialog();
    const pending = deferred<ReportDocument>();
    getReport.mockImplementation(() => pending.promise.then(() => { throw new Error("Report unavailable"); }));
    const draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "draft-1", projectId: report.project_id, reportId: report.id,
      baseVersion: report.version, updatedAt: Date.now(), document: { ...structuredClone(report), title: "待找回内容" },
    };
    vi.spyOn(reportRecovery, "listReportRecoveryDrafts").mockResolvedValue({ items: [reportRecovery.reportRecoverySummary(draft)], total: 1, next: null });
    const loadBody = vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockResolvedValue(draft);
    const adopt = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "adopt");
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      const review = await screen.findByRole("button", { name: "查看草稿" });
      expect(loadBody).not.toHaveBeenCalled();
      fireEvent.click(review);
      const dialog = await screen.findByRole("dialog", { name: "未保存的草稿" });
      expect(await screen.findByRole("heading", { name: "待找回内容", level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      await act(async () => pending.resolve(structuredClone(report)));
      expect(screen.getByRole("dialog", { name: "未保存的草稿" })).toBe(dialog);
      expect(screen.getByRole("heading", { name: "待找回内容", level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      expect(loadBody).toHaveBeenCalledOnce();
      expect(updateReport).not.toHaveBeenCalled();
      expect(adopt).not.toHaveBeenCalled();
    } finally { cleanup(); restoreDialog(); }
  });

  it("loads only the selected recovery body and ignores a late response from the previous selection", async () => {
    const restoreDialog = mockRecoveryDialog();
    const first: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "first", revision: "1", projectId: report.project_id, reportId: report.id,
      baseVersion: report.version, updatedAt: 1, document: { ...structuredClone(report), title: "第一份草稿正文" },
    };
    const second = { ...first, id: "second", document: { ...first.document, title: "第二份草稿正文" } };
    const firstRead = deferred<reportRecovery.ReportRecoveryDraft>();
    const secondRead = deferred<reportRecovery.ReportRecoveryDraft>();
    const load = vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockImplementation((summary) => summary.id === "first" ? firstRead.promise : secondRead.promise);
    const restore = vi.fn();
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportRecoveryPanel
        drafts={[first, second].map(reportRecovery.reportRecoverySummary)} report={report}
        dirty={false} busy={false} error={false} total={2} hasMore={false} loadingMore={false} listFailed={false}
        onLoadMore={vi.fn()} onReload={vi.fn()} onClose={vi.fn()} onRestore={restore} onRemove={vi.fn()}
      /></NextIntlClientProvider>);
      expect(load).toHaveBeenCalledTimes(1);
      fireEvent.click(within(screen.getByRole("region", { name: messages.reportRecovery.chooseDraft }))
        .getByRole("button", { name: /第二份草稿正文/ }));
      expect(load).toHaveBeenCalledTimes(2);
      await act(async () => firstRead.resolve(first));
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      await act(async () => secondRead.resolve(second));
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
      expect(restore).toHaveBeenCalledWith(second);
    } finally { cleanup(); restoreDialog(); }
  });

  it("refreshes recovery metadata on a failed preview retry and keeps restore disabled until the body arrives", async () => {
    const restoreDialog = mockRecoveryDialog();
    const draft: reportRecovery.ReportRecoveryDraft = {
      schema: 1, id: "old-session", revision: "draft-1", projectId: report.project_id, reportId: report.id,
      baseVersion: report.version, updatedAt: 1, document: { ...structuredClone(report), title: "重试后的草稿" },
    };
    const pending = deferred<reportRecovery.ReportRecoveryDraft>();
    vi.spyOn(reportRecovery, "loadReportRecoveryDraft").mockRejectedValueOnce(new Error("Changed draft")).mockReturnValueOnce(pending.promise);
    const reload = vi.fn();
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportRecoveryPanel
        drafts={[reportRecovery.reportRecoverySummary(draft)]} report={report}
        dirty={false} busy={false} error={false} total={1} hasMore={false} loadingMore={false} listFailed={false}
        onLoadMore={vi.fn()} onReload={reload} onClose={vi.fn()} onRestore={vi.fn()} onRemove={vi.fn()}
      /></NextIntlClientProvider>);
      expect(await screen.findByRole("alert")).toHaveTextContent(messages.reportRecovery.previewFailed);
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: messages.reportRecovery.retry }));
      expect(reload).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeDisabled();
      await act(async () => pending.resolve(draft));
      expect(screen.getByRole("button", { name: "恢复草稿" })).toBeEnabled();
    } finally { cleanup(); restoreDialog(); }
  });

  it("scopes native discard approval to one unchanged unload and restores recovery after a cancelled close", async () => {
    let receive!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
    vi.stubGlobal("electronAPI", { onPrepareClose: (callback: typeof receive) => { receive = callback; return vi.fn(); } });
    const unsubscribe = subscribeToDesktopClose()!;
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      const title = screen.getByRole("textbox", { name: "报告标题" });
      fireEvent.change(title, { target: { value: "尚未保存的标题" } });
      const clear = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "clear").mockResolvedValue(true);
      const checkpoint = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint");
      expect(await receive("inspect")).toBe("dirty");
      expect(await receive("discard")).toBe("clean");
      const approved = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(approved);
      expect(approved.defaultPrevented).toBe(false);
      const again = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(again);
      expect(again.defaultPrevented).toBe(true);
      expect(await receive("cancel")).toBe("unavailable");
      expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ title: "尚未保存的标题" }));
      expect(await receive("discard")).toBe("clean");
      fireEvent.change(title, { target: { value: "放弃确认之后的新标题" } });
      const newer = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(newer);
      expect(newer.defaultPrevented).toBe(true);
      expect(clear).toHaveBeenCalledTimes(2);
      expect(updateReport).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("groups report history typing and keeps undo/redo across saves with the current version", async () => {
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    const title = screen.getByRole("textbox", { name: "报告标题" });
    title.focus();
    fireEvent.change(title, { target: { value: "新" } });
    fireEvent.change(title, { target: { value: "新标题" } });
    const cleanup = deferred<boolean>();
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "clear").mockReturnValueOnce(cleanup.promise);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(title).toHaveValue(report.title);
    expect(screen.queryByText("有尚未保存的修改")).not.toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => cleanup.resolve(true));
    fireEvent.keyDown(title, { key: "z", ctrlKey: true, shiftKey: true });
    expect(title).toHaveValue("新标题");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByText("有尚未保存的修改")).not.toBeInTheDocument());
    const nativeUndo = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
    act(() => title.dispatchEvent(nativeUndo));
    expect(nativeUndo.defaultPrevented).toBe(true);
    expect(title).toHaveValue(report.title);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2]).toMatchObject({ expected_version: 2, title: report.title });
  });

  it("keeps report history edits made during saving separate from the saved checkpoint", async () => {
    const pending = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(pending.promise);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    const title = screen.getByRole("textbox", { name: "报告标题" });
    title.focus();
    fireEvent.change(title, { target: { value: "正在保存的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.change(title, { target: { value: "保存期间继续输入" } });
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    await act(async () => pending.resolve({ ...structuredClone(report), title: "正在保存的标题", version: 2 }));
    expect(title).toHaveValue("保存期间继续输入");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(title).toHaveValue("正在保存的标题");
    expect(screen.queryByText("有尚未保存的修改")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(title).toHaveValue("保存期间继续输入");
    expect(updateReport).toHaveBeenCalledOnce();
  });

  it("requires an explicit copy choice when report history restores a saved deletion with an unavailable source", async () => {
    const initial = reportWithBlock({ ...report.pages[0].blocks[0], source_kind: "artifact", artifact_id: null,
      source_available: false, source_ref: { artifact_id: "deleted-artifact" } });
    getReport.mockResolvedValue(initial);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: messages.reportBlocks.blockActions }));
    fireEvent.click(screen.getByRole("button", { name: messages.reportBlocks.deleteAria }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByText("有尚未保存的修改")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByText(messages.reportWorkspace.historySourceMissing)).toBeInTheDocument();
    expect(screen.queryByText("收入稳步增长")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("收入稳步增长")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复为副本" }));
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(updateReport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2].pages[0].blocks[0]).toMatchObject({ id: expect.stringMatching(/^local-block-/),
      source_kind: "manual", analysis_run_id: null, artifact_id: null, content: { text: "收入稳步增长" } });
    expect(updateReport.mock.calls[1][2].expected_version).toBe(2);
  });

  it("keeps the report session and unsaved edits when the interface language changes", async () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "保留我的修改" } });
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("textbox", { name: "Report title" })).toHaveValue("保留我的修改");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledTimes(1);
  });

  it("cancels the previous report read and ignores its late response", async () => {
    const previous = deferred<ReportDocument>();
    getReport.mockReturnValueOnce(previous.promise).mockResolvedValueOnce({ ...structuredClone(report), id: "report-2", title: "第二份报告" });
    const workspace = (id: string) => <NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId={id} /></NextIntlClientProvider>;
    const { rerender } = render(workspace("report-1"));
    const signal = getReport.mock.calls[0][3] as AbortSignal;
    rerender(workspace("report-2"));
    await screen.findByText("第二份报告");
    expect(signal.aborted).toBe(true);
    await act(async () => previous.resolve(structuredClone(report)));
    expect(screen.getByText("第二份报告")).toBeInTheDocument();
    expect(screen.queryByText("经营概览")).not.toBeInTheDocument();
  });

  it("commits an edit before a same-tick save and sends only one save request", async () => {
    const pending = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(pending.promise);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    act(() => {
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "即时保存" } });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
    });
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
    expect(updateReport.mock.calls[0][2].title).toBe("即时保存");
    await act(async () => pending.resolve({ ...structuredClone(report), title: "即时保存", version: 2 }));
  });

  it("does not replace a new report when a previous save finishes", async () => {
    const pending = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(pending.promise);
    const workspace = (id: string) => <NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId={id} /></NextIntlClientProvider>;
    const { rerender } = render(workspace("report-1"));
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "旧报告的修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    getReport.mockResolvedValueOnce({ ...structuredClone(report), id: "report-2", title: "新报告" });
    rerender(workspace("report-2"));
    await screen.findByText("新报告");
    await act(async () => pending.resolve({ ...structuredClone(report), title: "旧报告的修改", version: 2 }));
    expect(screen.getByText("新报告")).toBeInTheDocument();
    expect(screen.queryByText("旧报告的修改")).not.toBeInTheDocument();
  });

  it("merges a conflict comparison without discarding local edits or saving before confirmation", async () => {
    const restoreDialog = mockRecoveryDialog();
    const checkpoint = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint").mockImplementation(() => {});
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "flush").mockResolvedValue(true);
    updateReport.mockRejectedValueOnce(new ReportConflictError());
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "保留本地标题" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.conflictError);
      // Continued typing must not lose the conflict action or silently retry a stale write.
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "最新本地标题" } });
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      expect(updateReport).toHaveBeenCalledTimes(1);
      const latest = structuredClone(report);
      latest.version = 8;
      latest.description = "别处更新的说明";
      latest.pages[0].blocks[0].content.text = "别处更新的结论";
      getReport.mockResolvedValueOnce(latest);
      fireEvent.click(screen.getByRole("button", { name: "比较并合并" }));
      const dialog = await screen.findByRole("dialog", { name: "合并报告修改" });
      await within(dialog).findByText(messages.reportConflict.noConflicts);
      expect(updateReport).toHaveBeenCalledTimes(1);
      fireEvent.click(within(dialog).getByRole("button", { name: "应用并继续编辑" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "合并报告修改" })).not.toBeInTheDocument());
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("最新本地标题");
      expect(screen.getByText("别处更新的结论")).toBeInTheDocument();
      expect(checkpoint.mock.calls.some(([document]) => document.title === "最新本地标题" && document.version === 1)).toBe(true);
      expect(checkpoint.mock.calls.some(([document]) => document.title === "最新本地标题" && document.version === 8)).toBe(true);
      expect(updateReport).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
      expect(updateReport.mock.calls[1][2]).toMatchObject({ expected_version: 8, title: "最新本地标题", description: "别处更新的说明" });
    } finally { cleanup(); restoreDialog(); }
  });

  it("resolves a pending page copy's deleted origin before applying, undoing and saving the merged report", async () => {
    mockViewportWidth(1600);
    const original = structuredClone(report);
    Object.assign(original.pages[0].blocks[0], { source_kind: "artifact", analysis_run_id: "run-1", artifact_id: "artifact-1",
      source_available: true, source_ref: { artifact_id: "artifact-1", analysis_run_id: "run-1" } });
    const latest = { ...structuredClone(original), version: 3, description: "另一版本的说明" };
    latest.pages[0].blocks = [];
    getReport.mockResolvedValueOnce(original);
    const checkpoint = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint").mockImplementation(() => {});
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "flush").mockResolvedValue(true);
    updateReport.mockImplementation(async (_project, _report, input) => ({ ...latest, ...input, version: 4 }));
    updateReport.mockRejectedValueOnce(new ReportConflictError());
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "页面操作：概览" }));
    fireEvent.click(screen.getByRole("button", { name: "复制页面：概览" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(messages.reportWorkspace.conflictError);
    getReport.mockResolvedValueOnce(latest);
    fireEvent.click(screen.getByRole("button", { name: "比较并合并" }));
    const dialog = await screen.findByRole("dialog", { name: "合并报告修改" });
    const keep = await within(dialog).findByRole("radio", { name: /保留本地副本/ });
    expect(within(dialog).getByRole("button", { name: "应用并继续编辑" })).toBeDisabled();
    fireEvent.click(keep);
    expect(updateReport).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole("button", { name: "应用并继续编辑" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "合并报告修改" })).not.toBeInTheDocument());
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(updateReport).toHaveBeenCalledOnce();
    expect(checkpoint.mock.calls.some(([draft]) => draft.version === 1 && draft.pages.some((page) =>
      page.blocks.some((block) => block.copy_source_block_id === original.pages[0].blocks[0].id)))).toBe(true);
    expect(checkpoint.mock.calls.some(([draft]) => draft.version === 3 && draft.pages.some((page) =>
      page.blocks.some((block) => block.id.startsWith("local-") && block.source_kind === "manual" && !block.copy_source_block_id)))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.queryByText("收入稳步增长")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    const payload = updateReport.mock.calls[1][2];
    expect(payload).toMatchObject({ expected_version: 3, description: "另一版本的说明" });
    expect(payload.pages[1].blocks[0]).toMatchObject({ source_kind: "manual", artifact_id: null, analysis_run_id: null,
      copy_source_block_id: undefined, source_ref: undefined, content: original.pages[0].blocks[0].content });
  });

  it("requires a conflict comparison choice and retains the editor if draft preservation fails", async () => {
    const restoreDialog = mockRecoveryDialog();
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint").mockImplementation(() => {});
    const flush = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "flush").mockResolvedValue(true);
    updateReport.mockRejectedValueOnce(new ReportConflictError());
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "我的标题" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.conflictError);
      getReport.mockResolvedValueOnce({ ...structuredClone(report), title: "最新标题", version: 3 });
      fireEvent.click(screen.getByRole("button", { name: "比较并合并" }));
      const dialog = await screen.findByRole("dialog", { name: "合并报告修改" });
      const mine = await within(dialog).findByRole("radio", { name: /保留我的修改/ });
      expect(within(dialog).getByRole("button", { name: "应用并继续编辑" })).toBeDisabled();
      fireEvent.click(mine);
      flush.mockResolvedValueOnce(false);
      fireEvent.click(within(dialog).getByRole("button", { name: "应用并继续编辑" }));
      await within(dialog).findByText(messages.reportConflict.preserveFailed);
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("我的标题");
      expect(updateReport).toHaveBeenCalledTimes(1);
      fireEvent.click(within(dialog).getByRole("button", { name: "应用并继续编辑" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "合并报告修改" })).not.toBeInTheDocument());
      // Another writer may still win after comparison; saving keeps the CAS gate.
      updateReport.mockRejectedValueOnce(new ReportConflictError());
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.conflictError);
      expect(updateReport.mock.calls[1][2]).toMatchObject({ title: "我的标题", expected_version: 3 });
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("我的标题");
    } finally { cleanup(); restoreDialog(); }
  });

  it("keeps a failed conflict comparison cancellable and ignores its late read after closure", async () => {
    const restoreDialog = mockRecoveryDialog();
    vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint").mockImplementation(() => {});
    updateReport.mockRejectedValueOnce(new ReportConflictError());
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "不要丢掉" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.conflictError);
      getReport.mockRejectedValueOnce(new Error("offline"));
      fireEvent.click(screen.getByRole("button", { name: "比较并合并" }));
      const dialog = await screen.findByRole("dialog", { name: "合并报告修改" });
      await within(dialog).findByText(messages.reportConflict.loadFailed);
      const pending = deferred<ReportDocument>();
      getReport.mockReturnValueOnce(pending.promise);
      fireEvent.click(within(dialog).getByRole("button", { name: "重新读取" }));
      const signal = getReport.mock.calls[2][3] as AbortSignal;
      fireEvent.click(within(dialog).getByRole("button", { name: "返回编辑" }));
      expect(signal.aborted).toBe(true);
      await act(async () => pending.resolve({ ...structuredClone(report), version: 9, title: "迟到的报告" }));
      expect(screen.queryByRole("dialog", { name: "合并报告修改" })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("不要丢掉");
      expect(updateReport).toHaveBeenCalledTimes(1);
    } finally { cleanup(); restoreDialog(); }
  });

  it("confirms a destructive reload and keeps the draft if reading fails", async () => {
    updateReport.mockRejectedValueOnce(new ReportConflictError());
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "不要丢掉" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(messages.reportWorkspace.conflictError);
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    expect(screen.getByText(messages.reportWorkspace.reloadDiscardWarning)).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("不要丢掉");
    getReport.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并重新载入" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(updateReport).toHaveBeenCalledTimes(1);
    await screen.findByText(messages.reportWorkspace.loadError);
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("不要丢掉");
    expect(screen.getByText(messages.reportWorkspace.unsavedChanges)).toBeInTheDocument();
    getReport.mockResolvedValueOnce({ ...structuredClone(report), title: "服务端新版", version: 3 });
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并重新载入" }));
    await screen.findByText("服务端新版");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exports selected PDF pages with inherited filters and keeps the selection through an asset failure", async () => {
    getReport.mockResolvedValue(connectedFilterReport());
    const ready = deferred<void>();
    const assets = vi.spyOn(reportImages, "waitForReportAssets").mockImplementationOnce(async () => {
      await ready.promise; throw new Error("image unavailable");
    }).mockResolvedValue(undefined);
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      const output = document.querySelector(".report-print-view")!;
      const pages = output.querySelectorAll(".report-print-page");
      expect(pages).toHaveLength(2);
      expect(pages[0].querySelector(".report-print-kicker")).toHaveTextContent("经营明细");
      expect(pages[0]).toHaveTextContent("跨页地区筛选");
      expect(pages[0]).toHaveTextContent("东区订单");
      expect(pages[0]).not.toHaveTextContent("西区订单");
      expect(pages[0]).toHaveTextContent("1 / 2");
      expect(pages[1]).toHaveTextContent("2 / 2");
    });
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "跨页地区筛选" }), { target: { value: "华东" } });
    fireEvent.change(screen.getByRole("combobox", { name: "选择报告页面" }), { target: { value: "page-2" } });
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "选择页面导出 PDF…" }));
    const picker = screen.getByRole("dialog", { name: "选择导出页面" });
    expect(within(picker).getByRole("checkbox", { name: "第 2 页：经营明细" })).toBeChecked();
    fireEvent.click(within(picker).getByRole("checkbox", { name: "第 3 页：说明" }));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(print).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled();
    fireEvent.click(within(picker).getByRole("button", { name: "导出所选页面" }));
    await waitFor(() => expect(assets).toHaveBeenCalledOnce());
    expect(within(picker).getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(picker, { key: "Escape" });
    await act(async () => ready.resolve());
    expect(within(picker).getByRole("alert")).toHaveTextContent(messages.reportWorkspace.pdfExportError);
    expect(within(picker).getByRole("status")).toHaveTextContent("已选 2 个报告页面");
    expect(document.querySelector(".report-print-view")).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "导出所选页面" }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "选择导出页面" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出报告" })).toHaveFocus();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains selected PDF page identity after save promotion and retry (concurrent edit: %s)", async (concurrentEdit) => {
    const local = structuredClone(report); local.pages[0].id = "local-page-pdf";
    getReport.mockResolvedValue(local);
    const saveReady = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(saveReady.promise).mockImplementation(async (_projectId, _reportId, input) => ({
      ...structuredClone(report), ...input, version: 3,
    }));
    const assets = vi.spyOn(reportImages, "waitForReportAssets").mockResolvedValue(undefined);
    if (!concurrentEdit) assets.mockRejectedValueOnce(new Error("assets failed"));
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.querySelectorAll(".report-print-page")).toHaveLength(1);
      expect(document.querySelector(".report-print-view")).toHaveTextContent(concurrentEdit ? "Later draft" : "Selected export");
    });
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "Selected export" } });
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "选择页面导出 PDF…" }));
    const picker = screen.getByRole("dialog", { name: "选择导出页面" });
    fireEvent.click(within(picker).getByRole("button", { name: "导出所选页面" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    const input = structuredClone(updateReport.mock.calls[0][2]);
    const promoted = { ...structuredClone(report), ...input, version: 2,
      pages: input.pages.map((page: ReportDocument["pages"][number]) => ({ ...page, id: "saved-page" })) };
    // Model an external edit during acknowledgement; normal pointer input is inert behind the modal.
    if (concurrentEdit) fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "Later draft" } });
    await act(async () => saveReady.resolve(promoted));
    expect(within(picker).getByRole("alert")).toHaveTextContent(concurrentEdit ? messages.reportWorkspace.saveBeforeExport : messages.reportWorkspace.pdfExportError);
    expect(within(picker).getByRole("checkbox", { name: "第 1 页：概览" })).toBeChecked();
    expect(within(picker).getByRole("status")).toHaveTextContent("已选 1 个报告页面");
    fireEvent.click(within(picker).getByRole("button", { name: "导出所选页面" }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(updateReport).toHaveBeenCalledTimes(concurrentEdit ? 2 : 1);
    expect(screen.queryByRole("dialog", { name: "选择导出页面" })).not.toBeInTheDocument();
  });

  it("prints a frozen snapshot and reports unavailable chart assets", async () => {
    const ready = deferred<void>();
    const assets = vi.spyOn(reportImages, "waitForReportAssets").mockReturnValueOnce(ready.promise);
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.querySelector(".report-print-view")).toHaveTextContent("经营概览");
      expect(document.querySelector(".report-print-view")).not.toHaveTextContent("导出期间的修改");
    });
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(assets).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "导出期间的修改" } });
    await act(async () => ready.resolve());
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".report-print-view")).toBeNull();
    assets.mockRejectedValueOnce(new Error("chart unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 PDF" }));
    await screen.findByText(messages.reportWorkspace.pdfExportError);
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "导出报告" })).toBeEnabled();
  });

  it("keeps server provenance while reconciling edits made during a save", () => {
    const sent = structuredClone(report);
    sent.pages[0].blocks[0].id = "local-block-1";
    const saved = structuredClone(sent);
    saved.version = 2;
    saved.pages[0].blocks[0] = {
      ...saved.pages[0].blocks[0], id: "persisted-block", version: 2,
      source_ref: { snapshot: { title: "server receipt" } }, source_available: false,
    };
    const current = structuredClone(sent);
    current.pages[0].blocks[0].title = "New local title";
    const result = reconcileReportAfterSave(current, sent, saved);
    expect(result.report.pages[0].blocks[0]).toMatchObject({
      id: "persisted-block", title: "New local title", version: 2,
      source_ref: saved.pages[0].blocks[0].source_ref, source_available: false,
    });
    expect(result.report.version).toBe(2);
    expect(result.blockIds.get("local-block-1")).toBe("persisted-block");
  });

  it("switches from a clean reading view into a fully editable report", async () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByText("收入稳步增长")).toBeInTheDocument();
    expect(screen.queryByLabelText("区块标题")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "添加内容" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "指标" }));

    const title = screen.getByLabelText("区块标题");
    fireEvent.change(title, { target: { value: "本月收入" } });
    expect(screen.getByRole("heading", { name: "本月收入", level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
    expect(updateReport.mock.calls[0][2]).toMatchObject({
      expected_version: 1,
      title: "经营概览",
    });
    expect(updateReport.mock.calls[0][2].pages[0].blocks).toHaveLength(2);
  });

  it("keeps report page navigation visible and usable in reading mode", async () => {
    const secondPage = {
      ...structuredClone(report.pages[0]),
      id: "page-2",
      title: "经营明细",
      order_index: 1,
      blocks: [
        {
          ...structuredClone(report.pages[0].blocks[0]),
          id: "block-2",
          title: "明细结论",
          content: { text: "第二页经营明细" },
        },
      ],
    };
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [...structuredClone(report.pages), secondPage],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByText("收入稳步增长")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "报告分页" })).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();
    expect(screen.getByText(/第 1 页 · 更新于/)).toBeInTheDocument();
    expect(screen.queryByText(/凭证|REPORT-1|v1/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一页：经营明细" }));

    expect(screen.getByText("第二页经营明细")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
    expect(screen.getByText(/第 2 页 · 更新于/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue(
      "page-2"
    );
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "报告标题" })).not.toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("keeps the same page navigator in edit mode and exposes page creation", async () => {
    const secondPage = {
      ...structuredClone(report.pages[0]),
      id: "page-2",
      title: "经营明细",
      order_index: 1,
      blocks: [
        {
          ...structuredClone(report.pages[0].blocks[0]),
          id: "block-2",
          content: { text: "第二页经营明细" },
        },
      ],
    };
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [...structuredClone(report.pages), secondPage],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择报告页面" }), {
      target: { value: "page-2" },
    });
    expect(screen.getByText("第二页经营明细")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增页面" }));
    expect(within(screen.getByRole("navigation", { name: messages.reportWorkspace.pageNavigation })).getByText("第 3 / 3 页")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveTextContent(
      "03 · 页面 3"
    );
    expect(screen.getByText("这个页面还是空的")).toBeInTheDocument();
  });

  it("duplicates an investigation block as an independent manual block", async () => {
    const sourceBlock = {
      id: "artifact-block-1",
      block_type: "text" as const,
      title: "调查结论",
      order_index: 0,
      source_kind: "artifact" as const,
      analysis_run_id: "run-1",
      artifact_id: "artifact-1",
      source_ref: { result_name: "monthly_summary" },
      source_available: true,
      content: { text: "收入增长", details: { region: "华东" } },
      config: { manual_override: true, emphasis: "strong" },
      layout: { x: 0, y: 0, w: 6, h: 3 },
      version: 4,
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [
        {
          ...structuredClone(report.pages[0]),
          blocks: [sourceBlock],
        },
      ],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制区块" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));

    const savedBlocks = updateReport.mock.calls[0][2].pages[0].blocks;
    const copy = savedBlocks.find(
      (block: { title: string }) => block.title === "调查结论 副本"
    );
    expect(copy).toBeDefined();
    if (!copy) throw new Error("复制区块未保存");
    expect(copy).toMatchObject({
      source_kind: "manual",
      analysis_run_id: null,
      artifact_id: null,
      content: sourceBlock.content,
      config: { emphasis: "strong" },
    });
    expect(copy.content).not.toBe(sourceBlock.content);
    expect(copy.config).not.toBe(sourceBlock.config);
    for (const field of [
      "source_ref",
      "source_available",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(copy).not.toHaveProperty(field);
    }
    expect(copy.config).not.toHaveProperty("manual_override");
    expect(savedBlocks[0]).toMatchObject({
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-1",
    });
  });

  it("refreshes the page from reading mode in one request and locks mutations until it finishes", async () => {
    const initial = reportWithBlock({
      id: "page-refresh-table", block_type: "table", title: "订单数据", order_index: 0,
      source_kind: "artifact", source_available: true, analysis_run_id: "run-1", artifact_id: "table-1",
      content: { rows: [{ 客户: "旧客户" }] }, config: {}, layout: { x: 0, y: 0, w: 12, h: 5 }, version: 1,
    });
    initial.pages[0].version = 7;
    getReport.mockResolvedValue(initial);
    const pending = deferred<ReportDocument>();
    refreshReportPage.mockReturnValue(pending.promise);
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportWorkspace projectId="project-1" reportId="report-1" />
    </NextIntlClientProvider>);
    await screen.findByText("旧客户");
    fireEvent.click(reportAction(messages.reportWorkspace.refreshPage));
    expect(refreshReportPage).not.toHaveBeenCalled();
    expect(await screen.findByText(/九月订单.csv/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "确认刷新" }));
    expect(refreshReportPage).toHaveBeenCalledWith("project-1", "report-1", "page-1", 7, expect.any(Object), "a".repeat(64));
    expect(refreshReportBlock).not.toHaveBeenCalled();
    expect(reportAction("正在刷新数据")).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出报告" })).toBeDisabled();
    expect(screen.getByText("旧客户")).toBeInTheDocument();
    const refreshed = structuredClone(initial);
    refreshed.pages[0].version = 8;
    refreshed.pages[0].blocks[0].content = { rows: [{ 客户: "新客户" }] };
    await act(async () => pending.resolve(refreshed));
    expect(await screen.findByText("新客户")).toBeInTheDocument();
    expect(reportAction(messages.reportWorkspace.refreshPage)).toBeEnabled();
    expect(screen.getByRole("button", { name: "阅读报告" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["review", "confirm"])("reloads a stale report after a source %s conflict without repeating the write", async (stage) => {
    const initial = reportWithBlock({
      id: "stale-table", block_type: "table", title: "订单数据", order_index: 0,
      source_kind: "artifact", source_available: true, analysis_run_id: "run-1", artifact_id: "table-1",
      content: { rows: [{ 客户: "旧客户" }] }, config: {}, layout: { x: 0, y: 0, w: 12, h: 5 }, version: 1,
    });
    const current = structuredClone(initial);
    initial.pages[0].version = 1;
    current.pages[0].version = 2;
    getReport.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(current);
    if (stage === "review") inspectReportRefreshSources.mockRejectedValueOnce(new ReportConflictError());
    else refreshReportPage.mockRejectedValueOnce(new ReportConflictError());
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportWorkspace projectId="project-1" reportId="report-1" />
    </NextIntlClientProvider>);
    await screen.findByText("旧客户");
    fireEvent.click(reportAction(messages.reportWorkspace.refreshPage));
    if (stage === "confirm") {
      await screen.findByText(/九月订单.csv/);
      fireEvent.click(screen.getByRole("button", { name: messages.reportRefresh.confirm }));
    }
    const dialog = await screen.findByRole("dialog", { name: messages.reportRefresh.title });
    await within(dialog).findByText(messages.reportRefresh.conflict);
    expect(within(dialog).queryByRole("button", { name: messages.reportRefresh.retry })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportRefresh.reload }));
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: messages.reportRefresh.reload })).toBeEnabled());
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: messages.reportRefresh.reload }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(refreshReportPage).toHaveBeenCalledTimes(stage === "confirm" ? 1 : 0);
    fireEvent.click(reportAction(messages.reportWorkspace.refreshPage));
    await screen.findByText(/九月订单.csv/);
    expect(inspectReportRefreshSources).toHaveBeenLastCalledWith(
      "project-1", "report-1", "page-1", current.pages[0].version, undefined, expect.any(AbortSignal),
    );
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("refreshes a saved artifact table with its block version and keeps selection", async () => {
    const tableBlock: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-refreshable",
      block_type: "table",
      title: "区域明细",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-table",
      source_ref: {
        source_kind: "artifact",
        snapshot: { artifact_kind: "table", payload: { rows: [{ 地区: "华东" }] } },
      },
      source_available: true,
      content: { rows: [{ 地区: "华东", 收入: 12 }] },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 7,
    };
    const initial = reportWithBlock(tableBlock);
    const refreshed = structuredClone(initial);
    refreshed.version = 2;
    refreshed.updated_at = "2026-07-19T03:00:00Z";
    refreshed.pages[0].blocks[0] = {
      ...refreshed.pages[0].blocks[0],
      content: { rows: [{ 地区: "华东", 收入: 18 }] },
      version: 8,
    };
    getReport.mockResolvedValue(initial);
    refreshReportBlock.mockResolvedValue(refreshed);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("12");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByText("区域明细"));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新数据" }));

    fireEvent.click(await screen.findByRole("button", { name: "确认刷新" }));
    await waitFor(() =>
      expect(refreshReportBlock).toHaveBeenCalledWith(
        "project-1",
        "report-1",
        "page-1",
        "table-refreshable",
        7,
        expect.any(Object),
        "a".repeat(64)
      )
    );
    expect(await screen.findByText("18")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("区域明细");
    expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue(
      "page-1"
    );
  });

  it("freezes report mutations until a block refresh has finished", async () => {
    const tableBlock: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-refresh-lock",
      block_type: "table",
      title: "区域明细",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-table",
      source_ref: {
        source_kind: "artifact",
        snapshot: { artifact_kind: "table", payload: { rows: [{ 地区: "华东" }] } },
      },
      source_available: true,
      content: { rows: [{ 地区: "华东", 收入: 12 }] },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 7,
    };
    const initial = reportWithBlock(tableBlock);
    const refreshed = structuredClone(initial);
    refreshed.version = 2;
    refreshed.updated_at = "2026-07-19T03:00:00Z";
    refreshed.pages[0].blocks[0] = {
      ...refreshed.pages[0].blocks[0],
      content: { rows: [{ 地区: "华东", 收入: 18 }] },
      version: 8,
    };
    const pendingRefresh = deferred<ReportDocument>();
    getReport.mockResolvedValue(initial);
    refreshReportBlock.mockReturnValue(pendingRefresh.promise);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("12");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新数据" }));

    fireEvent.click(await screen.findByRole("button", { name: "确认刷新" }));
    const titleInput = screen.getByRole("textbox", { name: "报告标题" });
    await waitFor(() => expect(titleInput).toBeDisabled());
    fireEvent.change(titleInput, { target: { value: "刷新期间的编辑" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });

    expect(titleInput).toHaveValue("经营概览");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(updateReport).not.toHaveBeenCalled();

    await act(async () => pendingRefresh.resolve(refreshed));

    expect(await screen.findByText("18")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue(
      "经营概览"
    );
    expect(screen.getByRole("textbox", { name: "报告标题" })).toBeEnabled();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("asks the user to save before refreshing a dirty report", async () => {
    const tableBlock: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-dirty",
      block_type: "table",
      title: "订单明细",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-table",
      source_ref: { snapshot: { artifact_kind: "table", payload: {} } },
      source_available: true,
      content: { rows: [{ 订单: "A-1" }] },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 3,
    };
    getReport.mockResolvedValue(reportWithBlock(tableBlock));

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("A-1");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), {
      target: { value: "尚未保存的经营概览" },
    });
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));

    expect(screen.getByRole("menuitem", { name: "保存后刷新" })).toBeDisabled();
    expect(reportAction(messages.reportWorkspace.refreshPage)).toBeDisabled();
    expect(refreshReportPage).not.toHaveBeenCalled();
    expect(refreshReportBlock).not.toHaveBeenCalled();
  });

  it("keeps refresh available from a saved binding after the source artifact is cleaned up", async () => {
    const boundTable: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-saved-binding",
      block_type: "table",
      title: "月度明细",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: null,
      artifact_id: null,
      source_ref: {
        snapshot: { artifact_kind: "table", payload: {} },
        refresh_binding: {
          version: 1,
          kind: "analysis_playbook",
          playbook_id: "pb_12345678901234567890",
          playbook_shape_hash: "a".repeat(64),
          result_name: "result_1",
        },
      },
      source_available: false,
      content: { rows: [{ 月份: "7月" }] },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 5,
    };
    getReport.mockResolvedValue(reportWithBlock(boundTable));

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("7月");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    expect(screen.getByRole("menuitem", { name: "刷新数据" })).toBeEnabled();
  });

  it("keeps the displayed result and offers reload when refresh outcome is unknown", async () => {
    const tableBlock: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-refresh-failure",
      block_type: "table",
      title: "客户明细",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-table",
      source_ref: { snapshot: { artifact_kind: "table", payload: {} } },
      source_available: true,
      content: { rows: [{ 客户: "保留的客户", 金额: 24 }] },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 4,
    };
    getReport.mockResolvedValue(reportWithBlock(tableBlock));
    refreshReportBlock.mockRejectedValue(new Error("playbook failed with hash"));

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("保留的客户");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新数据" }));

    fireEvent.click(await screen.findByRole("button", { name: "确认刷新" }));
    expect(
      await screen.findByText(messages.reportWorkspace.refreshError)
    ).toBeInTheDocument();
    expect(screen.getByText("保留的客户")).toBeInTheDocument();
    expect(screen.queryByText(/playbook|hash|SQL|job/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.reportWorkspace.reload })).toBeInTheDocument();

    refreshReportBlock.mockRejectedValue(new ReportRefreshError("report_refresh_preparation_required"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认刷新来源" })).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新数据" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认刷新" }));
    expect(await screen.findByText(messages.reportWorkspace.refreshPreparationRequired)).toBeInTheDocument();
    expect(screen.getByText("保留的客户")).toBeInTheDocument();
  });

  it("does not offer refresh for an unsupported PNG chart", async () => {
    const pngChart: ReportDocument["pages"][number]["blocks"][number] = {
      id: "chart-png",
      block_type: "chart",
      title: "静态图",
      order_index: 0,
      source_kind: "artifact",
      analysis_run_id: "run-1",
      artifact_id: "artifact-png",
      source_ref: {
        snapshot: { artifact_kind: "chart", payload: { format: "image/png" } },
      },
      source_available: true,
      content: { image_url: "/api/v1/artifacts/artifact-png/file" },
      config: { chart_type: "image" },
      layout: { x: 0, y: 0, w: 8, h: 5 },
      version: 2,
    };
    getReport.mockResolvedValue(reportWithBlock(pngChart));

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("静态图");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));

    expect(screen.queryByRole("button", { name: "刷新数据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存后刷新" })).not.toBeInTheDocument();
  });

  it("labels table pagination as pages in English", async () => {
    const tableBlock: ReportDocument["pages"][number]["blocks"][number] = {
      id: "table-pagination-copy",
      block_type: "table",
      title: "Order details",
      order_index: 0,
      source_kind: "manual",
      analysis_run_id: null,
      artifact_id: null,
      content: {
        rows: Array.from({ length: 51 }, (_, index) => ({
          Order: `Order ${index + 1}`,
          Amount: index + 1,
        })),
      },
      config: {},
      layout: { x: 0, y: 0, w: 12, h: 5 },
      version: 1,
    };
    getReport.mockResolvedValue(reportWithBlock(tableBlock));

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByText("Page 1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Rows 1 / 2")).not.toBeInTheDocument();
  });

  it("preserves library search, status, sorting and page when returning from the editor", async () => {
    vi.spyOn(nextNavigation, "useSearchParams").mockReturnValue(new URLSearchParams(
      "fromConversation=conversation-1&q=%E5%8D%8E%E4%B8%9C&sort=title&status=draft&page=2&returnTo=https://example.invalid"
    ) as ReturnType<typeof nextNavigation.useSearchParams>);
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportWorkspace projectId="project-1" reportId="report-1" />
    </NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    const href = screen.getByRole("link", { name: "返回报告列表" }).getAttribute("href")!;
    const target = new URL(href, "https://receiptbi.invalid");
    expect(target.pathname).toBe("/projects/project-1/reports");
    expect(Object.fromEntries(target.searchParams)).toEqual({ fromConversation: "conversation-1", q: "华东", sort: "title", status: "draft", page: "2" });
    expect(getReport).toHaveBeenCalledTimes(1);
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("preserves the source conversation when returning to the report list", async () => {
    useChatStore.setState({
      currentConversationId: "conversation-1",
      lastProjectId: "project-1",
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("收入稳步增长");
    expect(screen.getByRole("link", { name: "返回报告列表" })).toHaveAttribute(
      "href",
      "/projects/project-1/reports?fromConversation=conversation-1"
    );
  });

  it("saves dirty edits before returning through internal navigation", async () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), {
      target: { value: "离开前保存的标题" },
    });
    fireEvent.click(screen.getByRole("link", { name: "返回报告列表" }));

    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
    expect(updateReport.mock.calls[0][2].title).toBe("离开前保存的标题");
  });

  it("keeps one toolbar menu open and closes menus when returning to reading without changing the report", async () => {
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    for (const name of ["添加内容", "导出报告", messages.reportWorkspace.moreActions, "添加内容"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getAllByRole("menu")).toHaveLength(1);
      expect(screen.getByRole("menu", { name })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "阅读报告" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
    expect(exportReportExcel).not.toHaveBeenCalled();
    expect(listReportAnalysisRuns).not.toHaveBeenCalled();
  });

  it("adds editable blocks from a completed investigation", async () => {
    listReportAnalysisRuns.mockResolvedValue(historyPage([
      {
        id: "run-1",
        project_id: "project-1",
        conversation_id: "conversation-1",
        query: "分析月度收入",
        state: "completed",
        stage: "completed",
        report: { title: "收入调查", summary: "收入较上月增长" },
        checkpoint: {},
        created_at: "2026-07-19T01:00:00Z",
        updated_at: "2026-07-19T02:00:00Z",
      },
    ]));
    listRunArtifacts.mockResolvedValue([
      {
        id: "artifact-1",
        project_id: "project-1",
        analysis_run_id: "run-1",
        kind: "metric",
        title: "月度收入",
        payload: { value: "128 万元", context: "较上月 +8%" },
        technical_details: {},
        created_at: "2026-07-19T01:00:00Z",
        updated_at: "2026-07-19T01:00:00Z",
      },
    ]);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "添加内容" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /从调查手动挑选/ }));
    fireEvent.click(await screen.findByRole("button", { name: /收入调查/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /月度收入/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /加入当前页面/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /加入当前页面/ }));

    const importedCard = screen.getByRole("heading", { name: "月度收入" }).closest("article")!;
    expect(within(importedCard).getByText("128 万元")).toBeInTheDocument();
    expect(screen.getByLabelText("区块标题")).toHaveValue("月度收入");
    fireEvent.change(screen.getByRole("textbox", { name: "显示数值" }), {
      target: { value: "130 万元" },
    });
    expect(screen.getByText("人工调整")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
    const imported = updateReport.mock.calls[0][2].pages[0].blocks.find(
      (block: { artifact_id?: string }) => block.artifact_id === "artifact-1"
    );
    expect(imported.config.manual_override).toBe(true);
  });

  it("adds cross-investigation selection as one undoable report change without saving", async () => {
    const sources = ["第一份补充结论", "第二份补充结论"].map((title, index) => ({
      id: `run-batch-${index}`, project_id: "project-1", query: title,
      state: "completed", stage: "completed", report: { title, summary: `${title}的摘要` },
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    }));
    listReportAnalysisRuns.mockResolvedValue(historyPage(sources));
    listRunArtifacts.mockResolvedValue([]);
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportWorkspace projectId="project-1" reportId="report-1" />
    </NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "添加内容" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /从调查手动挑选/ }));
    for (const source of sources) {
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(source.query) }));
      fireEvent.click(await screen.findByRole("checkbox", { name: "调查摘要" }));
      expect(screen.getByRole("region", { name: "调查资料库" })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "查看已选内容" }));
    fireEvent.click(screen.getByRole("button", { name: "将调查第二份补充结论整组前移" }));
    fireEvent.click(screen.getByRole("button", { name: "加入当前页面" }));
    for (const source of sources) expect(screen.getByRole("heading", { name: source.query })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /^(第一份|第二份)补充结论$/ }).map((node) => node.textContent)).toEqual([sources[1].query, sources[0].query]);
    const closeProperties = screen.queryByRole("button", { name: "关闭属性面板" });
    if (closeProperties) fireEvent.click(closeProperties);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    for (const source of sources) expect(screen.queryByRole("heading", { name: source.query })).not.toBeInTheDocument();
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(updateReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getAllByRole("heading", { name: /^(第一份|第二份)补充结论$/ }).map((node) => node.textContent)).toEqual([sources[1].query, sources[0].query]);
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("opens the requested investigation when entering from an analysis result", async () => {
    listReportAnalysisRuns.mockResolvedValue(historyPage([
      {
        id: "run-direct",
        project_id: "project-1",
        query: "查看渠道表现",
        state: "completed",
        stage: "completed",
        report: { title: "渠道调查", summary: "线上渠道增长" },
        checkpoint: {},
        created_at: "2026-07-19T01:00:00Z",
        updated_at: "2026-07-19T02:00:00Z",
      },
    ]));
    listRunArtifacts.mockResolvedValue([]);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace
          projectId="project-1"
          reportId="report-1"
          initialRunId="run-direct"
        />
      </NextIntlClientProvider>
    );

    const picker = await screen.findByRole("dialog", { name: messages.investigationPicker.smartTitle });
    expect(await within(picker).findByRole("button", { name: /渠道调查/ })).toHaveAttribute("aria-current", "true");
    await waitFor(() =>
      expect(listRunArtifacts).toHaveBeenCalledWith(
        "project-1",
        "run-direct",
        expect.any(AbortSignal)
      )
    );
  });

  it("retries an uncertain save with its original identity and reconciles later edits without duplicating blocks", async () => {
    updateReport.mockRejectedValueOnce(new Error("reply lost"));
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "区块操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制区块" }));
    const title = screen.getByRole("textbox", { name: "报告标题" });
    fireEvent.change(title, { target: { value: "第一次提交" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(messages.reportWorkspace.saveError);
    const first = structuredClone(updateReport.mock.calls[0][2]);
    const saved = { ...structuredClone(report), title: first.title, pages: structuredClone(first.pages), version: 2 };
    expect(saved.pages[0].blocks).toHaveLength(2);
    saved.pages[0].blocks[1].id = "canonical-copy";
    saved.pages[0].blocks[1].version = 1;
    fireEvent.change(title, { target: { value: "等待期间的新标题" } });
    updateReport.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2]).toEqual({ ...first, retry_save: true });
    await waitFor(() => expect(title).toHaveValue("等待期间的新标题"));
    expect(screen.getByText(messages.reportWorkspace.unsavedChanges)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(3));
    const next = updateReport.mock.calls[2][2];
    expect(next).toMatchObject({ title: "等待期间的新标题", expected_version: 2, retry_save: false });
    expect(next.save_request_id).not.toBe(first.save_request_id);
    expect(next.pages[0].blocks.map((block: { id: string }) => block.id)).toEqual(["block-1", "canonical-copy"]);
  });

  it("keeps an uncertain save guarded after undoing to the old baseline", async () => {
    updateReport.mockRejectedValueOnce(new Error("reply lost"));
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    const title = screen.getByRole("textbox", { name: "报告标题" });
    fireEvent.change(title, { target: { value: "可能已保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(messages.reportWorkspace.saveError);
    const first = structuredClone(updateReport.mock.calls[0][2]);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(title).toHaveValue(report.title);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    updateReport.mockResolvedValueOnce({ ...structuredClone(report), title: first.title, version: 2 });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2]).toEqual({ ...first, retry_save: true });
    await waitFor(() => expect(title).toHaveValue(report.title));
    expect(screen.getByText(messages.reportWorkspace.unsavedChanges)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(3));
    expect(updateReport.mock.calls[2][2]).toMatchObject({ title: report.title, expected_version: 2 });
  });

  it("offers only read-only comparison when an uncertain save receipt is unavailable", async () => {
    const restoreDialog = mockRecoveryDialog();
    updateReport.mockRejectedValueOnce(new Error("reply lost")).mockRejectedValueOnce(new ReportSaveUnconfirmedError());
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "保留未确认的草稿" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.saveError);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(messages.reportWorkspace.saveUnconfirmed);
      getReport.mockResolvedValueOnce({ ...structuredClone(report), title: "最新报告", version: 9 });
      fireEvent.click(screen.getByRole("button", { name: "对照最新内容" }));
      const dialog = await screen.findByRole("dialog", { name: "对照保存内容" });
      expect(within(dialog).queryByRole("button", { name: "应用并继续编辑" })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "最新内容" })).toBeEnabled());
      fireEvent.click(within(dialog).getByRole("button", { name: "最新内容" }));
      expect(within(dialog).getByText("最新报告")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "返回编辑" }));
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("保留未确认的草稿");
      expect(updateReport).toHaveBeenCalledTimes(2);
    } finally { cleanup(); restoreDialog(); }
  });

  it("keeps edits made while an earlier save is still in flight", async () => {
    const firstSave = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(firstSave.promise);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));

    const title = screen.getByRole("textbox", { name: "报告标题" });
    fireEvent.change(title, { target: { value: "第一版标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));

    fireEvent.change(title, { target: { value: "第二版标题" } });
    await act(async () => {
      firstSave.resolve({
        ...structuredClone(report),
        title: "第一版标题",
        version: 2,
        updated_at: "2026-07-19T03:00:00Z",
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(title).toHaveValue("第二版标题"));
    expect(screen.getByText("有尚未保存的修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
    expect(updateReport.mock.calls[1][2]).toMatchObject({
      expected_version: 2,
      title: "第二版标题",
    });
  });

  it("reports unsaved and saving states to the desktop close bridge without writing during inspection", async () => {
    let prepare!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
    vi.stubGlobal("electronAPI", { onPrepareClose: (callback: typeof prepare) => { prepare = callback; return () => undefined; } });
    const pending = deferred<ReportDocument>();
    updateReport.mockReturnValueOnce(pending.promise);
    const unsubscribe = subscribeToDesktopClose()!;
    try {
      render(<NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      expect(await prepare("inspect")).toBe("clean");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "关闭前保存" } });
      expect(await prepare("inspect")).toBe("dirty");
      expect(updateReport).not.toHaveBeenCalled();
      let saved!: Promise<DesktopCloseState>;
      act(() => { saved = prepare("save"); });
      expect(await prepare("inspect")).toBe("busy");
      await act(async () => {
        pending.resolve({ ...structuredClone(report), title: "关闭前保存", version: 2 });
        expect(await saved).toBe("clean");
      });
      expect(updateReport).toHaveBeenCalledOnce();
      expect(await prepare("inspect")).toBe("clean");
    } finally { unsubscribe(); vi.unstubAllGlobals(); }
  });

  it("applies a configured filter to the current page table", async () => {
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [
        {
          ...structuredClone(report.pages[0]),
          blocks: [
            {
              id: "filter-1",
              block_type: "filter",
              title: "地区筛选",
              order_index: 0,
              source_kind: "manual",
              content: {},
              config: { field: "地区", operator: "equals", placeholder: "输入地区" },
              layout: { x: 0, y: 0, w: 4, h: 2 },
            },
            {
              id: "table-1",
              block_type: "table",
              title: "门店明细",
              order_index: 1,
              source_kind: "artifact",
              content: {
                rows: [
                  { 地区: "华东", 门店: "上海" },
                  { 地区: "华南", 门店: "深圳" },
                ],
              },
              config: {},
              layout: { x: 4, y: 0, w: 8, h: 4 },
            },
          ],
        },
      ],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    expect(await screen.findByText("深圳")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /地区筛选/ }), {
      target: { value: "华东" },
    });
    expect(screen.getByText("上海")).toBeInTheDocument();
    expect(screen.queryByText("深圳")).not.toBeInTheDocument();
    expect(screen.getByText(/筛选后 1 行/)).toBeInTheDocument();
  });

  it("paginates retained table rows instead of silently cutting them off", async () => {
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [
        {
          ...structuredClone(report.pages[0]),
          blocks: [
            {
              id: "table-many",
              block_type: "table",
              title: "全部明细",
              order_index: 0,
              source_kind: "artifact",
              content: { rows: Array.from({ length: 60 }, (_, index) => ({ 行号: `行 ${index + 1}` })) },
              config: {},
              layout: { x: 0, y: 0, w: 12, h: 6 },
            },
          ],
        },
      ],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    expect(await screen.findByText(/共 60 行 · 当前 1–50/)).toBeInTheDocument();
    expect(screen.queryByText("行 60")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页明细" }));
    expect(screen.getByText("行 60")).toBeInTheDocument();
    expect(screen.getByText(/当前 51–60/)).toBeInTheDocument();
  });

  it("paginates table rows in edit mode without opening the block settings", async () => {
    getReport.mockResolvedValue({
      ...structuredClone(report),
      pages: [
        {
          ...structuredClone(report.pages[0]),
          blocks: [
            {
              id: "table-many-editing",
              block_type: "table",
              title: "全部明细",
              order_index: 0,
              source_kind: "artifact",
              content: {
                rows: Array.from({ length: 60 }, (_, index) => ({
                  行号: `行 ${index + 1}`,
                })),
              },
              config: {},
              layout: { x: 0, y: 0, w: 12, h: 6 },
            },
          ],
        },
      ],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );

    await screen.findByText(/共 60 行 · 当前 1–50/);
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页明细" }));

    expect(screen.getByText("行 60")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "区块设置" })).not.toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("report outline locates another page's block and preserves the document through scope changes", async () => {
    mockViewportWidth(1600);
    const document = structuredClone(report);
    document.pages.push({ ...structuredClone(report.pages[0]), id: "page-2", title: "渠道表现", order_index: 1,
      blocks: [{ ...structuredClone(report.pages[0].blocks[0]), id: "block-2", title: "渠道明细内容" }] });
    getReport.mockResolvedValue(document);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索页面或内容…" }), { target: { value: "明细内容" } });
    fireEvent.click(screen.getByRole("button", { name: "渠道明细内容" }));
    expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue("page-2");
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("渠道明细内容");
    fireEvent.change(screen.getByRole("textbox", { name: "区块标题" }), { target: { value: "保留的修改" } });
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    expect(screen.getByRole("textbox", { name: "页面名称" })).toHaveValue("渠道表现");
    fireEvent.click(screen.getByRole("tab", { name: "内容" }));
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("保留的修改");
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("report content search locates prose on another page without editing or saving and restores focus after closing", async () => {
    const prepared = structuredClone(report);
    prepared.pages.push({ ...structuredClone(report.pages[0]), id: "page-2", title: "费用复盘", order_index: 1,
      blocks: [{ ...structuredClone(report.pages[0].blocks[0]), id: "block-2", title: "门店观察", content: { text: "配送费用上升，需要复盘" } }] });
    getReport.mockResolvedValue(prepared);
    const checkpoint = vi.spyOn(reportRecovery.ReportRecoveryJournal.prototype, "checkpoint");
    const { container } = render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长"); checkpoint.mockClear();
    const find = screen.getByRole("button", { name: "查找报告内容" }); find.focus(); fireEvent.click(find);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索标题、正文或指标…" }), { target: { value: "配送费用" } });
    fireEvent.click(screen.getByRole("button", { name: "前往第 2 页：门店观察" }));
    await waitFor(() => expect(container.querySelector('[data-report-block="block-2"]')).toHaveFocus());
    expect(screen.getByRole("button", { name: "阅读报告" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue("page-2");
    expect(checkpoint).not.toHaveBeenCalled(); expect(updateReport).not.toHaveBeenCalled(); expect(getReport).toHaveBeenCalledOnce();
    find.focus(); fireEvent.click(find);
    expect(screen.getByRole("searchbox", { name: "搜索标题、正文或指标…" })).toHaveValue("配送费用");
    fireEvent.click(screen.getByRole("button", { name: "关闭查找" })); expect(find).toHaveFocus();
    fireEvent.click(find); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "概览" } });
    fireEvent.click(screen.getByRole("button", { name: "前往第 1 页：概览" }));
    await waitFor(() => expect(container.querySelector('[data-report-page-heading="page-1"]')).toHaveFocus());
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("report content search includes unsaved edits without adding undo steps or stealing save shortcuts", async () => {
    mockViewportWidth(1600);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "本月结论" }));
    const title = screen.getByRole("textbox", { name: "区块标题" });
    fireEvent.change(title, { target: { value: "尚未保存的配送观察" } });
    fireEvent.click(screen.getByRole("button", { name: "查找报告内容" }));
    const input = screen.getByRole("searchbox", { name: "搜索标题、正文或指标…" });
    fireEvent.change(input, { target: { value: "尚未保存" } });
    fireEvent.keyDown(input, { key: "s", ctrlKey: true }); fireEvent.keyDown(input, { key: "p", ctrlKey: true });
    expect(updateReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "前往第 1 页：尚未保存的配送观察" }));
    expect(screen.getByRole("button", { name: "编辑报告" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("尚未保存的配送观察");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("本月结论");
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled(); expect(updateReport).not.toHaveBeenCalled();
  });

  it("report outline reorders pages through the existing undo history without saving", async () => {
    mockViewportWidth(1600);
    const document = structuredClone(report);
    document.pages.push({ ...structuredClone(report.pages[0]), id: "page-2", title: "渠道表现", order_index: 1, blocks: [] });
    getReport.mockResolvedValue(document);
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "页面操作：概览" }));
    fireEvent.click(screen.getByRole("button", { name: "向后移动页面：概览" }));
    const navigator = screen.getByRole("combobox", { name: "选择报告页面" });
    expect(within(navigator).getAllByRole("option")[0]).toHaveValue("page-2");
    expect(navigator).toHaveValue("page-1");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(within(navigator).getAllByRole("option")[0]).toHaveValue("page-1");
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("report card move searches pages, supports keyboard selection, and retains identity through save and undo", async () => {
    const restoreDialog = mockRecoveryDialog();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      mockViewportWidth(1600);
      const source = structuredClone(report);
      source.pages.push({ id: "page-2", title: "明细", order_index: 1, config: {}, blocks: [] });
      getReport.mockResolvedValue(source);
      updateReport.mockImplementation(async (_project, _report, payload) => ({ ...source, ...payload, version: payload.expected_version + 1 }));
      render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
      await screen.findByText("收入稳步增长");
      fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
      fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), { target: { value: "正在整理的报告" } });
      fireEvent.click(screen.getByRole("button", { name: messages.reportWorkspace.expandSettings }));
      const trigger = screen.getAllByRole("button", { name: "区块操作" })[0];
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("menuitem", { name: "移动到页面…" }));
      let dialog = screen.getByRole("dialog", { name: "移动到页面" });
      expect(within(dialog).queryByRole("button", { name: "移到概览" })).not.toBeInTheDocument();
      let search = within(dialog).getByRole("searchbox");
      expect(search).toHaveFocus();
      fireEvent.keyDown(search, { key: "s", metaKey: true });
      fireEvent.keyDown(search, { key: "p", ctrlKey: true });
      fireEvent.keyDown(search, { key: "z", metaKey: true });
      expect(updateReport).not.toHaveBeenCalled(); expect(print).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("正在整理的报告");
      fireEvent.keyDown(search, { key: "Escape", isComposing: true });
      expect(dialog).toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Escape" });
      await act(async () => {
        const cancel = new Event("cancel", { cancelable: true });
        dialog.dispatchEvent(cancel);
        if (!cancel.defaultPrevented) (dialog as HTMLDialogElement).close();
      });
      expect(screen.queryByRole("dialog", { name: "移动到页面" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("menuitem", { name: "移动到页面…" }));
      dialog = screen.getByRole("dialog", { name: "移动到页面" });
      search = within(dialog).getByRole("searchbox");
      fireEvent.change(search, { target: { value: "无匹配" } });
      expect(within(dialog).getByText("没有匹配的页面")).toBeInTheDocument();
      fireEvent.change(search, { target: { value: "明细" } });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      const destination = within(dialog).getByRole("button", { name: "移到明细" });
      expect(destination).toHaveFocus();
      expect(Array.from(dialog.querySelectorAll(":is(button, input):not([disabled])")).map((element) => element.getAttribute("aria-label")))
        .toEqual(["取消移动", "搜索目标页…", messages.reportMove.clearSearch, "移到明细"]);
      fireEvent.keyDown(destination, { key: "Tab" });
      const close = within(dialog).getByRole("button", { name: "取消移动" });
      expect(close).toHaveFocus();
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(destination).toHaveFocus();
      fireEvent.click(destination);
      expect(screen.queryByRole("dialog", { name: "移动到页面" })).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue("page-2");
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
      const sent = updateReport.mock.calls[0][2];
      expect(sent.pages[1].blocks[0].id).toBe(source.pages[0].blocks[0].id);
      expect(sent.pages[0].blocks).toHaveLength(source.pages[0].blocks.length - 1);
      await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue(source.pages[0].id);
      expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue(source.pages[0].blocks[0].title);
      fireEvent.click(screen.getByRole("button", { name: "重做" }));
      expect(screen.getByRole("combobox", { name: "选择报告页面" })).toHaveValue("page-2");
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(2));
      expect(updateReport.mock.calls[1][2].pages[0].blocks[0].id).toBe(source.pages[0].blocks[0].id);
      expect(updateReport.mock.calls[1][2].pages[1].blocks).toHaveLength(0);
    } finally { restoreDialog(); }
  });

  it("report page copy selects the new page and supports undo, redo and normal saving", async () => {
    mockViewportWidth(1600);
    getReport.mockResolvedValue(structuredClone(report));
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportWorkspace projectId="project-1" reportId="report-1" /></NextIntlClientProvider>);
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "页面操作：概览" }));
    fireEvent.click(screen.getByRole("button", { name: "复制页面：概览" }));
    const navigator = screen.getByRole("combobox", { name: "选择报告页面" });
    const copyId = (navigator as HTMLSelectElement).value;
    expect(copyId).toMatch(/^local-page-/);
    expect(within(navigator).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "概览 副本" })).toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(within(navigator).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(within(navigator).getAllByRole("option")).toHaveLength(2);
    expect(navigator).toHaveValue(copyId);
    expect(screen.getByRole("heading", { name: "概览 副本" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledOnce());
    const pages = updateReport.mock.calls[0][2].pages;
    expect(pages[1].id).toBe(copyId);
    expect(pages[1].blocks[0].id).not.toBe(pages[0].blocks[0].id);
    expect(pages[1].blocks[0].content).toEqual(pages[0].blocks[0].content);
  });

  it("keeps compact editor drawers mutually exclusive and out of document flow", async () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));

    fireEvent.click(screen.getByRole("button", { name: "展开页面目录" }));
    const outline = screen.getByRole("heading", { name: "页面与区块" }).closest("aside");
    expect(outline).toHaveClass("absolute", "xl:relative");
    expect(screen.getByRole("button", { name: "关闭页面目录" })).toHaveClass("xl:hidden");

    fireEvent.click(screen.getByRole("button", { name: "展开设置" }));
    expect(screen.queryByRole("heading", { name: "页面与区块" })).not.toBeInTheDocument();
    const properties = screen.getByRole("heading", { name: "页面设置" }).closest("aside")
      ?.parentElement;
    expect(properties).toHaveClass("absolute", "2xl:relative");
    expect(screen.getByRole("button", { name: "关闭区块设置" })).toHaveClass(
      "2xl:hidden"
    );
  });

  it("does not put the 300px property panel in flow at the 1399px resize case", async () => {
    mockViewportWidth(1399);
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));

    expect(screen.getByRole("heading", { name: "页面与区块" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "页面设置" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开设置" }));
    const properties = screen.getByRole("heading", { name: "页面设置" }).closest("aside")
      ?.parentElement;
    expect(properties).toHaveClass("absolute", "2xl:relative");
    expect(properties).not.toHaveClass("xl:relative");
  });

  it("ignores a stale artifact response after switching investigations", async () => {
    const runA = {
      id: "run-a",
      project_id: "project-1",
      query: "调查 A 问题",
      state: "completed" as const,
      stage: "completed",
      report: { title: "调查 A", summary: "A 摘要" },
      checkpoint: {},
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    const runB = {
      ...runA,
      id: "run-b",
      query: "调查 B 问题",
      report: { title: "调查 B", summary: "B 摘要" },
    };
    const artifactsA = deferred<Awaited<ReturnType<typeof listRunArtifacts>> >();
    const artifactsB = deferred<Awaited<ReturnType<typeof listRunArtifacts>> >();
    listReportAnalysisRuns.mockResolvedValue(historyPage([runA, runB]));
    listRunArtifacts.mockImplementation((_projectId, runId) =>
      runId === "run-a" ? artifactsA.promise : artifactsB.promise
    );

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(screen.getByRole("button", { name: "添加内容" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /从调查手动挑选/ }));
    fireEvent.click(await screen.findByRole("button", { name: /调查 A/ }));
    fireEvent.click(await screen.findByRole("button", { name: /调查 B/ }));

    await act(async () => {
      artifactsB.resolve([
        {
          id: "artifact-b",
          project_id: "project-1",
          analysis_run_id: "run-b",
          kind: "metric",
          title: "B 指标",
          payload: { value: 20 },
          technical_details: {},
          created_at: "2026-07-19T01:00:00Z",
          updated_at: "2026-07-19T01:00:00Z",
        },
      ]);
      await artifactsB.promise;
    });
    expect(await screen.findByText("B 指标")).toBeInTheDocument();

    await act(async () => {
      artifactsA.resolve([
        {
          id: "artifact-a",
          project_id: "project-1",
          analysis_run_id: "run-a",
          kind: "metric",
          title: "A 指标（过期响应）",
          payload: { value: 10 },
          technical_details: {},
          created_at: "2026-07-19T01:00:00Z",
          updated_at: "2026-07-19T01:00:00Z",
        },
      ]);
      await artifactsA.promise;
    });
    expect(screen.getByText("B 指标")).toBeInTheDocument();
    expect(screen.queryByText("A 指标（过期响应）")).not.toBeInTheDocument();
  });

  it("appends a complete editable draft without replacing existing pages", async () => {
    const run: AnalysisRunSummary = {
      id: "run-draft",
      project_id: "project-1",
      query: "整理月度经营情况",
      state: "completed",
      stage: "completed",
      report: { title: "月度经营报告", summary: "收入增长，回款保持稳定。" },
      checkpoint: {},
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    const artifacts: AnalysisArtifact[] = [
      {
        id: "metric-draft",
        project_id: "project-1",
        analysis_run_id: run.id,
        kind: "metric",
        title: "本月收入",
        payload: { value: "128 万元" },
        technical_details: {},
        created_at: run.created_at,
        updated_at: run.updated_at,
      },
      {
        id: "table-draft",
        project_id: "project-1",
        analysis_run_id: run.id,
        kind: "table",
        title: "区域明细",
        payload: { rows: [{ 地区: "华东", 收入: 80 }] },
        technical_details: {},
        created_at: run.created_at,
        updated_at: run.updated_at,
      },
      {
        id: "evidence-draft",
        project_id: "project-1",
        analysis_run_id: run.id,
        kind: "evidence",
        title: "核对依据",
        payload: { checks: ["收入汇总已核对"] },
        technical_details: {},
        created_at: run.created_at,
        updated_at: run.updated_at,
      },
    ];
    listReportAnalysisRuns.mockResolvedValue(historyPage([run]));
    listRunArtifacts.mockResolvedValue(artifacts);
    requestReportDraftPlan.mockResolvedValue({
      title: "月度经营报告（智能整理）",
      description: "围绕经营结果、区域明细和核对依据组织。",
      overview_text: "本月收入增长，回款保持稳定。",
      sections: [
        {
          role: "overview",
          title: "管理层摘要",
          purpose: "先看本月最重要的经营结论",
          narrative: "收入保持增长，建议继续关注回款质量。",
          artifact_ids: ["metric-draft"],
        },
        {
          role: "detail",
          title: "区域经营明细",
          purpose: "下钻不同区域的经营表现",
          narrative: null,
          artifact_ids: ["table-draft"],
        },
        {
          role: "evidence",
          title: "核对与依据",
          purpose: "保留报告判断的可追溯依据",
          narrative: null,
          artifact_ids: ["evidence-draft"],
        },
      ],
      selected_overview: ["metric-draft"],
      selected_detail: ["table-draft"],
      selected_evidence: ["evidence-draft"],
      highlights: { "metric-draft": "较上月增长 8%，是本月最重要的变化。" },
      generated_by: "ai",
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(reportAction("智能整理"));
    fireEvent.click(await screen.findByRole("button", { name: /月度经营报告/ }));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));
    expect(await screen.findByText("月度经营报告（智能整理）")).toBeInTheDocument();
    expect(screen.getByText("管理层摘要")).toBeInTheDocument();
    expect(screen.getByText("区域经营明细")).toBeInTheDocument();
    expect(screen.getByText("核对与依据")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("经营概览");

    fireEvent.click(screen.getByRole("button", { name: "应用到报告" }));

    expect(screen.getAllByText("结论摘要")).toHaveLength(2);
    expect(screen.getAllByText("本月收入")).toHaveLength(2);
    expect(screen.getByText("较上月增长 8%，是本月最重要的变化。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));

    const savedPages = updateReport.mock.calls[0][2].pages;
    expect(savedPages.map((page: { title: string }) => page.title)).toEqual([
      "概览",
      "管理层摘要",
      "区域经营明细",
      "核对与依据",
    ]);
    expect(savedPages[0].blocks[0].content.text).toBe("收入稳步增长");
    expect(
      savedPages.flatMap((page: { blocks: Array<{ artifact_id?: string }> }) => page.blocks)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact_id: "metric-draft",
          layout: expect.objectContaining({ h: 2, w: 6 }),
        }),
        expect.objectContaining({ artifact_id: "table-draft" }),
        expect.objectContaining({ artifact_id: "evidence-draft" }),
      ])
    );
  });

  it("keeps the report untouched when smart planning is unavailable", async () => {
    const run: AnalysisRunSummary = {
      id: "run-unavailable",
      project_id: "project-1",
      query: "整理经营数据",
      state: "completed",
      stage: "completed",
      report: { title: "待整理调查", summary: "这是一份待整理的调查。" },
      checkpoint: {},
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    listReportAnalysisRuns.mockResolvedValue(historyPage([run]));
    listRunArtifacts.mockResolvedValue([]);
    requestReportDraftPlan.mockRejectedValue(new ReportDraftUnavailableError());

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(reportAction("智能整理"));
    fireEvent.click(await screen.findByRole("button", { name: /待整理调查/ }));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));

    expect(
      await screen.findByText(
        "智能整理暂时不可用，报告没有被修改。你可以重试，或切换到手动添加。"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("经营概览");
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("ignores a smart plan that finishes after the composer is closed", async () => {
    const run: AnalysisRunSummary = {
      id: "run-stale-plan",
      project_id: "project-1",
      query: "整理经营数据",
      state: "completed",
      stage: "completed",
      report: { title: "延迟调查", summary: "等待整理的调查。" },
      checkpoint: {},
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    const pendingPlan = deferred<ReportDraftPlan>();
    listReportAnalysisRuns.mockResolvedValue(historyPage([run]));
    listRunArtifacts.mockResolvedValue([]);
    requestReportDraftPlan.mockReturnValue(pendingPlan.promise);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.click(reportAction("智能整理"));
    fireEvent.click(await screen.findByRole("button", { name: /延迟调查/ }));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));
    await waitFor(() => expect(requestReportDraftPlan).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await act(async () => {
      pendingPlan.resolve({
        title: "不应出现的报告",
        description: "过期响应",
        overview_text: "过期响应",
        sections: [
          {
            role: "overview",
            title: "不应出现的页面",
            purpose: "过期响应",
            narrative: "过期响应",
            artifact_ids: [],
          },
          {
            role: "detail",
            title: "不应出现的明细",
            purpose: "过期响应",
            narrative: null,
            artifact_ids: [],
          },
        ],
        selected_overview: [],
        selected_detail: [],
        selected_evidence: [],
        highlights: {},
        generated_by: "ai",
      });
      await pendingPlan.promise;
    });

    expect(screen.queryByText("不应出现的报告")).not.toBeInTheDocument();
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("preserves a user-named empty page when applying a smart draft", async () => {
    const customEmptyReport: ReportDocument = {
      ...structuredClone(report),
      title: "我的空白周报",
      description: "",
      pages: [
        {
          ...structuredClone(report.pages[0]),
          title: "本周观察",
          blocks: [],
        },
      ],
    };
    const run: AnalysisRunSummary = {
      id: "run-preserve-empty",
      project_id: "project-1",
      query: "整理本周经营",
      state: "completed",
      stage: "completed",
      report: { title: "本周经营调查", summary: "本周经营稳定。" },
      checkpoint: {},
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
    };
    getReport.mockResolvedValue(customEmptyReport);
    listReportAnalysisRuns.mockResolvedValue(historyPage([run]));
    listRunArtifacts.mockResolvedValue([]);
    requestReportDraftPlan.mockResolvedValue({
      title: "智能标题",
      description: "智能说明",
      overview_text: "本周经营稳定。",
      sections: [
        {
          role: "overview",
          title: "经营摘要",
          purpose: "先看结论",
          narrative: "本周经营稳定。",
          artifact_ids: [],
        },
        {
          role: "detail",
          title: "后续观察",
          purpose: "保留后续观察项",
          narrative: "继续观察趋势。",
          artifact_ids: [],
        },
      ],
      selected_overview: [],
      selected_detail: [],
      selected_evidence: [],
      highlights: {},
      generated_by: "ai",
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("这个页面还是空的");
    fireEvent.click(reportAction("智能整理"));
    fireEvent.click(await screen.findByRole("button", { name: /本周经营调查/ }));
    fireEvent.click(await screen.findByRole("button", { name: "生成初稿" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用到报告" }));
    expect(screen.getByRole("textbox", { name: "报告标题" })).toHaveValue("我的空白周报");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateReport).toHaveBeenCalledTimes(1));
    expect(updateReport.mock.calls[0][2].pages.map((page: ReportDocument["pages"][number]) => page.title)).toEqual([
      "本周观察",
      "经营摘要",
      "后续观察",
    ]);
  });

  it("saves current edits before exporting Excel", async () => {
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportWorkspace projectId="project-1" reportId="report-1" />
      </NextIntlClientProvider>
    );
    await screen.findByText("收入稳步增长");
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "报告标题" }), {
      target: { value: "最新经营报告" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 Excel" }));

    await waitFor(() => expect(exportReportExcel).toHaveBeenCalledWith("project-1", "report-1"));
    expect(updateReport).toHaveBeenCalledTimes(1);
    expect(updateReport.mock.invocationCallOrder[0]).toBeLessThan(
      exportReportExcel.mock.invocationCallOrder[0]
    );
    expect(updateReport.mock.calls[0][2].title).toBe("最新经营报告");
    downloadClick.mockRestore();
  });
});

describe("refreshReportBlock", () => {
  it("posts page refresh with its own version and translates definitive whole-page rejection", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { data: structuredClone(report) } });
    const actual = await vi.importActual<typeof import("@/lib/reports")>("@/lib/reports");
    const copy = { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" };
    await actual.refreshReportPage("p", "r", "page", 7, copy);
    expect(post).toHaveBeenCalledWith("/api/v1/projects/p/reports/r/pages/page/refresh", { expected_version: 7 }, { timeout: 150000 });
    post.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: "report_refresh_failed" } } } });
    await expect(actual.refreshReportPage("p", "r", "page", 7, copy)).rejects.toMatchObject({ name: "ReportRefreshError", code: "report_refresh_failed" });
    post.mockRestore();
  });

  it("maps only known source-boundary codes and leaves untrusted detail out of the UI", async () => {
    const post = vi.spyOn(api, "post");
    const actual = await vi.importActual<typeof import("@/lib/reports")>("@/lib/reports");
    const copy = { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" };
    for (const code of Object.keys(actual.REPORT_REFRESH_ERROR_KEYS)) {
      post.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code, path: "/private/file", hash: "secret" } } } });
      await expect(actual.refreshReportBlock("p", "r", "page", "block", 1, copy)).rejects.toMatchObject({ name: "ReportRefreshError", code });
    }
    post.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: "constructor", path: "/private/file" } } } });
    await expect(actual.refreshReportBlock("p", "r", "page", "block", 1, copy)).rejects.toBeInstanceOf(actual.ReportConflictError);
    post.mockRestore();
  });

  it("posts the expected block version to the refresh endpoint", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { data: structuredClone(report) },
    });
    const actualReports =
      await vi.importActual<typeof import("@/lib/reports")>("@/lib/reports");

    await actualReports.refreshReportBlock(
      "project-1",
      "report-1",
      "page-1",
      "block-1",
      9,
      {
        unnamedBlock: "未命名区块",
        textBlock: "文字",
        unnamedPage: "未命名页面",
        unnamedReport: "未命名报告",
      }
    );

    expect(post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/reports/report-1/pages/page-1/blocks/block-1/refresh",
      { expected_version: 9 },
      { timeout: 150000 }
    );
    post.mockRestore();
  });
});

describe("createInvestigationReportDraft", () => {
  it("balances one to four consecutive financial metrics across the row", () => {
    const metricBlocks = Array.from({ length: 4 }, (_, index) => ({
      id: `metric-${index}`,
      block_type: "metric" as const,
      title: `指标 ${index + 1}`,
      order_index: index,
      source_kind: "artifact" as const,
      analysis_run_id: "run-1",
      artifact_id: `artifact-${index}`,
      content: { value: index + 1 },
      config: {},
      layout: { x: 0, y: 0, w: 3, h: 2 },
    }));

    expect(balanceMetricWidths(metricBlocks.slice(0, 1))[0].layout.w).toBe(6);
    expect(balanceMetricWidths(metricBlocks.slice(0, 2)).map((block) => block.layout.w)).toEqual([6, 6]);
    expect(balanceMetricWidths(metricBlocks.slice(0, 3)).map((block) => block.layout.w)).toEqual([4, 4, 4]);
    expect(balanceMetricWidths(metricBlocks).map((block) => block.layout.w)).toEqual([3, 3, 3, 3]);
  });

  const run: AnalysisRunSummary = {
    id: "run-compose",
    project_id: "project-1",
    query: "分析本月经营",
    state: "completed",
    stage: "completed",
    report: { title: "本月经营", summary: "经营表现稳定。" },
    checkpoint: {},
    created_at: "2026-07-19T01:00:00Z",
    updated_at: "2026-07-19T02:00:00Z",
  };

  const artifact = (
    id: string,
    kind: AnalysisArtifact["kind"],
    title: string,
    payload: Record<string, unknown>
  ): AnalysisArtifact => ({
    id,
    project_id: "project-1",
    analysis_run_id: run.id,
    kind,
    title,
    payload,
    technical_details: {},
    created_at: run.created_at,
    updated_at: run.updated_at,
  });

  it("builds overview, details and evidence from one investigation", () => {
    const draft = createInvestigationReportDraft(run, [
      artifact("report-copy", "report", "重复摘要", { text: "不应重复导入" }),
      artifact("metric-1", "metric", "收入", { value: 128 }),
      artifact("chart-1", "chart", "收入趋势", {
        chart: {
          type: "line",
          title: "收入趋势",
          data: [{ 月份: "七月", 收入: 128 }],
          xKey: "月份",
          yKeys: ["收入"],
        },
      }),
      artifact("table-1", "table", "区域明细", {
        rows: [{ 地区: "华东", 收入: 80 }],
      }),
      artifact("evidence-1", "evidence", "核对依据", {
        checks: ["汇总结果已核对"],
      }),
      artifact("empty-evidence", "file", "内部附件", {}),
    ], reportDraftCopy);

    expect(draft.title).toBe("本月经营");
    expect(draft.pages.map((page) => page.title)).toEqual(["概览", "明细", "依据"]);
    expect(draft.pages[0].blocks.map((block) => block.title)).toEqual([
      "结论摘要",
      "收入",
      "收入趋势",
    ]);
    expect(draft.pages[1].blocks).toEqual([
      expect.objectContaining({ artifact_id: "table-1", block_type: "table" }),
    ]);
    expect(draft.pages[2].blocks).toEqual([
      expect.objectContaining({ artifact_id: "evidence-1", block_type: "evidence" }),
    ]);
    expect(draft.pages.flatMap((page) => page.blocks).some((block) => block.title === "重复摘要")).toBe(false);
    expect(draft.pages.flatMap((page) => page.blocks).some((block) => block.artifact_id === "empty-evidence")).toBe(false);
  });

  it("omits empty detail and evidence pages", () => {
    const draft = createInvestigationReportDraft(run, [
      artifact("metric-only", "metric", "收入", { value: 128 }),
    ], reportDraftCopy);
    expect(draft.pages.map((page) => page.title)).toEqual(["概览"]);
  });

  it("handles reserved artifact identifiers without inventing or dropping highlights", () => {
    const artifacts = ["toString", "constructor", "__proto__"].map(id => artifact(id, "metric", id, { value: 1 }));
    const highlights = JSON.parse('{"unrelated":"present","__proto__":"  保留此标注  "}') as Record<string, string>;
    const draft = createInvestigationReportDraftFromPlan(run, artifacts, {
      title: "边界报告", description: "", overview_text: "", highlights, generated_by: "ai",
      selected_overview: artifacts.map(item => item.id), selected_detail: [], selected_evidence: [],
    }, reportDraftCopy);
    const blocks = draft.pages.flatMap(page => page.blocks);
    expect(blocks.find(block => block.artifact_id === "toString")?.config.highlight).toBeUndefined();
    expect(blocks.find(block => block.artifact_id === "constructor")?.config.highlight).toBeUndefined();
    expect(blocks.find(block => block.artifact_id === "__proto__")?.config.highlight).toBe("保留此标注");
    expect(highlights.__proto__).toBe("  保留此标注  ");
  });

  it("respects structured narrative-only sections and places the summary in overview", () => {
    const draft = createInvestigationReportDraftFromPlan(
      run,
      [
        artifact("metric-unselected", "metric", "不应自动补入的指标", { value: 999 }),
        artifact("table-selected", "table", "区域明细", {
          rows: [{ 地区: "华东", 收入: 80 }],
        }),
      ],
      {
        title: "按业务主题整理",
        description: "先看明细，再回到经营判断。",
        overview_text: "经营表现稳定。",
        sections: [
          {
            role: "detail",
            title: "区域下钻",
            purpose: "先展示区域明细",
            narrative: "以下是区域层面的表现。",
            artifact_ids: ["table-selected"],
          },
          {
            role: "overview",
            title: "经营判断",
            purpose: "汇总经营判断",
            narrative: "经营表现稳定。",
            artifact_ids: [],
          },
          {
            role: "evidence",
            title: "后续核对",
            purpose: "记录后续核对方向",
            narrative: "下周继续核对回款变化。",
            artifact_ids: [],
          },
        ],
        selected_overview: [],
        selected_detail: ["table-selected"],
        selected_evidence: [],
        highlights: {},
        generated_by: "ai",
      },
      reportDraftCopy
    );

    expect(draft.pages.map((page) => page.title)).toEqual([
      "区域下钻",
      "经营判断",
      "后续核对",
    ]);
    expect(draft.pages[0].blocks.map((block) => block.title)).toEqual(["区域明细"]);
    expect(draft.pages[1].blocks.map((block) => block.title)).toEqual(["结论摘要"]);
    expect(draft.pages[2].blocks).toEqual([]);
    expect(draft.pages.map((page) => page.config.narrative)).toEqual([
      "以下是区域层面的表现。",
      "经营表现稳定。",
      "下周继续核对回款变化。",
    ]);
    expect(
      draft.pages
        .flatMap((page) => page.blocks)
        .some((block) => block.title === "不应自动补入的指标")
    ).toBe(false);
    expect(
      draft.pages
        .flatMap((page) => page.blocks)
        .some((block) => block.config.kind === "ai_narrative")
    ).toBe(false);
  });

  it("keeps one available detail table when a smart financial plan omits every table", () => {
    const draft = createInvestigationReportDraftFromPlan(
      run,
      [
        artifact("metric-selected", "metric", "销售额", { value: 128 }),
        artifact("table-available", "table", "订单明细", {
          rows: [{ 订单号: "A-1", 金额: 128 }],
        }),
      ],
      {
        title: "经营账单",
        description: "本月经营结果",
        overview_text: "经营稳定。",
        sections: [
          {
            role: "overview",
            title: "经营概览",
            purpose: "先看指标",
            narrative: "经营稳定。",
            artifact_ids: ["metric-selected"],
          },
          {
            role: "evidence",
            title: "订单明细与依据",
            purpose: "核对订单",
            narrative: null,
            artifact_ids: [],
          },
        ],
        selected_overview: ["metric-selected"],
        selected_detail: [],
        selected_evidence: [],
        highlights: {},
        generated_by: "ai",
      },
      reportDraftCopy
    );

    expect(draft.pages[1].blocks).toEqual([
      expect.objectContaining({ artifact_id: "table-available", block_type: "table" }),
    ]);
  });
});

describe("ReportPropertyPanel chart presentation", () => {
  it("emits only approved presentation values without offering frontend aggregation", () => {
    const chartBlock = {
      id: "chart-properties",
      block_type: "chart" as const,
      title: "收入趋势",
      order_index: 0,
      source_kind: "artifact" as const,
      analysis_run_id: "run-1",
      artifact_id: "artifact-1",
      content: {
        rows: [
          { 月份: "六月", 收入: 100, 利润: 20 },
          { 月份: "七月", 收入: 128, 利润: 28 },
        ],
      },
      config: {
        chart_type: "bar",
        x_key: "月份",
        y_key: "收入",
        y_keys: ["收入", "利润"],
      },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const onChangeBlock = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPropertyPanel
          page={{ ...structuredClone(report.pages[0]), blocks: [chartBlock] }}
          block={chartBlock}
          onChangePage={vi.fn()}
          onChangeBlock={onChangeBlock}
        />
      </NextIntlClientProvider>
    );

    fireEvent.change(screen.getByLabelText("图表方向"), {
      target: { value: "horizontal" },
    });
    fireEvent.change(screen.getByLabelText("图表堆叠"), {
      target: { value: "percent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "显示与格式" }));
    fireEvent.change(screen.getByLabelText("图表数值格式"), {
      target: { value: "compact" },
    });
    fireEvent.change(screen.getByLabelText("图表配色方案"), {
      target: { value: "categorical" },
    });
    fireEvent.click(screen.getByLabelText("显示数据标签"));
    expect(screen.getByLabelText("收入数值格式")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("收入显示名称"), {
      target: { value: "销售收入" },
    });
    fireEvent.change(screen.getByLabelText("利润数值格式"), {
      target: { value: "currency" },
    });

    for (const expected of [
      { orientation: "horizontal" },
      { stack: "percent" },
      { number_format: "compact" },
      { palette: "categorical" },
      { show_labels: true },
      { series_labels: { 收入: "销售收入" } },
      { series_formats: { 利润: "currency" } },
    ]) {
      expect(onChangeBlock).toHaveBeenCalledWith({
        config: expect.objectContaining(expected),
      });
    }
    expect(screen.queryByLabelText(/聚合/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "区块数据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多显示设置" })).not.toBeInTheDocument();
  });

  it("clips series and clears stacking when switching to pie or scatter", () => {
    const chartBlock = {
      id: "chart-switch-single",
      block_type: "chart" as const,
      title: "收入与利润",
      order_index: 0,
      source_kind: "artifact" as const,
      content: {
        rows: [
          { 月份: "六月", 收入: 100, 利润: 20 },
          { 月份: "七月", 收入: 128, 利润: 28 },
        ],
      },
      config: {
        chart_type: "bar",
        x_key: "月份",
        y_key: "收入",
        y_keys: ["收入", "利润"],
        orientation: "horizontal",
        stack: "percent",
      },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const onChangeBlock = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPropertyPanel
          page={{ ...structuredClone(report.pages[0]), blocks: [chartBlock] }}
          block={chartBlock}
          onChangePage={vi.fn()}
          onChangeBlock={onChangeBlock}
        />
      </NextIntlClientProvider>
    );

    fireEvent.change(screen.getByLabelText("图表样式"), {
      target: { value: "pie" },
    });

    expect(onChangeBlock).toHaveBeenLastCalledWith({
      config: expect.objectContaining({
        chart_type: "pie",
        y_key: "收入",
        y_keys: ["收入"],
        orientation: "vertical",
        stack: "none",
      }),
    });
  });

  it("offers one numeric series at a time for pie and scatter", () => {
    const chartBlock = {
      id: "chart-single-series",
      block_type: "chart" as const,
      title: "收入构成",
      order_index: 0,
      source_kind: "artifact" as const,
      content: {
        rows: [
          { 地区: "华东", 收入: 100, 利润: 20 },
          { 地区: "华南", 收入: 80, 利润: 18 },
        ],
      },
      config: {
        chart_type: "pie",
        x_key: "地区",
        y_key: "收入",
        y_keys: ["收入", "利润"],
        stack: "normal",
      },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const onChangeBlock = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPropertyPanel
          page={{ ...structuredClone(report.pages[0]), blocks: [chartBlock] }}
          block={chartBlock}
          onChangePage={vi.fn()}
          onChangeBlock={onChangeBlock}
        />
      </NextIntlClientProvider>
    );

    const revenue = screen.getByRole("radio", { name: "收入" });
    const profit = screen.getByRole("radio", { name: "利润" });
    expect(revenue).toBeChecked();
    expect(profit).not.toBeChecked();
    expect(screen.getByLabelText("图表堆叠")).toBeDisabled();
    expect(screen.getByLabelText("图表堆叠")).toHaveValue("none");

    fireEvent.click(profit);
    expect(onChangeBlock).toHaveBeenLastCalledWith({
      config: expect.objectContaining({
        y_key: "利润",
        y_keys: ["利润"],
        stack: "none",
      }),
    });
  });
});

describe("ReportPrintView", () => {
  it("renders selected PDF pages in report order without broadening an empty or unknown scope", () => {
    const document = connectedFilterReport();
    const view = render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportPrintView report={document} filterValues={{ "report-filter": "华西" }} pageIds={["page-3", "page-2", "page-2"]} />
    </NextIntlClientProvider>);
    expect([...view.container.querySelectorAll(".report-print-kicker")].map(node => node.textContent)).toEqual(["经营明细", "说明"]);
    expect(view.container).toHaveTextContent("跨页地区筛选");
    expect(view.container).toHaveTextContent("西区订单");
    expect(view.container).not.toHaveTextContent("东区订单");
    for (const pageIds of [[], ["missing"]]) {
      view.rerender(<NextIntlClientProvider locale="zh" messages={messages}><ReportPrintView report={document} filterValues={{}} pageIds={pageIds} /></NextIntlClientProvider>);
      expect(view.container.querySelectorAll(".report-print-page")).toHaveLength(0);
    }
    expect(document.pages).toHaveLength(3);
  });

  it("renders every report page for printing", () => {
    const secondPage = {
      ...structuredClone(report.pages[0]),
      id: "page-2",
      title: "明细",
      order_index: 1,
      blocks: [
        {
          ...structuredClone(report.pages[0].blocks[0]),
          id: "block-2",
          title: "区域结论",
          content: { text: "华东表现稳定" },
        },
      ],
    };
    const { container } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPrintView
          report={{ ...structuredClone(report), pages: [...structuredClone(report.pages), secondPage] }}
          filterValues={{}}
        />
      </NextIntlClientProvider>
    );

    expect(container.querySelectorAll(".report-print-page")).toHaveLength(2);
    expect(screen.getByText("收入稳步增长")).toBeInTheDocument();
    expect(screen.getByText("华东表现稳定")).toBeInTheDocument();
  });

  it("renders only the selected page in the image export surface", () => {
    const imageReport = structuredClone(report);
    imageReport.pages.push({ ...structuredClone(report.pages[0]), id: "page-2", title: "第二页", order_index: 1, blocks: [] });
    const { container } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPrintView report={imageReport} filterValues={{}} imagePageId="page-2" />
      </NextIntlClientProvider>
    );
    expect(container.querySelectorAll(".report-print-page")).toHaveLength(1);
    expect(container.querySelector(".report-image-view")).toHaveTextContent("第二页");
    expect(container).not.toHaveTextContent("收入稳步增长");
    expect(container).toHaveTextContent("2 / 2");
  });

  it("prints every retained table row instead of only the interactive first page", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      订单号: `ORDER-${String(index + 1).padStart(3, "0")}`,
      金额: index + 1,
    }));
    const tableBlock = {
      ...structuredClone(report.pages[0].blocks[0]),
      id: "table-print",
      block_type: "table" as const,
      title: "订单明细",
      content: { rows, rows_count: rows.length },
      layout: { x: 0, y: 0, w: 12, h: 6 },
    };

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportPrintView
          report={{
            ...structuredClone(report),
            pages: [{ ...structuredClone(report.pages[0]), blocks: [tableBlock] }],
          }}
          filterValues={{}}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("ORDER-075")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一页明细" })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前 1–50/)).not.toBeInTheDocument();
  });
});

describe("artifactToReportBlock", () => {
  it("keeps source provenance while making an artifact editable", () => {
    const block = artifactToReportBlock({
      id: "artifact-1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "metric",
      title: "回款金额",
      payload: { metric_value: 3200, summary: "本周回款" },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block).toMatchObject({
      block_type: "metric",
      source_kind: "artifact",
      artifact_id: "artifact-1",
      analysis_run_id: "run-1",
      content: { value: 3200, context: "本周回款" },
    });
  });

  it("unpacks structured chart data and its selected axes", () => {
    const block = artifactToReportBlock({
      id: "chart-1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "chart",
      title: "默认标题",
      payload: {
        chart: {
          type: "area",
          title: "收入趋势",
          data: [{ month: "一月", revenue: 12, profit: 3 }],
          xKey: "month",
          yKeys: ["revenue", "profit"],
        },
      },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block).toMatchObject({
      title: "收入趋势",
      content: { rows: [{ month: "一月", revenue: 12, profit: 3 }] },
      config: {
        chart_type: "area",
        x_key: "month",
        y_key: "revenue",
        y_keys: ["revenue", "profit"],
      },
    });
  });

  it("imports the approved v1 chart presentation into editable report settings", () => {
    const block = artifactToReportBlock({
      id: "chart-v1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "chart",
      title: "默认标题",
      payload: {
        chart: {
          version: 1,
          type: "bar",
          title: "区域收入",
          data_ref: { result_name: "regional_revenue", result_hash: "sha256:abc" },
          encoding: {
            x: { field: "地区", kind: "category" },
            y: [
              {
                field: "收入",
                label: "销售收入",
                kind: "number",
                aggregate: "sum",
                format: "compact",
              },
              {
                field: "利润",
                label: "利润率",
                kind: "number",
                aggregate: "sum",
                format: "percent",
              },
            ],
          },
          presentation: {
            orientation: "horizontal",
            stack: "normal",
            palette: "categorical",
          },
          data: [{ 地区: "华东", 收入: 128, 利润: 28 }],
        },
      },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block).toMatchObject({
      title: "区域收入",
      content: { rows: [{ 地区: "华东", 收入: 128, 利润: 28 }] },
      config: {
        chart_type: "bar",
        x_key: "地区",
        y_key: "收入",
        y_keys: ["收入", "利润"],
        orientation: "horizontal",
        stack: "normal",
        palette: "categorical",
        number_format: "compact",
        series_labels: { 收入: "销售收入", 利润: "利润率" },
        series_formats: { 收入: "compact", 利润: "percent" },
      },
    });
    expect(block.config).not.toHaveProperty("aggregate");
  });

  it("keeps the immutable file endpoint for a PNG chart", () => {
    const block = artifactToReportBlock({
      id: "chart-image-1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "chart",
      title: "分布图",
      payload: { format: "png", relative_path: "project-1/chart.png" },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block.config.chart_type).toBe("image");
    expect(block.content.image_url).toBe(
      "/api/v1/projects/project-1/analysis-runs/run-1/artifacts/chart-image-1/file"
    );
  });

  it("turns validation evidence into readable items", () => {
    const block = artifactToReportBlock({
      id: "evidence-1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "evidence",
      title: "核对依据",
      payload: {
        validations: [
          {
            kind: "relationship_validation",
            status: "verified",
            purpose: "SQL schema validation",
            profile: { returned_rows: 42 },
          },
        ],
        correction_applications: [
          { rule_value: "退款按净额计入", summary: "已应用到本次结果" },
        ],
        checks: [
          "收入汇总与明细一致",
          "SQL query execution failed: internal_validation_error",
        ],
      },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block.content.items).toEqual([
      { label: "关联方式已确认", text: "42 行结果已复核" },
      { label: "业务调整：退款按净额计入", text: "已应用到本次结果" },
      { label: "收入汇总与明细一致", text: "已核对" },
    ]);
  });

  it("localizes correction receipts in evidence blocks without translating business values", () => {
    const block = convertArtifactToReportBlock(
      {
        id: "evidence-correction-en",
        project_id: "project-1",
        analysis_run_id: "run-1",
        kind: "evidence",
        title: "Evidence",
        payload: {
          correction_applications: [
            {
              rule_value: "退款按净额计入",
              status: "verified",
              summary_code: "correction_verified",
              summary: "这条修正已应用到当前数据，并在最终结果中重新核对。",
            },
            {
              rule_value: "历史口径",
              status: "verified",
              summary: "已应用到本次结果",
            },
          ],
        },
        technical_details: {},
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      },
      reportBlocksCopyEn,
      "en"
    );

    expect(block.content.items).toEqual([
      {
        label: "Business adjustment: 退款按净额计入",
        text: "Results were recalculated and rechecked with this adjustment.",
      },
      {
        label: "Business adjustment: 历史口径",
        text: "Passed",
      },
    ]);
  });

  it("turns a change brief into a readable narrative", () => {
    const block = artifactToReportBlock({
      id: "change-1",
      project_id: "project-1",
      analysis_run_id: "run-1",
      kind: "change_brief",
      title: "经营变化",
      payload: {
        status: "material_change",
        overall: [
          { metric: "收入", before: 100, after: 120, percent_change: 0.2 },
        ],
        top_drivers: [
          {
            key: { 地区: "华东" },
            change: { metric: "收入", before: 40, after: 55, delta: 15 },
          },
        ],
      },
      technical_details: {},
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    expect(block.content.text).toContain("发现值得关注的变化");
    expect(block.content.text).toContain("收入：100 → 120，+20.0%");
    expect(block.content.text).toContain("华东：收入：40 → 55，变化 +15");
  });
});

describe("applyStaticReportFilters", () => {
  it("filters only blocks that expose the selected field", () => {
    const chart = {
      id: "chart-filter",
      block_type: "chart" as const,
      title: "收入趋势",
      order_index: 0,
      source_kind: "artifact" as const,
      content: {
        rows: [
          { 地区: "华东", 收入: 12 },
          { 地区: "华南", 收入: 8 },
        ],
      },
      config: {},
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };

    const filtered = applyStaticReportFilters(chart, [
      { field: "地区", operator: "equals", value: "华东" },
    ]);
    expect(filtered.content.rows).toEqual([{ 地区: "华东", 收入: 12 }]);
    expect(filtered.content._filter_source_rows).toBe(2);
    expect(
      applyStaticReportFilters(chart, [
        { field: "不存在", operator: "equals", value: "华东" },
      ])
    ).toBe(chart);
  });
});

describe("applyReportBlockUpdates", () => {
  it("marks title and presentation changes as manual without rewriting provenance", () => {
    const sourceRef = {
      source_kind: "artifact",
      artifact_title: "收入趋势",
      retained_at: "2026-07-19T00:00:00Z",
    };
    const source = {
      id: "chart-manual-override",
      block_type: "chart" as const,
      title: "收入趋势",
      order_index: 0,
      source_kind: "artifact" as const,
      analysis_run_id: "run-1",
      artifact_id: "artifact-1",
      source_ref: sourceRef,
      content: { rows: [{ 月份: "七月", 收入: 128 }] },
      config: { chart_type: "bar", x_key: "月份", y_keys: ["收入"] },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };

    const renamed = applyReportBlockUpdates(source, { title: "手工调整后的收入趋势" });
    expect(renamed).toMatchObject({
      title: "手工调整后的收入趋势",
      analysis_run_id: "run-1",
      artifact_id: "artifact-1",
      config: { manual_override: true },
    });
    expect(renamed.source_ref).toBe(sourceRef);

    const restyled = applyReportBlockUpdates(source, {
      config: { ...source.config, stack: "normal", show_labels: true },
      source_ref: { source_kind: "manual" },
      artifact_id: "replacement-artifact",
    });
    expect(restyled).toMatchObject({
      artifact_id: "artifact-1",
      config: {
        chart_type: "bar",
        stack: "normal",
        show_labels: true,
        manual_override: true,
      },
    });
    expect(restyled.source_ref).toBe(sourceRef);
  });
});
