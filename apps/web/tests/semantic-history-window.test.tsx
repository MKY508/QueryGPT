import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SemanticHistoryDialog } from "@/components/semantic/SemanticHistoryDialog";
import type { SemanticEntry, SemanticEntryRevision } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import zh from "@/messages/zh.json";
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

const descriptors = ["showModal", "close"].map(key => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key));
beforeEach(() => {
  for (const method of ["showModal", "close"]) Object.defineProperty(HTMLDialogElement.prototype, method, {
    configurable: true, value: function(this: HTMLDialogElement) { this.open = method === "showModal"; },
  });
  vi.spyOn(api, "get").mockImplementation(async url => {
    const id = url.includes("/other") ? "other" : current.id;
    return response(url.endsWith("/revisions") ? revisions.map(item => ({ ...item, semantic_entry_id: id })) : { ...current, id }) as never;
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  ["showModal", "close"].forEach((key, i) => {
    if (descriptors[i]) Object.defineProperty(HTMLDialogElement.prototype, key, descriptors[i]!);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  });
});
const view = (restored = vi.fn(), close = vi.fn(), id = current.id) => <NextIntlClientProvider locale="zh" messages={zh}>
  <SemanticHistoryDialog projectId={current.project_id} entryId={id} label="净收入" present={present} onRestored={restored} onClose={close} />
</NextIntlClientProvider>;
async function chooseAndConfirm() {
  fireEvent.click(await screen.findByRole("button", { name: /^版本 2 / }));
  fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.restore, exact: true }));
}
it("compares alongside the directory and restores only after explicit head-bound confirmation", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(response({ ...current, active_revision_id: "new-head", revision_number: 4 }));
  const restored = vi.fn(); render(view(restored));
  await chooseAndConfirm();
  expect(screen.getByRole("navigation", { name: zh.semanticHistory.versions })).toBeVisible();
  expect(post).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("heading", { name: "恢复版本 2？" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: zh.semanticHistory.restore, exact: true })).toHaveFocus();
  await chooseAndConfirm();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.confirmRestore })); });
  expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/projects/history-project/knowledge/definition/revisions/revision-2/restore", { expected_active_revision_id: "revision-3" });
  expect(restored).toHaveBeenCalledOnce();
});
it("does not deliver an old restoration into a newly selected definition session", async () => {
  let complete!: (value: unknown) => void;
  vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { complete = resolve; }) as never);
  const restored = vi.fn(), close = vi.fn(), result = render(view(restored, close));
  await chooseAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: zh.semanticHistory.confirmRestore }));
  result.rerender(view(restored, close, "other"));
  await screen.findByRole("button", { name: /^版本 3 / });
  await act(async () => { complete(response({ ...current, active_revision_id: "new-head", revision_number: 4 })); });
  expect(restored).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: zh.semanticHistory.restore, exact: true })).toBeDisabled();
});
