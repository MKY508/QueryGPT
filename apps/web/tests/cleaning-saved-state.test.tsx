import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editableSavedOperation as parse, inspectSavedVisualCleaningOperations as inspect } from "@/lib/cleaning-saved-state";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const steps: VisualCleaningOperation[] = [
  { operation: "trim_text", column: " name " },
  { operation: "normalize_currency", column: "amount" },
  { operation: "normalize_datetime", column: "date" },
  { operation: "fill_missing", column: "amount", value: 0 },
  { operation: "drop_exact_duplicates" },
  { operation: "replace_text_values", column: " name ", replacements: [{ from_value: " A\n", to_value: "B\t" }] },
];
const canonical = steps.map(step => ({ ...step, contract_version: 1, replayed: true,
  ...(step.operation === "trim_text" ? { error_policy: "preserve_original" } : {}),
  ...(["normalize_currency", "normalize_datetime"].includes(step.operation) ? { error_policy: "set_null" } : {}),
  ...(step.operation === "drop_exact_duplicates" ? { count: 3 } : {}),
}));
const source: ProjectDataSource = { id: "saved-source", project_id: "saved-project", name: "订单.csv", kind: "file", status: "ready", profile_data: {}, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 1, columns: 3, sample: [] }, after: { rows: 1, columns: 3, sample: [] }, changes: [] };
const original = useProjectStore.getState();
const onClose = vi.fn();
const view = (value: ProjectDataSource) => <NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={value} columns={[" name ", "amount", "date"]} onClose={onClose} /></NextIntlClientProvider>;
const saved = (operations: unknown[]) => ({ ...source, profile_data: { visual_cleaning: { operations } } });
const response = (data: unknown) => ({ data: { data } });

beforeEach(() => {
  http.post.mockReset(); onClose.mockReset();
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState({ cleaningAction: null, cleaningPreviewBySource: {}, refreshCurrent: original.refreshCurrent }); });

describe("saved cleaning compatibility", () => {
  it("accepts all legacy and canonical v1 shapes without modifying their input", () => {
    const before = JSON.stringify(canonical);
    expect(steps.map(parse)).toEqual(steps);
    expect(canonical.map(parse)).toEqual(steps);
    expect(inspect({ operations: canonical, active_revision_id: "receipt" }).hasUnsupportedOperations).toBe(false);
    expect(JSON.stringify(canonical)).toBe(before);
    const replacements = parse(canonical[5]);
    expect(replacements?.operation).toBe("replace_text_values");
    if (replacements?.operation === "replace_text_values") replacements.replacements[0].to_value = "changed copy";
    expect(JSON.stringify(canonical)).toBe(before);
  });

  it("refuses unknown fields, versions, policies and coerced metadata for every operation", () => {
    for (const step of canonical) {
      for (const patch of [{ contract_version: 2 }, { contract_version: "1" }, { contract_version: null }, { replayed: "false" }, { replayed: null }, { future_option: true }]) {
        expect(parse({ ...step, ...patch }), JSON.stringify({ step: step.operation, patch })).toBeNull();
      }
    }
    for (const operation of ["trim_text", "normalize_datetime", "normalize_currency"]) {
      expect(parse({ operation, column: "amount", error_policy: "preserve_something_else" })).toBeNull();
      expect(parse({ operation, column: "amount", error_policy: null })).toBeNull();
    }
    for (const count of [-1, 1.5, "3", true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(parse({ operation: "drop_exact_duplicates", count })).toBeNull();
    for (const value of [false, "0", null, 1]) expect(parse({ operation: "fill_missing", column: "amount", value })).toBeNull();
    expect(parse({ operation: "drop_exact_duplicates", columns: ["amount"] })).toBeNull();
    expect(parse({ operation: "constructor", column: "amount" })).toBeNull();
    expect(parse(Object.create({ operation: "trim_text", column: "amount" }))).toBeNull();
  });

  it("bounds method size and field length, retains blocked identities, and rejects duplicate or oversized mappings", () => {
    expect(parse({ operation: "trim_text", column: "😺".repeat(10_000) })).not.toBeNull();
    expect(parse({ operation: "trim_text", column: "😺".repeat(10_001) })).toBeNull();
    const oversized = inspect({ operations: Array.from({ length: 101 }, (_, index) => ({ operation: "trim_text", column: String(index) })) });
    expect(oversized.hasUnsupportedOperations).toBe(true);
    expect(oversized.operations).toEqual([]);
    expect(oversized.blockedOperations).toHaveLength(100);
    expect(oversized.omittedOperations).toBe(1);
    const mixed = inspect({ operations: [steps[0], { ...steps[1], error_policy: "new_policy" }, steps[0]] });
    expect(mixed.operations).toEqual([steps[0]]);
    expect(mixed.blockedOperations).toHaveLength(2);
    expect(mixed.operationKeys).toContain("normalize_currency:amount");
    const groups = Array.from({ length: 11 }, (_, index) => ({ operation: "replace_text_values", column: String(index), replacements: Array.from({ length: 100 }, (_, pair) => ({ from_value: String(pair), to_value: "renamed" })) }));
    expect(inspect({ operations: groups.slice(0, 10) }).hasUnsupportedOperations).toBe(false);
    expect(inspect({ operations: groups }).hasUnsupportedOperations).toBe(true);
    for (const value of ["broken", [], { operations: null }, { operations: "broken" }]) expect(inspect(value).hasUnsupportedOperations).toBe(true);
    for (const value of [null, undefined, {}, { operations: [] }]) expect(inspect(value).hasUnsupportedOperations).toBe(false);
  });

  it("keeps incompatible steps inspectable without offering mutation controls or leaking extra fields", () => {
    const bad = saved([steps[0], ...Array.from({ length: 10 }, () => ({ ...steps[1], error_policy: "new_policy", hidden_note: "PRIVATE_DETAIL" }))]);
    const untouched = JSON.stringify(bad);
    render(view(bad));
    expect(screen.getByRole("region", { name: "暂不可编辑的步骤" })).toBeInTheDocument();
    expect(screen.getAllByText("已保留")).toHaveLength(8);
    expect(screen.getByText("另有 2 步，原有内容仍保留。")).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_DETAIL|error_policy|new_policy/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /移除整理步骤/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^本次使用步骤/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销步骤编辑" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "预览变化" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", metaKey: true });
    expect(http.post).not.toHaveBeenCalled();
    expect(JSON.stringify(bad)).toBe(untouched);
  });

  it("invalidates an in-flight preview on an incompatible refresh while preserving the local draft", async () => {
    let finish!: (result: unknown) => void;
    http.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(view(saved([steps[0]])));
    fireEvent.click(screen.getByRole("button", { name: /^空值填 0/ }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    rerender(view(saved([{ ...steps[0], contract_version: 2 }])));
    expect(useProjectStore.getState().cleaningAction).toBeNull();
    expect(screen.getAllByRole("button", { name: /移除整理步骤/ })).toHaveLength(2);
    await act(async () => finish(response(preview)));
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    expect(screen.queryByRole("button", { name: "应用整理" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(http.post).toHaveBeenCalledTimes(1);
    rerender(view({ ...saved(canonical), id: "new-source" }));
    expect(screen.getByRole("button", { name: "预览变化" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "暂不可编辑的步骤" })).not.toBeInTheDocument();
  });

  it("previews and applies known canonical rules using only their equivalent editable operations", async () => {
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    render(view(saved(canonical)));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用整理" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(http.post.mock.calls[0][1]).toEqual({ operations: steps });
    expect(http.post.mock.calls[1][1].operations).toEqual(steps);
    expect(http.post.mock.calls[1][1].expected_operations_hash).toBe(preview.operations_hash);
  });
});
