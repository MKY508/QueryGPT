import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectUnderstandingWorkspace } from "@/components/semantic/ProjectUnderstandingWorkspace";
import { SemanticSaveRecovery } from "@/components/semantic/SemanticSaveRecovery";
import { inspectSemanticSaveEntry, readSemanticSaveTarget } from "@/lib/semantic-save-recovery";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { SemanticEntry } from "@/lib/types/api";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";

const copy = zh.projectUnderstanding, recovery = zh.semanticSaveRecovery;
const entry: SemanticEntry = { id: "definition", project_id: "recovery-project", key: "original-key", value: "原始业务口径", entry_type: "business_rule",
  state: "confirmed", validity: "active", confidence: 1, evidence: [], source: "user", is_active: true, active_revision_id: "head-3", revision_number: 3,
  definition: { business_name: "净收入", description: "原始业务口径" }, allowed_actions: ["ignore"], created_at: "2026-09-06", updated_at: "2026-09-06" };
const target = { projectId: entry.project_id, key: entry.key, entryId: entry.id, expectedHead: "head-3", previousVersion: 3 };
const latest: SemanticEntry = { ...entry, value: "Recognize revenue at payment", active_revision_id: "head-4", revision_number: 4,
  definition: { business_name: "Recognized revenue", description: "Recognize revenue at payment", synonyms: ["Paid revenue"] } };
const response = (data: unknown) => ({ data: { data } });
const original = useProjectStore.getState(); let restoreDialogs: () => void;
const wrap = (content: React.ReactNode) => <NextIntlClientProvider locale="zh" messages={zh}>{content}</NextIntlClientProvider>;
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(false); useProjectStore.setState({ refreshCurrent: vi.fn().mockResolvedValue(undefined) }); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(original, true); });
function mockRead(current: SemanticEntry | null = latest) {
  return vi.spyOn(api, "get").mockImplementation(async url => response(url.endsWith("/knowledge/page") ? { items: [entry], total: 1, offset: 0, limit: 50, has_more: false }
    : url.endsWith("/sources") || url.endsWith("/semantic-scopes") ? [] : url.endsWith("/definition") || url.endsWith("/lookup") ? current : { id: entry.project_id, name: "九月经营" }) as never);
}
async function launch(create = false) {
  render(wrap(<ProjectUnderstandingWorkspace projectId={entry.project_id} />)); await screen.findByText("共 1 条");
  if (create) fireEvent.click(screen.getByRole("button", { name: copy.actions.addDefinition }));
  else { fireEvent.click(screen.getByRole("button", { name: copy.list.viewEntry.replace("{title}", "净收入") })); fireEvent.click(screen.getByRole("button", { name: copy.actions.editDefinition })); }
  await waitFor(() => expect(screen.getByRole("textbox", { name: copy.editor.name })).toHaveFocus());
}
const name = () => screen.getByRole("textbox", { name: copy.editor.name });
const meaning = () => screen.getByRole("textbox", { name: copy.editor.businessDefinition });
const submit = () => fireEvent.submit(meaning().closest("form")!);
const panel = () => screen.getByRole("region", { name: recovery.title });
const read = () => fireEvent.click(within(panel()).getByRole("button", { name: recovery.read }));

describe("semantic save reconciliation", () => {
  it("checks save identity and new revision, and uses exact project/key lookup only for an unknown create ID", async () => {
    expect(inspectSemanticSaveEntry(latest, target, true)).toBe(latest);
    expect(() => inspectSemanticSaveEntry(latest, { ...target, content: { value: "Different", entryType: "business_rule", state: "confirmed", businessName: "Recognized revenue" } }, true)).toThrow("Unconfirmed definition content");
    for (const change of [{ id: "wrong" }, { project_id: "wrong" }, { key: "wrong" }, { active_revision_id: "head-3" }, { revision_number: 9 }, { allowed_actions: null }]) {
      expect(() => inspectSemanticSaveEntry({ ...latest, ...change }, target, true)).toThrow();
    }
    const get = vi.spyOn(api, "get").mockResolvedValue(response(null) as never), signal = new AbortController().signal;
    expect(await readSemanticSaveTarget({ projectId: "p/a", key: "a/b & c" }, signal)).toBeNull();
    expect(get).toHaveBeenCalledExactlyOnceWith("/api/v1/projects/p%2Fa/knowledge/lookup", { params: { key: "a/b & c" }, signal });
    await expect(readSemanticSaveTarget(target, signal)).rejects.toThrow();
  });

  it("keeps a conflicting form until explicit load, then saves against the inspected head without losing English names", async () => {
    const get = mockRead();
    const put = vi.spyOn(api, "put").mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce(response({ ...latest, value: "人工核对后的定义", active_revision_id: "head-5", revision_number: 5 }) as never);
    await launch(); fireEvent.change(meaning(), { target: { value: "  我的草稿\n" } }); submit();
    await screen.findByRole("region", { name: recovery.title });
    expect(get.mock.calls.some(call => call[0].endsWith("/definition"))).toBe(false);
    submit(); expect(put).toHaveBeenCalledTimes(1); read();
    expect(await within(panel()).findByRole("region", { name: recovery.saved })).toHaveTextContent(latest.value);
    expect(within(panel()).getByRole("region", { name: recovery.draft }).textContent).toContain("  我的草稿\n");
    expect(screen.queryByRole("button", { name: recovery.retry })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: recovery.load }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(recovery.loadTitle);
    fireEvent.click(screen.getByRole("button", { name: recovery.keep })); expect(meaning()).toHaveValue("  我的草稿\n");
    fireEvent.click(screen.getByRole("button", { name: recovery.load })); fireEvent.click(screen.getByRole("button", { name: recovery.confirmLoad }));
    expect(name()).toHaveValue("Recognized revenue"); expect(name()).toHaveFocus(); expect(meaning()).toHaveValue(latest.value);
    expect(screen.getByRole("textbox", { name: copy.editor.synonyms })).toHaveValue("Paid revenue");
    expect(put).toHaveBeenCalledTimes(1); fireEvent.change(meaning(), { target: { value: "人工核对后的定义" } }); submit();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2)); expect(put.mock.calls[1][1]).toMatchObject({ expected_active_revision_id: "head-4" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.editor.editTitle })).not.toBeInTheDocument());
  });

  it("keeps a create target stable across ambiguous responses and edited names; a read never retries the write", async () => {
    const get = mockRead(null); const post = vi.spyOn(api, "post").mockRejectedValue(new Error("Lost response"));
    await launch(true); fireEvent.change(name(), { target: { value: "新定义" } }); fireEvent.change(meaning(), { target: { value: "按支付月份统计" } }); submit();
    await screen.findByRole("region", { name: recovery.title }); const key = (post.mock.calls[0][1] as { key: string }).key;
    fireEvent.change(name(), { target: { value: "更清楚的名称" } }); submit(); expect(post).toHaveBeenCalledTimes(1);
    read(); await screen.findByText(recovery.notFound); expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.find(call => call[0].endsWith("/lookup"))?.[1]?.params).toEqual({ key });
    fireEvent.click(screen.getByRole("button", { name: recovery.retry })); expect(name()).toHaveValue("更清楚的名称");
    submit(); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toMatchObject({ key, definition: { business_name: "更清楚的名称" } });
    await screen.findByRole("region", { name: recovery.title });
  });

  it("does not acknowledge an HTTP success carrying another definition, and permits a deliberate retry only after an unchanged head is read", async () => {
    mockRead(entry); const put = vi.spyOn(api, "put").mockResolvedValue(response({ ...latest, id: "wrong" }) as never);
    await launch(); fireEvent.change(meaning(), { target: { value: "保留当前输入" } }); submit();
    await screen.findByRole("region", { name: recovery.title }); expect(useProjectStore.getState().refreshCurrent).not.toHaveBeenCalled();
    expect(meaning()).toHaveValue("保留当前输入"); read(); await screen.findByRole("button", { name: recovery.retry });
    expect(put).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole("button", { name: recovery.retry }));
    expect(screen.getByRole("button", { name: copy.actions.saveChanges })).toBeEnabled(); expect(put).toHaveBeenCalledTimes(1);
  });

  it("blocks removed or misidentified reads and aborts pending reads on close", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValueOnce(response({ ...latest, is_active: false }) as never).mockResolvedValueOnce(response({ ...latest, project_id: "other" }) as never);
    const onLoad = vi.fn(), onRetry = vi.fn();
    const opened = render(wrap(<SemanticSaveRecovery target={target} conflict draft={{ title: "净收入", description: "草稿" }} present={e => ({ title: "净收入", description: e.value, type: "口径", state: "已采用", formula: null, synonyms: [] })}
      fallbackFocus={{ current: null }} onLoad={onLoad} onRetry={onRetry} />));
    read(); await screen.findByText(recovery.inactive); expect(screen.queryByRole("button", { name: recovery.load })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: recovery.retry })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: recovery.refresh })); await screen.findByText(recovery.readFailed);
    get.mockImplementationOnce(() => new Promise(() => {}) as never); fireEvent.click(screen.getByRole("button", { name: recovery.refresh }));
    const signal = get.mock.calls.at(-1)?.[1]?.signal as AbortSignal; opened.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => {}); expect(onLoad).not.toHaveBeenCalled(); expect(onRetry).not.toHaveBeenCalled();
  });
});
