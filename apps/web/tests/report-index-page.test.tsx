import { act, cleanup, fireEvent, render as renderUI, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportIndexPage } from "@/components/reports/ReportIndexPage";
import { useChatStore } from "@/lib/stores/chat";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import type { ReportLibraryPage, ReportListItem } from "@/lib/reports";
import { readReportLibraryView, type ReportLibraryView } from "@/lib/report-library";
import { api } from "@/lib/api/client";
import * as reportCopy from "@/lib/report-copy";
import * as copyJournal from "@/lib/report-copy-journal";

const mocks = vi.hoisted(() => ({
  listReports: vi.fn(),
  listReportLibrary: vi.fn(),
  createReport: vi.fn(),
  deleteReport: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  };
  return {
    useRouter: () => ({ push: mocks.push }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search, () => "")),
  };
});

vi.mock("@/lib/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports")>();
  return { ...actual, ...mocks };
});

let client: QueryClient;
function render(node: ReactNode) {
  return renderUI(node, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

function page(projectId = "project-1", locale: "zh" | "en" = "zh") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zhMessages : enMessages}>
    <ReportIndexPage projectId={projectId} />
  </NextIntlClientProvider>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const savedReport: ReportListItem = {
  id: "report-1", project_id: "project-1", title: "经营概览", description: "七月复盘", status: "draft",
  version: 1, page_count: 1, block_count: 2, created_at: "2026-07-19T00:00:00Z", updated_at: "2026-07-19T01:00:00Z",
};

// Test transport fixture only. Selection correctness is exercised against the
// SQL endpoint in the API tests; the UI receives one bounded page, never this array.
function libraryPage(reports: ReportListItem[], view: ReportLibraryView): ReportLibraryPage {
  const terms = view.search.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const selected = reports.filter((report) => (view.status === "all" || report.status === view.status)
    && terms.every((term) => `${report.title}\n${report.description}`.normalize("NFKC").toLowerCase().includes(term)))
    .sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(selected.length / 24));
  const page = Math.min(view.page, pageCount);
  return { items: selected.slice((page - 1) * 24, page * 24), total: reports.length,
    count: selected.length, page, page_size: 24, page_count: pageCount };
}

describe("ReportIndexPage", () => {
  beforeEach(() => {
    vi.spyOn(copyJournal, "listPendingCopies").mockResolvedValue({ items: [], total: 0, next: null });
    vi.spyOn(copyJournal, "subscribePendingCopies").mockReturnValue(() => undefined);
    vi.spyOn(copyJournal, "pendingCopyForSource").mockResolvedValue(null);
    vi.spyOn(copyJournal, "preparePendingCopy").mockImplementation(async (projectId, sourceReportId, sourceTitle, request) => ({ created: true,
      pending: { schema: 1, id: request.request_id, projectId, sourceReportId, sourceTitle, createdAt: 1, request } }));
    vi.spyOn(copyJournal, "requirePendingCopy").mockImplementation(async (pending) => pending);
    vi.spyOn(copyJournal, "removePendingCopy").mockResolvedValue(true);
    window.history.replaceState(null, "", "/projects/project-1/reports");
    const pushState = window.history.pushState.bind(window.history);
    // Model Next's documented history -> useSearchParams integration without
    // starting a Next server for this focused component check.
    vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => {
      pushState(data, unused, url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
    mocks.push.mockReset();
    mocks.listReports.mockReset();
    mocks.listReportLibrary.mockReset().mockImplementation(async (projectId, view, signal) =>
      libraryPage(await mocks.listReports(projectId, signal), view));
    mocks.createReport.mockReset();
    mocks.deleteReport.mockReset();
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    useChatStore.setState({
      currentConversationId: null,
      currentConversationMeta: null,
      lastProjectId: null,
    });
  });

  afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); vi.restoreAllMocks(); });

  it("requests bounded server pages for controls and carries its view through report links", async () => {
    window.history.replaceState(null, "", "/projects/project-1/reports?fromConversation=conversation-1");
    const reports = Array.from({ length: 26 }, (_, index) => ({
      ...savedReport, id: `report-${index + 1}`, title: `Report ${index + 1}`,
      description: index === 25 ? "East 100%" : "West", status: index === 25 ? "published" as const : "draft" as const,
    }));
    mocks.listReports.mockResolvedValue(reports);
    render(page());
    await screen.findByRole("link", { name: /Report 1 West/ });
    expect(screen.getAllByRole("listitem")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: "下一页报告" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
    const input = screen.getByRole("searchbox", { name: "搜索报告" });
    fireEvent.change(input, { target: { value: "East 100%" } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    expect(new URLSearchParams(window.location.search).has("q")).toBe(false);
    fireEvent.submit(screen.getByRole("search", { name: "搜索报告" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    fireEvent.change(screen.getByRole("combobox", { name: "报告状态" }), { target: { value: "published" } });
    fireEvent.change(screen.getByRole("combobox", { name: "报告排序" }), { target: { value: "title" } });
    const link = await screen.findByRole("link", { name: /Report 26 East/ });
    const query = new URL(link.getAttribute("href")!, window.location.origin).searchParams;
    expect(Object.fromEntries(query)).toEqual({ fromConversation: "conversation-1", q: "East 100%", sort: "title", status: "published" });
    const matchingUrl = window.location.href;
    fireEvent.change(screen.getByRole("combobox", { name: "报告状态" }), { target: { value: "archived" } });
    expect(await screen.findByRole("heading", { name: "没有找到匹配的报告" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "从一张空白报告开始" })).not.toBeInTheDocument();
    act(() => { window.history.replaceState(null, "", matchingUrl); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByRole("link", { name: /Report 26 East/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(input).toHaveValue("");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(24));
    expect(mocks.listReportLibrary).toHaveBeenCalledWith("project-1",
      { search: "East 100%", sort: "title", status: "published", page: 1 }, expect.any(AbortSignal));
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });

  it("creates an independent report copy from the library and preserves navigation context", async () => {
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
    });
    try {
      window.history.replaceState(null, "", "/projects/project-1/reports?sort=title&fromRun=run-1");
      mocks.listReports.mockResolvedValue([savedReport]);
      const target = "00000000-0000-4000-8000-000000000005";
      const create = vi.spyOn(reportCopy, "copyReport").mockImplementation(async (project, report, request) => ({ project_id: project,
        source_report_id: report, source_version: request.expected_version, request_id: request.request_id, report_id: target }));
      render(page());
      fireEvent.click(await screen.findByRole("button", { name: "创建报告副本：经营概览" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
      expect(create).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("textbox", { name: "新报告名称" }), { target: { value: "下期经营概览" } });
      fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
      fireEvent.click(await screen.findByRole("button", { name: "打开副本" }));
      await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
      expect(create.mock.calls[0].slice(0, 2)).toEqual(["project-1", "report-1"]);
      expect(create.mock.calls[0][2]).toMatchObject({ expected_version: 1, title: "下期经营概览" });
      const destination = new URL(mocks.push.mock.calls[0][0], window.location.origin);
      expect(destination.pathname).toBe(`/projects/project-1/reports/${target}`);
      expect(destination.searchParams.get("sort")).toBe("title");
      expect(destination.searchParams.get("fromRun")).toBe("run-1");
      expect(mocks.createReport).not.toHaveBeenCalled();
    } finally {
      cleanup();
      if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("continues a pending copy even when its original report is absent from the library", async () => {
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
    });
    try {
      mocks.listReports.mockResolvedValue([]);
      const pending: copyJournal.PendingReportCopy = { schema: 1, id: crypto.randomUUID(), projectId: "project-1", sourceReportId: "deleted-original",
        sourceTitle: "原报告", createdAt: Date.now(), request: { request_id: "", expected_version: 4, title: "待继续的副本" } };
      pending.request.request_id = pending.id;
      vi.mocked(copyJournal.listPendingCopies).mockResolvedValue({ items: [pending], total: 1, next: null });
      const target = crypto.randomUUID();
      const resolve = vi.spyOn(reportCopy, "resolveReportCopy").mockResolvedValue({ request_id: pending.id,
        project_id: "project-1", source_report_id: pending.sourceReportId, source_version: 4, report_id: target });
      const create = vi.spyOn(reportCopy, "copyReport");
      render(page());
      fireEvent.click(await screen.findByRole("button", { name: "有 1 份报告副本待确认" }));
      fireEvent.click(screen.getByRole("button", { name: "继续查看" }));
      fireEvent.click(await screen.findByRole("button", { name: "打开副本" }));
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/projects/project-1/reports/${target}`));
      expect(resolve.mock.calls[0].slice(0, 3)).toEqual(["project-1", "deleted-original", pending.request]);
      expect(copyJournal.removePendingCopy).toHaveBeenCalledWith(pending);
      expect(create).not.toHaveBeenCalled();
    } finally {
      cleanup();
      if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("clamps the library page after its last report is deleted and preserves a usable return link", async () => {
    window.history.replaceState(null, "", "/projects/project-1/reports?page=2&sort=title");
    const reports = Array.from({ length: 25 }, (_, index) => ({ ...savedReport, id: `report-${index + 1}`, title: `Report ${index + 1}` }));
    mocks.listReports.mockResolvedValueOnce(reports).mockResolvedValue(reports.slice(0, 24));
    mocks.deleteReport.mockResolvedValue(undefined);
    render(page());
    await screen.findByRole("link", { name: /Report 25/ });
    fireEvent.click(screen.getByRole("button", { name: "删除报告：Report 25" }));
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
    await waitFor(() => expect(mocks.deleteReport).toHaveBeenCalledWith("project-1", "report-25", savedReport.version));
    const first = await screen.findByRole("link", { name: /Report 1 七月/ });
    expect(screen.queryByRole("navigation", { name: "报告列表分页" })).not.toBeInTheDocument();
    expect(new URL(first.getAttribute("href")!, window.location.origin).searchParams.has("page")).toBe(false);
  });

  it("can recover a deleted last page when its replacement read fails", async () => {
    window.history.replaceState(null, "", "/projects/project-1/reports?page=2");
    const last = { ...savedReport, id: "report-25", title: "Last report" };
    mocks.listReportLibrary.mockResolvedValueOnce({ items: [last], total: 25, count: 25, page: 2, page_size: 24, page_count: 2 })
      .mockRejectedValueOnce(new Error("Read failed"))
      .mockResolvedValue({ items: [savedReport], total: 24, count: 24, page: 1, page_size: 24, page_count: 1 });
    mocks.deleteReport.mockResolvedValue(undefined);
    render(page());
    fireEvent.click(await screen.findByRole("button", { name: "删除报告：Last report" }));
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
    expect(await screen.findByRole("heading", { name: "报告暂时没有打开" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "没有找到匹配的报告" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("link", { name: /经营概览/ })).toBeInTheDocument();
    expect(mocks.deleteReport).toHaveBeenCalledTimes(1);
  });

  it("aborts departed project reads, ignores their late responses, and does not reload on locale change", async () => {
    const oldRead = deferred<ReportListItem[]>();
    const nextRead = deferred<ReportListItem[]>();
    const signals: AbortSignal[] = [];
    mocks.listReports.mockImplementation((projectId, signal) => {
      signals.push(signal);
      return projectId === "project-1" ? oldRead.promise : nextRead.promise;
    });
    const { rerender } = render(<StrictMode>{page()}</StrictMode>);
    rerender(<StrictMode>{page("project-2")}</StrictMode>);
    expect(signals.slice(0, -1).every((signal) => signal.aborted)).toBe(true);
    await act(async () => { oldRead.resolve([savedReport]); });
    expect(screen.queryByRole("link", { name: /经营概览/ })).not.toBeInTheDocument();
    const next = { ...savedReport, id: "report-2", project_id: "project-2", title: "门店概览" };
    await act(async () => { nextRead.resolve([next]); });
    expect(await screen.findByRole("link", { name: /门店概览/ })).toHaveAttribute("href", "/projects/project-2/reports/report-2");
    const requests = mocks.listReports.mock.calls.length;
    rerender(<StrictMode>{page("project-2", "en")}</StrictMode>);
    expect(mocks.listReports).toHaveBeenCalledTimes(requests);
    expect(screen.getByRole("link", { name: /门店概览/ })).toBeInTheDocument();
  });

  it("submits a creation once and never navigates a departed project on its late acknowledgment", async () => {
    mocks.listReports.mockResolvedValue([]);
    const pending = deferred<{ id: string }>();
    mocks.createReport.mockReturnValue(pending.promise);
    const { rerender } = render(page());
    await screen.findByRole("heading", { name: "从一张空白报告开始" });
    const buttons = screen.getAllByRole("button", { name: "新建报告" });
    act(() => { buttons[0].click(); buttons[1].click(); });
    await waitFor(() => expect(mocks.createReport).toHaveBeenCalledTimes(1));
    rerender(page("project-2"));
    await screen.findByRole("heading", { name: "从一张空白报告开始" });
    await act(async () => { pending.resolve({ id: "created-in-project-1" }); });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "新建报告" }).every((button) => !button.hasAttribute("disabled"))).toBe(true);
  });

  it("keeps existing reports on a failed delete and reconciles by reading instead of retrying the write", async () => {
    mocks.listReports.mockResolvedValue([savedReport]);
    mocks.deleteReport.mockRejectedValue(new Error("Response lost"));
    render(page());
    await screen.findByRole("link", { name: /经营概览/ });
    fireEvent.click(screen.getByRole("button", { name: "删除报告：经营概览" }));
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(zhMessages.reportIndex.deleteError);
    expect(screen.getByRole("link", { name: /经营概览/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建报告" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除报告：经营概览" })).toBeDisabled();
    mocks.listReports.mockResolvedValue([]);
    fireEvent.click(within(alert).getByRole("button", { name: "刷新列表" }));
    await screen.findByRole("heading", { name: "从一张空白报告开始" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.deleteReport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "新建报告" })[0]).toBeEnabled();
  });

  it("does not reinsert an acknowledged deletion from an older in-flight list read", async () => {
    const other = { ...savedReport, id: "report-2", title: "保留报告" };
    const staleRead = deferred<ReportListItem[]>();
    mocks.listReports.mockResolvedValueOnce([savedReport, other]).mockReturnValueOnce(staleRead.promise).mockResolvedValue([other]);
    mocks.deleteReport.mockResolvedValue(undefined);
    render(page());
    await screen.findByRole("link", { name: /经营概览/ });
    act(() => { void client.refetchQueries({ queryKey: ["project-report-index", "project-1"] }); });
    await waitFor(() => expect(mocks.listReports).toHaveBeenCalledTimes(2));
    const staleSignal = mocks.listReports.mock.calls[1][1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "删除报告：经营概览" }));
    fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
    await waitFor(() => expect(staleSignal.aborted).toBe(true));
    await waitFor(() => expect(screen.queryByRole("link", { name: /经营概览/ })).not.toBeInTheDocument());
    await act(async () => { staleRead.resolve([savedReport, other]); });
    expect(screen.queryByRole("link", { name: /经营概览/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /保留报告/ })).toBeInTheDocument();
  });

  it("calls the local API while internet is offline and does not enqueue a reconnect write", async () => {
    onlineManager.setOnline(false);
    mocks.listReports.mockResolvedValue([]);
    mocks.createReport.mockResolvedValue({ id: "report-offline" });
    render(page());
    await screen.findByRole("heading", { name: "从一张空白报告开始" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建报告" })[0]);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/projects/project-1/reports/report-offline"));
    act(() => onlineManager.setOnline(true));
    expect(mocks.createReport).toHaveBeenCalledTimes(1);
    expect(client.getMutationCache().getAll().every((mutation) => !mutation.state.isPaused)).toBe(true);
  });

  it("passes bounded library controls and cancellation through the actual API adapter", async () => {
    const actual = await vi.importActual<typeof import("@/lib/reports")>("@/lib/reports");
    const view = readReportLibraryView(new URLSearchParams("q=华东%25&sort=title&status=draft&page=2"));
    const data = { items: [{ ...savedReport, description: null }], total: 50, count: 25, page: 2, page_size: 24, page_count: 2 };
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { data } });
    const controller = new AbortController();
    await expect(actual.listReportLibrary("project-1", view, controller.signal)).resolves.toEqual({ ...data, items: [{ ...savedReport, description: "" }] });
    expect(get).toHaveBeenCalledWith("/api/v1/projects/project-1/reports/library", {
      signal: controller.signal, params: { q: "华东%", sort: "title", status: "draft", page: 2, page_size: 24 },
    });
  });

  it("cancels obsolete filters and never shows their late page under the new search", async () => {
    const old = deferred<ReportLibraryPage>();
    const latest = deferred<ReportLibraryPage>();
    mocks.listReportLibrary.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    render(page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "New" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(mocks.listReportLibrary).toHaveBeenCalledTimes(2));
    expect(mocks.listReportLibrary.mock.calls[0][2].aborted).toBe(true);
    await act(async () => { old.resolve(libraryPage([savedReport], readReportLibraryView(new URLSearchParams()))); });
    expect(screen.queryByRole("link", { name: /经营概览/ })).not.toBeInTheDocument();
    await act(async () => { latest.resolve({ items: [], total: 1, count: 0, page: 1, page_count: 1, page_size: 24 }); });
    expect(await screen.findByRole("heading", { name: "没有找到匹配的报告" })).toBeInTheDocument();
  });

  it("carries the source conversation through a report and back to the project", async () => {
    mocks.listReports.mockResolvedValue([
      {
        id: "report-1",
        project_id: "project-1",
        title: "经营概览",
        description: "七月复盘",
        status: "draft",
        version: 1,
        page_count: 1,
        block_count: 2,
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T01:00:00Z",
      },
    ]);
    useChatStore.setState({
      currentConversationId: "conversation-1",
      lastProjectId: "project-1",
    });

    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <ReportIndexPage projectId="project-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByRole("link", { name: /经营概览/ })).toHaveAttribute(
      "href",
      "/projects/project-1/reports/report-1?fromConversation=conversation-1"
    );
    expect(screen.getByRole("link", { name: "返回项目" })).toHaveAttribute(
      "href",
      "/?conversation=conversation-1"
    );
  });

  it("shows a single recovery state instead of presenting an API error as an empty report list", async () => {
    mocks.listReports.mockRejectedValue(new Error("报告没有加载完成，请重试。"));

    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <ReportIndexPage projectId="project-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "报告暂时没有打开" })).toBeInTheDocument();
    expect(screen.getByText("报告没有加载完成，请重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("从一张空白报告开始")).not.toBeInTheDocument();
  });

  it("uses English copy for the report list and newly persisted defaults", async () => {
    mocks.listReports.mockResolvedValue([]);
    mocks.createReport.mockResolvedValue({ id: "report-new" });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ReportIndexPage projectId="project-1" />
      </NextIntlClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Start with a blank report" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "New report" })[0]);

    await waitFor(() => expect(mocks.createReport).toHaveBeenCalledTimes(1));
    expect(mocks.createReport.mock.calls[0][1]).toMatchObject({
      title: "New report",
      pages: [expect.objectContaining({ title: "Overview" })],
    });
  });
});
