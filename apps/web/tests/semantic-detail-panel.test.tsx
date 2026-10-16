import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticDetailPanel } from "@/components/semantic/SemanticDetailPanel";
import { ProjectUnderstandingWorkspace } from "@/components/semantic/ProjectUnderstandingWorkspace";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { SemanticEntry } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";

const copy = zh.projectUnderstanding.details;
let restoreDialogs: () => void;
let width: ReturnType<typeof mockSemanticWidth>;
const originalStore = useProjectStore.getState();
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); width = mockSemanticWidth(false); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(originalStore, true); });
const props = { covered: false, focusRequest: 0, title: "有效订单", index: 0, count: 3, busy: false,
  onNavigate: vi.fn(), onReturnFocus: vi.fn(), children: <button>编辑</button> };
const panel = (overrides: Partial<typeof props> = {}, english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <SemanticDetailPanel {...props} {...overrides} />
</NextIntlClientProvider>;

describe("semantic detail reading", () => {
  it("keeps a persistent inspector without a viewport listener or Tab trap", () => {
    const onReturnFocus = vi.fn();
    const { rerender } = render(panel({ focusRequest: 1, onReturnFocus }));
    const detail = screen.getByRole("complementary", { name: "有效订单" });
    const heading = within(detail).getByRole("heading");
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(width.listeners.size).toBe(0);
    fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
    expect(heading).toHaveFocus();
    fireEvent.keyDown(heading, { key: "Escape", isComposing: true });
    expect(onReturnFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(heading, { key: "Escape" });
    expect(onReturnFocus).toHaveBeenCalledOnce();
    act(() => width.set(true));
    rerender(panel({ focusRequest: 1, onReturnFocus }, true));
    expect(screen.getByRole("complementary")).toBe(detail);
    expect(heading).toHaveFocus();
  });

  it("guards page boundaries and busy navigation while preserving reading focus", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(panel({ focusRequest: 1, onNavigate }));
    fireEvent.click(screen.getByRole("button", { name: copy.previous }));
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.next }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
    rerender(panel({ focusRequest: 2, index: 2, title: " 净收入", onNavigate }));
    expect(screen.getByRole("heading").textContent).toBe(" 净收入");
    expect(screen.getByRole("heading")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: copy.next }));
    rerender(panel({ index: 1, busy: true, onNavigate }));
    fireEvent.click(screen.getByRole("button", { name: copy.previous }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("defers explicit reading focus while an editor covers the inspector", () => {
    const onReturnFocus = vi.fn();
    const { rerender } = render(panel({ focusRequest: 1, onReturnFocus }));
    const edit = screen.getByRole("button", { name: "编辑" }); edit.focus();
    rerender(panel({ covered: true, focusRequest: 2, onReturnFocus }));
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "Escape" });
    expect(onReturnFocus).not.toHaveBeenCalled();
    rerender(panel({ focusRequest: 2, onReturnFocus }));
    expect(screen.getByRole("heading")).toHaveFocus();
  });

  it("integrates row selection, next/previous, local editing and return focus without selecting or writing definitions", async () => {
    const entries: SemanticEntry[] = ["有效订单", "净收入", "退款口径"].map((name, index) => ({
      id: `entry-${index}`, project_id: "detail-test", key: `rule-${index}`, value: `${name}的业务定义`, entry_type: "business_rule", state: "confirmed",
      validity: "active", source: "user", confidence: 1, evidence: [], definition: { business_name: name }, active_revision_id: `revision-${index}`,
      allowed_actions: ["ignore"], created_at: "2026-09-06", updated_at: "2026-09-06",
    }));
    vi.spyOn(api, "get").mockImplementation(async url => ({ data: { data: url.endsWith("/knowledge/page")
      ? { items: entries, total: 3, offset: 0, limit: 50, has_more: false, next_offset: null }
      : url.endsWith("/sources") || url.endsWith("/semantic-scopes") ? [] : { id: "detail-test", name: "九月经营" } } }) as never);
    const put = vi.spyOn(api, "put"), post = vi.spyOn(api, "post");
    render(<NextIntlClientProvider locale="zh" messages={zh}><ProjectUnderstandingWorkspace projectId="detail-test" /></NextIntlClientProvider>);
    await screen.findByText("共 3 条");
    const cards = within(screen.getByTestId("semantic-table-list"));
    fireEvent.click(cards.getByText("有效订单"));
    expect(screen.getByRole("complementary", { name: "有效订单" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.next }));
    const detail = screen.getByRole("complementary", { name: "净收入" });
    expect(within(detail).getByRole("heading")).toHaveFocus();
    expect(screen.queryByText("已选 1 条")).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("dialog", { name: "编辑业务定义" });
    await waitFor(() => expect(within(editor).getByRole("textbox", { name: zh.projectUnderstanding.editor.name })).toHaveFocus());
    fireEvent.change(within(editor).getByRole("textbox", { name: "业务定义" }), { target: { value: "只是本地草稿" } });
    fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: zh.projectUnderstanding.editor.discardAndClose }));
    expect(detail).toBeVisible();
    fireEvent.keyDown(detail, { key: "Escape" });
    expect(cards.getByText("净收入").closest("tr")).toHaveFocus();
    expect(put).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });

  it("ends detail and editor sessions when switching projects without publishing an old draft or late list", async () => {
    let finishOld: (result: unknown) => void = () => {};
    const oldPage = new Promise(resolve => { finishOld = resolve; });
    vi.spyOn(api, "get").mockImplementation(async url => {
      if (url.endsWith("/sources") || url.endsWith("/semantic-scopes")) return { data: { data: [] } } as never;
      if (url.includes("/old/knowledge/page")) return oldPage as never;
      if (url.endsWith("/knowledge/page")) return { data: { data: { items: [], total: 0, offset: 0, limit: 50, has_more: false } } } as never;
      return { data: { data: { id: url.split("/").at(-1), name: url.includes("/old") ? "旧项目" : "新项目" } } } as never;
    });
    const post = vi.spyOn(api, "post"), put = vi.spyOn(api, "put");
    const workspace = (projectId: string) => <NextIntlClientProvider locale="zh" messages={zh}><ProjectUnderstandingWorkspace projectId={projectId} /></NextIntlClientProvider>;
    const { rerender } = render(workspace("old"));
    await screen.findByText("旧项目");
    fireEvent.click(screen.getByRole("button", { name: zh.projectUnderstanding.actions.addDefinition }));
    const editor = screen.getByRole("dialog", { name: zh.projectUnderstanding.editor.addTitle });
    fireEvent.change(within(editor).getByRole("textbox", { name: zh.projectUnderstanding.editor.name }), { target: { value: "旧项目中的未提交定义" } });
    rerender(workspace("new")); await screen.findByText("新项目");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("旧项目中的未提交定义")).not.toBeInTheDocument();
    await act(async () => { finishOld({ data: { data: { items: [], total: 42, offset: 0, limit: 50, has_more: false } } }); await oldPage; });
    expect(screen.queryByText("共 42 条")).not.toBeInTheDocument(); expect(useProjectStore.getState().currentProjectId).toBe("new");
    expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
});
