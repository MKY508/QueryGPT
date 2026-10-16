import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectUnderstandingWorkspace } from "@/components/semantic/ProjectUnderstandingWorkspace";
import { reconcileSemanticSelection, removeSemanticSelection, toggleSemanticSelection } from "@/lib/semantic-selection";
import { inspectSemanticBatchResult } from "@/lib/semantic-batch";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { SemanticEntry } from "@/lib/types/api";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { requestParams } from "./request-params";

const copy = zh.projectUnderstanding;
const entry = (id: number): SemanticEntry => ({ id: `entry-${id}`, project_id: "selection-project", key: `private-key-${id}`, value: `第${id}项业务定义的说明`,
  entry_type: "business_rule", state: "candidate", validity: "unverified", confidence: 1, evidence: [], source: "user", is_active: true,
  active_revision_id: `head-${id}`, revision_number: 1, definition: { business_name: `经营定义 ${id}`, description: `第${id}项业务定义的说明` },
  allowed_actions: ["ignore"], source_scope: "project", created_at: "2026-09-06", updated_at: "2026-09-06" });
const response = (data: unknown) => ({ data: { data } });
const original = useProjectStore.getState();
let restoreDialogs: () => void;
let values: SemanticEntry[];
const workspace = (english = false, projectId = "selection-project") => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <ProjectUnderstandingWorkspace projectId={projectId} />
</NextIntlClientProvider>;
const dialog = () => screen.getByRole("dialog", { name: copy.selection.title });
const review = () => { const button = screen.getByRole("button", { name: copy.selection.review }); button.focus(); fireEvent.click(button); };
beforeEach(() => {
  values = Array.from({ length: 101 }, (_, index) => entry(index + 1));
  restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(true);
  useProjectStore.setState({ refreshCurrent: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(api, "get").mockImplementation(async (url, config) => {
    if (url.endsWith("/sources") || url.endsWith("/semantic-scopes")) return response([]) as never;
    if (!url.endsWith("/knowledge/page")) return response({ id: url.split("/").at(-1), name: "九月经营" }) as never;
    const params = requestParams(config?.params);
    const offset = Number(params.offset) || 0;
    const items = params.search ? values.filter(item => item.id === "entry-101") : values;
    return response({ items: items.slice(offset, offset + 50), total: items.length, offset, limit: 50, has_more: offset + 50 < items.length, next_offset: offset + 50 }) as never;
  });
});
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(original, true); });

describe("explicit cross-page definition selection", () => {
  it("merges only the chosen page, caps atomically at 100, and never adopts an updated head", () => {
    const first = values.slice(0, 50), second = values.slice(50, 100);
    let selected = toggleSemanticSelection(new Map(), first);
    selected = toggleSemanticSelection(selected, second);
    expect(selected.size).toBe(100);
    expect(toggleSemanticSelection(selected, [values[100]])).toBe(selected);
    selected = toggleSemanticSelection(selected, second);
    expect([...selected.keys()]).toEqual(first.map(item => item.id));
    const fresh = { ...first[0], active_revision_id: "changed-head", revision_number: 2 };
    selected = reconcileSemanticSelection(selected, [fresh]);
    expect(selected.get(fresh.id)).toEqual({ entry: first[0], needsReview: true });
    expect(removeSemanticSelection(selected, [fresh.id]).size).toBe(49);
    expect(selected.get(fresh.id)?.entry.active_revision_id).toBe("head-1");
  });

  it("rejects wrong, partial, duplicate, foreign and unchanged acknowledgements", () => {
    const entries = values.slice(0, 2), items = entries.map(item => ({ ...item, active_revision_id: `${item.id}-ignored`, revision_number: 2, is_active: false }));
    const receipt = { action: "ignore", items, queued_entry_ids: [] };
    expect(inspectSemanticBatchResult(receipt, "selection-project", "ignore", entries)).toBe(receipt);
    for (const bad of [ { ...receipt, action: "restore" }, { ...receipt, items: items.slice(0, 1) }, { ...receipt, items: [items[0], items[0]] },
      { ...receipt, items: [items[0], { ...items[1], project_id: "elsewhere" }] }, { ...receipt, items: entries } ]) {
      expect(() => inspectSemanticBatchResult(bad, "selection-project", "ignore", entries)).toThrow();
    }
    const queued = { action: "queue_validation", items: entries, queued_entry_ids: entries.map(item => item.id), validation_job_id: "validation", validation_status: "queued" };
    expect(inspectSemanticBatchResult(queued, "selection-project", "queue_validation", entries)).toBe(queued);
    expect(() => inspectSemanticBatchResult({ ...queued, queued_entry_ids: [entries[0].id, entries[0].id] }, "selection-project", "queue_validation", entries)).toThrow();
  });

  it("keeps selection through paging, filtering and locale, and reviews/removes without writes", async () => {
    const post = vi.spyOn(api, "post"); const { rerender } = render(workspace());
    await screen.findByText("共 101 条"); fireEvent.click(screen.getByLabelText(copy.list.selectPage));
    fireEvent.click(screen.getByLabelText(copy.pagination.next));
    await waitFor(() => expect(screen.getByLabelText(copy.list.selectPage)).toBeEnabled());
    expect(screen.getByText("已选 50 条")).toBeInTheDocument(); expect(screen.getByLabelText(copy.list.selectPage)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(copy.list.selectPage)); expect(screen.getByText("已选 100 条")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(copy.list.selectPage)); expect(screen.getByText("已选 50 条")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: copy.search.label }), { target: { value: "101" } });
    await screen.findByText("共 1 条"); expect(screen.getByText("50 条不在本页")).toBeInTheDocument();
    review(); await waitFor(() => expect(within(dialog()).getByRole("region", { name: copy.selection.items })).toHaveFocus());
    expect(within(dialog()).getAllByRole("listitem")).toHaveLength(50);
    expect(within(dialog()).queryByText(/private-key|head-1/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "取消选择 经营定义 1" }));
    expect(within(dialog()).getAllByRole("listitem")).toHaveLength(49);
    expect(within(dialog()).getByRole("button", { name: "取消选择 经营定义 2" })).toHaveFocus();
    rerender(workspace(true)); expect(screen.getByRole("dialog", { name: en.projectUnderstanding.selection.title })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "经营定义 2" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("button", { name: en.projectUnderstanding.selection.review })).toHaveFocus(); expect(post).not.toHaveBeenCalled();
  });

  it("requires an explicit action, locks duplicate submits, and sends exact cross-page heads", async () => {
    let settle: (value: unknown) => void = () => {};
    const post = vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    render(workspace()); await screen.findByText("共 101 条");
    fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByLabelText("选择 经营定义 1"));
    fireEvent.click(screen.getByLabelText(copy.pagination.next)); await screen.findAllByText("经营定义 51");
    fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByLabelText("选择 经营定义 51")); review();
    expect(within(dialog()).getByRole("button", { name: copy.selection.chooseAction })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /忽略/ }));
    expect(post).not.toHaveBeenCalled();
    const confirm = within(dialog()).getByRole("button", { name: "忽略 2 条" }); fireEvent.click(confirm); fireEvent.click(confirm);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/projects/selection-project/knowledge/batch", { action: "ignore", items: [
      { entry_id: "entry-1", expected_active_revision_id: "head-1" }, { entry_id: "entry-51", expected_active_revision_id: "head-51" },
    ] });
    expect(within(dialog()).getByRole("button", { name: copy.selection.close })).toBeDisabled();
    fireEvent.keyDown(dialog(), { key: "Escape" }); expect(dialog()).toBeInTheDocument();
    await act(async () => { settle(response({ action: "ignore", queued_entry_ids: [], items: [values[0], values[50]].map(item => ({ ...item, is_active: false, active_revision_id: `${item.id}-ignored`, revision_number: 2 })) })); });
    expect(screen.queryByRole("dialog", { name: copy.selection.title })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: copy.list.aria })).getByText("已将 2 条移出当前列表。")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: copy.search.label })).toHaveFocus();
  });

  it("preserves old selection after refresh and blocks changed or unconfirmed results", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(response({ action: "ignore", items: [], queued_entry_ids: [] }) as never);
    render(workspace()); await screen.findByText("共 101 条");
    fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByLabelText("选择 经营定义 1"));
    values[0] = { ...values[0], active_revision_id: "changed-head", revision_number: 2 };
    fireEvent.click(screen.getByLabelText(copy.list.refresh)); await waitFor(() => expect(screen.getByLabelText(copy.list.selectPage)).toBeEnabled()); review();
    expect(within(dialog()).getByText(copy.selection.changedItem)).toBeInTheDocument();
    expect(within(dialog()).getByRole("radio", { name: /忽略/ })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "取消选择 经营定义 1" }));
    fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByLabelText("选择 经营定义 1")); review();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /忽略/ })); fireEvent.click(within(dialog()).getByRole("button", { name: "忽略 1 条" }));
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toHaveTextContent(copy.selection.unconfirmed));
    expect(within(dialog()).getByRole("radio", { name: /忽略/ })).toBeDisabled(); expect(post).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().refreshCurrent).not.toHaveBeenCalled();
  });

  it("does not update the next project after a late batch reply", async () => {
    let settle: (value: unknown) => void = () => {};
    vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const { rerender } = render(workspace()); await screen.findByText("共 101 条");
    fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByLabelText("选择 经营定义 1")); review();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /忽略/ })); fireEvent.click(within(dialog()).getByRole("button", { name: "忽略 1 条" }));
    rerender(workspace(false, "new-project"));
    await act(async () => { settle(response({ action: "ignore", queued_entry_ids: [], items: [{ ...values[0], active_revision_id: "ignored", revision_number: 2, is_active: false }] })); });
    expect(screen.queryByRole("dialog", { name: copy.selection.title })).not.toBeInTheDocument();
    expect(useProjectStore.getState().refreshCurrent).not.toHaveBeenCalled();
  });
});
