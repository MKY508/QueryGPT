import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import { ReportFindDialog } from "@/components/reports/ReportFindDialog";
import { reportSearchIndex, searchReportContent } from "@/lib/report-content-search";
import { reportTextValue } from "@/lib/report-display-text";
import type { ReportDocument, ReportBlock } from "@/lib/reports";
import zh from "@/messages/zh.json";

const block = (id: string, content: Record<string, unknown>, block_type: ReportBlock["block_type"] = "text"): ReportBlock => ({
  id, title: `Card ${id}`, block_type, content, config: {}, layout: { x: 0, y: 0, w: 12, h: 3 }, order_index: 0, source_kind: "manual",
});
const report = (blocks: ReportBlock[] = []): ReportDocument => ({ id: "report", project_id: "project", title: "Monthly report", description: "Summary",
  status: "draft", version: 1, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  pages: [{ id: "page", title: "Overview", order_index: 0, config: {}, blocks }] });
let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

describe("report content search", () => {
  it("resets expanded results by search scope but preserves them for updates to the same report", async () => {
    const prepared = report(Array.from({length: 125}, (_, i) => block(String(i), {text: "alpha beta"})));
    const content = (doc: ReportDocument, query = "alpha") => <NextIntlClientProvider locale="zh" messages={zh}>
      <ReportFindDialog report={doc} query={query} onQuery={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} />
    </NextIntlClientProvider>;
    const view = render(content(prepared));
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
    const count = () => view.container.querySelectorAll("button[data-find-result]").length;
    const expand = () => fireEvent.click(screen.getByRole("button", {name: "显示更多 · 已显示 60 / 125"}));
    expand(); expect(count()).toBe(120);
    view.rerender(content({...prepared, version: 2})); expect(count()).toBe(120);
    view.rerender(content(prepared, "beta")); expect(count()).toBe(60);
    expand(); expect(count()).toBe(120);
    view.rerender(content({...prepared, id: "different"}, "beta")); expect(count()).toBe(60);
    expand(); expect(count()).toBe(120);
    view.rerender(content({...prepared, id: "different", project_id: "another-project"}, "beta")); expect(count()).toBe(60);
    view.rerender(content(prepared)); expect(count()).toBe(60);
  });

  it("finds compatibility text while highlighting the complete original graphemes", () => {
    const index = reportSearchIndex(report([block("unicode", { text: "前言 Ｃａｆｅ\u0301：oﬃce、ｶﾞ。👩🏽‍💻 完" })]), "zh");
    for (const [query, original] of [["café", "Ｃａｆｅ\u0301"], ["ffi", "ﬃ"], ["ガ", "ｶﾞ"], ["👩", "👩🏽‍💻"]]) {
      const result = searchReportContent(index, query);
      expect(result).toHaveLength(1);
      expect(result[0].blockId).toBe("unicode");
      expect(result[0].snippet?.match).toBe(original);
      const snippet = result[0].snippet!;
      expect(snippet.before + snippet.match + snippet.after).toBe(index.find(entry => entry.blockId === "unicode")!.fields[1]);
    }
    expect(searchReportContent(index, "[.*]")).toEqual([]);
  });

  it("keeps excerpt boundaries outside emoji sequences", () => {
    const emoji = "👩🏽‍💻";
    const index = reportSearchIndex(report([block("long", { text: emoji.repeat(20) + "needle" + emoji.repeat(30) })]), "en");
    const snippet = searchReportContent(index, "needle")[0].snippet!;
    expect(snippet.match).toBe("needle");
    expect(snippet.before.replace(/^…/, "").split(emoji).join("")).toBe("");
    expect(snippet.after.replace(/…$/, "").split(emoji).join("")).toBe("");
  });

  it("finds literal phrases in presentation text, groups in page order and excludes raw data and internal fields", () => {
    const prepared = report([block("note", { text: "开头。".repeat(50) + "配送成本 [a+b] <script>needs review</script>", sql: "private-query" })]);
    prepared.pages.push({ id: "earlier", title: "Earlier", order_index: -1, config: { narrative: "Page narrative" }, blocks: [
      block("table", { get rows() { throw new Error("Do not scan transaction rows"); }, technical_details: "private-query" }, "table"),
    ] });
    const index = reportSearchIndex(prepared, "en");
    expect(index[0].pageId).toBe("earlier"); expect(prepared.pages[0].id).toBe("page");
    const result = searchReportContent(index, "[a+b]");
    expect(result).toHaveLength(1); expect(result[0].blockId).toBe("note");
    expect(result[0].snippet?.match).toBe("[a+b]"); expect(result[0].snippet?.before.startsWith("…")).toBe(true);
    expect(searchReportContent(index, "NEEDS REVIEW")[0].snippet?.match).toBe("needs review");
    expect(searchReportContent(index, "private-query")).toEqual([]);
    expect(searchReportContent(index, "Page narrative")[0].blockId).toBeNull();
    expect(reportTextValue(Object.assign(Object.create({ text: "inherited" }), { summary: "own。。。" }), ["text", "summary"])).toBe("own。");
  });

  it("uses formatted metric values and visible evidence entries instead of stale aliases or hidden rows", () => {
    const metric = block("metric", { value: "0.125", context: "Revenue growth", note: "hidden-alias", change: "+2 points" }, "metric");
    metric.config = { metric_display: { style: "percent", decimals: 1 } };
    const evidence = block("evidence", { items: Array.from({ length: 13 }, (_, i) => ({ label: `Evidence ${i}`, detail: `Detail ${i}` })) }, "evidence");
    const index = reportSearchIndex(report([metric, evidence]), "en");
    expect(searchReportContent(index, "12.5%")[0].blockId).toBe("metric");
    expect(searchReportContent(index, "0.125")).toEqual([]); expect(searchReportContent(index, "hidden-alias")).toEqual([]);
    expect(searchReportContent(index, "Detail 11")[0].blockId).toBe("evidence");
    expect(searchReportContent(index, "Detail 12")).toEqual([]);
  });

  it("bounds rendered matches, supports keyboard navigation and composition, and renders excerpts as text", async () => {
    const select = vi.fn(), close = vi.fn();
    const prepared = report(Array.from({ length: 65 }, (_, i) => block(String(i), { text: "Needle <img src=x onerror=alert(1)>" })));
    function Harness() {
      const [query, setQuery] = useState("needle");
      return <NextIntlClientProvider locale="zh" messages={zh}><ReportFindDialog report={prepared} query={query} onQuery={setQuery} onSelect={select} onClose={close} /></NextIntlClientProvider>;
    }
    const { container } = render(<Harness />);
    const input = screen.getByRole("searchbox"); await waitFor(() => expect(input).toHaveFocus());
    expect(container.querySelectorAll("button[data-find-result]")).toHaveLength(60);
    expect(screen.getByRole("status")).toHaveTextContent("65 个匹配位置"); expect(container.querySelector("img")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true }); fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(input).toHaveValue("needle");
    const more = screen.getByRole("button", { name: "显示更多 · 已显示 60 / 65" });
    more.focus(); fireEvent.click(more);
    expect(container.querySelectorAll("button[data-find-result]")).toHaveLength(65);
    expect(screen.getByRole("button", { name: "前往第 1 页：Card 60" })).toHaveFocus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = screen.getByRole("button", { name: "前往第 1 页：Card 0" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" }); expect(screen.getByRole("button", { name: "前往第 1 页：Card 64" })).toHaveFocus();
    fireEvent.click(document.activeElement!); expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0]).toMatchObject({ pageId: "page", blockId: "64" });
    fireEvent.keyDown(input, { key: "Escape" }); expect(input).toHaveValue(""); expect(close).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(screen.getByRole("button", { name: zh.reportFind.close }), { key: "Escape" });
    expect(input).toHaveValue(""); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  });

  it("replaces stale result targets when the current document changes while the query is retained", () => {
    const select = vi.fn();
    const content = (id: string) => <NextIntlClientProvider locale="zh" messages={zh}>
      <ReportFindDialog report={report([block(id, { text: "Matching prose" })])} query="Matching" onQuery={vi.fn()} onSelect={select} onClose={vi.fn()} />
    </NextIntlClientProvider>;
    const view = render(content("old")); view.rerender(content("new"));
    expect(screen.queryByRole("button", { name: "前往第 1 页：Card old" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(select.mock.calls[0][0]).toMatchObject({ blockId: "new" });
  });

  it("returns removed-result focus to search without stealing focus from a surviving control", async () => {
    const select = vi.fn();
    const content = (id: string) => <NextIntlClientProvider locale="zh" messages={zh}>
      <ReportFindDialog report={report([block(id, { text: "Matching prose" })])} query="Matching" onQuery={vi.fn()} onSelect={select} onClose={vi.fn()} />
    </NextIntlClientProvider>;
    const view = render(content("old"));
    const input = screen.getByRole("searchbox"); await waitFor(() => expect(input).toHaveFocus());
    screen.getByRole("button", { name: "前往第 1 页：Card old" }).focus();
    view.rerender(content("new"));
    expect(input).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "前往第 1 页：Card new" }).focus();
    const close = screen.getByRole("button", { name: zh.reportFind.close }); close.focus();
    view.rerender(content("third"));
    expect(close).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
  });
});
