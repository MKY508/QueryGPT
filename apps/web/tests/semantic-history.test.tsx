import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticHistoryDialog } from "@/components/semantic/SemanticHistoryDialog";
import { ProjectUnderstandingWorkspace } from "@/components/semantic/ProjectUnderstandingWorkspace";
import { inspectSemanticHistory, readSemanticHistory, restoreSemanticHistory, revisionEntry, semanticHistoryChanges, SemanticHistoryConflict } from "@/lib/semantic-history";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { SemanticEntry, SemanticEntryRevision } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";

const current: SemanticEntry = { id: "definition", project_id: "history-project", key: "internal-definition-key", value: "实付金额扣除退款", entry_type: "business_rule",
  state: "confirmed", validity: "active", is_active: true, confidence: 1, execution_state: "definition_only", execution_details: {}, evidence: [], source: "user",
  definition: { business_name: "净收入", description: "实付金额扣除退款" }, allowed_actions: ["ignore"], active_revision_id: "revision-3", revision_number: 3, scope_id: null,
  created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-06T10:00:00Z" };
const revision = (number: number, value = current.value): SemanticEntryRevision => ({ id: `revision-${number}`, project_id: current.project_id, semantic_entry_id: current.id,
  revision_number: number, parent_revision_id: number > 1 ? `revision-${number - 1}` : null, restored_from_revision_id: null, mutation_kind: "updated", actor_source: "user", reason: "internal-reason-not-for-the-panel", source_correction_id: null,
  snapshot: { key: current.key, value, entry_type: "business_rule", state: "confirmed", validity: "active", confidence: 1, is_active: true, source: "user", definition: { business_name: "净收入", description: value }, evidence: [], execution_state: "definition_only", execution_details: {}, scope_id: null }, created_at: "2026-09-01T10:00:00Z" });
const revisions = [revision(3), revision(2, "按开票金额确认收入"), revision(1, " A\t\n")];
const response = (data: unknown) => ({ data: { data } });
const present = (entry: SemanticEntry) => ({ title: "净收入", description: entry.value, type: "业务口径", state: "已采用", formula: null, synonyms: [] });
let restoreDialogs: () => void;
const originalStore = useProjectStore.getState();
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(false); useProjectStore.setState({ refreshCurrent: vi.fn().mockResolvedValue(undefined) }); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(originalStore, true); });
const view = (onRestored = vi.fn(), onClose = vi.fn(), english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <SemanticHistoryDialog projectId={current.project_id} entryId={current.id} label="净收入" present={present} onRestored={onRestored} onClose={onClose} />
</NextIntlClientProvider>;
const choose = (number: number) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^版本 ${number}(?: ·| )`) }));
const restore = () => fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.restore }));
const confirm = () => fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.confirmRestore }));
const mockRead = () => vi.spyOn(api, "get").mockImplementation(async url => response(url.endsWith("/revisions") ? revisions : current) as never);

describe("definition history", () => {
  it("checks scope/head identity and keeps historical whitespace and metadata separate from the current entry", async () => {
    const history = inspectSemanticHistory(current, [...revisions].reverse(), current.project_id, current.id);
    expect(history.revisions.map(item => item.revision_number)).toEqual([3, 2, 1]);
    expect(revisionEntry(history.revisions[2]).value).toBe(" A\t\n"); expect(revisionEntry(history.revisions[2])).not.toHaveProperty("source_refs");
    expect(semanticHistoryChanges(current, revisions[1])).toEqual(["meaning", "definition"]);
    expect(semanticHistoryChanges(current, { ...revisions[0], snapshot: { ...revisions[0].snapshot, definition: { description: current.value, business_name: "净收入" } } })).toEqual([]);
    expect(() => inspectSemanticHistory({ ...current, project_id: "other" }, revisions, current.project_id, current.id)).toThrow();
    expect(() => inspectSemanticHistory(current, [{ ...revisions[0], semantic_entry_id: "other" }], current.project_id, current.id)).toThrow();
    expect(() => inspectSemanticHistory(current, [...revisions, revisions[0]], current.project_id, current.id)).toThrow();
    expect(() => inspectSemanticHistory({ ...current, active_revision_id: "new-head" }, revisions, current.project_id, current.id)).toThrow(SemanticHistoryConflict);
    expect(() => inspectSemanticHistory(current, [], current.project_id, current.id)).toThrow(SemanticHistoryConflict);
    const get = mockRead(), signal = new AbortController().signal;
    await readSemanticHistory(current.project_id, current.id, signal);
    expect(get).toHaveBeenCalledTimes(2); expect(get.mock.calls.every(call => call[1]?.signal === signal)).toBe(true);
  });

  it("reads before offering a comparison and requires a second confirmation bound to the displayed fresh head", async () => {
    mockRead(); const post = vi.spyOn(api, "post");
    let settle: (value: unknown) => void = () => {}; post.mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const onRestored = vi.fn(), onClose = vi.fn(); render(view(onRestored, onClose));
    await screen.findByRole("button", { name: /^版本 2 / }); choose(2);
    expect(within(screen.getByRole("region", { name: "当前定义" })).getByText(current.value)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "所选版本 2" })).getByText(revisions[1].snapshot.value)).toBeInTheDocument();
    expect(screen.queryByText("internal-definition-key")).not.toBeInTheDocument(); expect(screen.queryByText("internal-reason-not-for-the-panel")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled(); restore(); expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "恢复版本 2？" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.cancelRestore }));
    expect(screen.getByRole("button", { name: zh.semanticHistory.restore })).toHaveFocus(); restore(); confirm();
    expect(post).toHaveBeenCalledExactlyOnceWith(`/api/v1/projects/${current.project_id}/knowledge/${current.id}/revisions/revision-2/restore`, { expected_active_revision_id: "revision-3" });
    expect(screen.getByRole("button", { name: zh.semanticHistory.close })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(onClose).not.toHaveBeenCalled();
    const saved = { ...current, value: revisions[1].snapshot.value, active_revision_id: "revision-4", revision_number: 4 };
    await act(async () => { settle(response(saved)); });
    expect(onRestored).toHaveBeenCalledExactlyOnceWith(saved); expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects restoration receipts for another definition or an unchanged head", async () => {
    const history = inspectSemanticHistory(current, revisions, current.project_id, current.id);
    const post = vi.spyOn(api, "post").mockResolvedValue(response({ ...current, id: "another", active_revision_id: "revision-4", revision_number: 4 }) as never);
    await expect(restoreSemanticHistory(history, "revision-2")).rejects.toThrow("Unconfirmed restoration response");
    post.mockResolvedValueOnce(response(current) as never);
    await expect(restoreSemanticHistory(history, "revision-2")).rejects.toThrow("Unconfirmed restoration response");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each([409, undefined])("requires a fresh read after an unconfirmed or conflicting restore (%s), never an automatic retry", async status => {
    let latest = current, items = revisions;
    vi.spyOn(api, "get").mockImplementation(async url => response(url.endsWith("/revisions") ? items : latest) as never);
    const post = vi.spyOn(api, "post").mockRejectedValue(status ? { response: { status } } : new Error("Lost response"));
    render(view()); await screen.findByRole("button", { name: /^版本 2 / }); choose(2); restore(); confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent(status ? zh.semanticHistory.conflict : zh.semanticHistory.uncertain);
    expect(screen.getByRole("button", { name: zh.semanticHistory.reload })).toHaveFocus();
    expect(screen.queryByRole("button", { name: zh.semanticHistory.confirmRestore })).not.toBeInTheDocument(); expect(post).toHaveBeenCalledTimes(1);
    latest = { ...current, active_revision_id: "revision-4", revision_number: 4 }; items = [revision(4), ...revisions];
    fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.reload })); await screen.findByRole("button", { name: /^版本 4 / });
    expect(post).toHaveBeenCalledTimes(1); choose(2); restore(); confirm();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2)); expect(post.mock.calls[1][1]).toEqual({ expected_active_revision_id: "revision-4" });
  });

  it("bounds displayed versions, keeps selection across locale/return, and refuses current or removed snapshots", async () => {
    const latest = { ...current, active_revision_id: "revision-25", revision_number: 25 };
    const many = Array.from({ length: 25 }, (_, i) => revision(25 - i)); many[1].snapshot.is_active = false;
    vi.spyOn(api, "get").mockImplementation(async url => response(url.endsWith("/revisions") ? many : latest) as never);
    const { rerender } = render(view()); await screen.findByRole("button", { name: /^版本 25 / });
    expect(screen.getAllByRole("button", { name: /^版本 / })).toHaveLength(20);
    expect(screen.getByRole("button", { name: zh.semanticHistory.restore })).toBeDisabled();
    choose(24); expect(screen.getByText(zh.semanticHistory.inactiveVersion)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh.semanticHistory.restore })).toBeDisabled();
    expect(screen.getByRole("navigation", { name: zh.semanticHistory.versions })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.more })); expect(screen.getByRole("button", { name: /^版本 5 / })).toHaveFocus();
    choose(2); rerender(view(undefined, undefined, true)); expect(screen.getByRole("button", { name: /^Version 2 / })).toHaveAttribute("aria-pressed", "true");
    const post = vi.spyOn(api, "post");
    await expect(restoreSemanticHistory({ current: latest, revisions: many }, "revision-24")).rejects.toThrow(); expect(post).not.toHaveBeenCalled();
  });

  it("aborts closed reads and ignores late restoration callbacks after the owning dialog is unmounted", async () => {
    const requests: AbortSignal[] = [];
    vi.spyOn(api, "get").mockImplementation((_url, options) => { requests.push(options?.signal as AbortSignal); return new Promise(() => {}) as never; });
    const closedRead = render(view()); closedRead.unmount(); expect(requests).toHaveLength(2); expect(requests.every(signal => signal.aborted)).toBe(true);
    mockRead(); let settle: (value: unknown) => void = () => {};
    vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const onRestored = vi.fn(), onClose = vi.fn(), opened = render(view(onRestored, onClose));
    await screen.findByRole("button", { name: /^版本 2 / }); choose(2); restore(); confirm(); opened.unmount();
    await act(async () => { settle(response({ ...current, active_revision_id: "revision-4", revision_number: 4 })); });
    expect(onRestored).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });

  it("connects the workspace history entry and replaces the displayed definition only after an acknowledged restore", async () => {
    let head = current;
    vi.spyOn(api, "get").mockImplementation(async url => {
      if (url.endsWith("/sources") || url.endsWith("/semantic-scopes")) return response([]) as never;
      if (url.endsWith("/knowledge/page")) return response({ items: [head], total: 1, offset: 0, limit: 50, has_more: false }) as never;
      if (url.endsWith("/revisions")) return response(revisions) as never;
      if (url.endsWith("/definition")) return response(head) as never;
      return response({ id: current.project_id, name: "九月经营" }) as never;
    });
    const post = vi.spyOn(api, "post").mockImplementation(async () => { head = { ...current, value: revisions[1].snapshot.value, definition: revisions[1].snapshot.definition,
      active_revision_id: "revision-4", revision_number: 4 }; return response(head) as never; });
    const workspace = (english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}><ProjectUnderstandingWorkspace projectId={current.project_id} /></NextIntlClientProvider>;
    const { rerender } = render(workspace());
    await screen.findByText("共 1 条"); fireEvent.click(within(screen.getByTestId("semantic-table-list")).getByText("净收入"));
    fireEvent.click(screen.getByRole("button", { name: zh.projectUnderstanding.actions.history }));
    await screen.findByRole("button", { name: /^版本 2 / }); choose(2);
    rerender(workspace(true));
    expect(within(screen.getByRole("region", { name: "Selected version 2" })).getByText(revisions[1].snapshot.value)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Current definition" })).getByText(current.value)).toBeInTheDocument();
    rerender(workspace()); restore(); confirm();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: zh.semanticHistory.title })).not.toBeInTheDocument());
    const detail = screen.getByRole("complementary", { name: "净收入" });
    expect(within(detail).getByText(revisions[1].snapshot.value)).toBeInTheDocument();
    expect(within(detail).getByText(zh.projectUnderstanding.feedback.historyRestored)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
