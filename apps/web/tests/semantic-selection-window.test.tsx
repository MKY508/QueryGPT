import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SemanticSelectionDialog } from "@/components/semantic/SemanticSelectionDialog";
import { reconcileSemanticSelection, toggleSemanticSelection } from "@/lib/semantic-selection";
import type { SemanticEntry } from "@/lib/types/api";
import zh from "@/messages/zh.json";

const entry = (id: number): SemanticEntry => ({ id: String(id), project_id: "project", key: String(id), value: "经营说明",
  entry_type: "business_rule", state: "candidate", validity: "unverified", confidence: 1, evidence: [], source: "user", is_active: true,
  active_revision_id: "head-" + id, revision_number: 1, definition: {}, allowed_actions: ["ignore"], created_at: "2026-09-06", updated_at: "2026-09-06" });
const original = ["showModal", "close"].map(key => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key));
beforeEach(() => {
  for (const method of ["showModal", "close"]) Object.defineProperty(HTMLDialogElement.prototype, method, {
    configurable: true, value: function (this: HTMLDialogElement) { this.open = method === "showModal"; },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  ["showModal", "close"].forEach((key, index) => {
    const descriptor = original[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  });
});

it("keeps exact chosen revisions and rejects an oversized selection atomically", () => {
  const items = Array.from({ length: 100 }, (_, i) => entry(i));
  const chosen = toggleSemanticSelection(new Map(), items);
  expect(toggleSemanticSelection(chosen, [entry(101)])).toBe(chosen);
  const changed = reconcileSemanticSelection(chosen, [{ ...items[0], active_revision_id: "new-head" }]);
  expect(changed.get("0")).toEqual({ entry: items[0], needsReview: true });
  expect(chosen.get("0")?.needsReview).toBe(false);
});

it("requires an action and blocks changed selections, empty selections, and busy dismissal", () => {
  const apply = vi.fn(), close = vi.fn();
  const selection = toggleSemanticSelection(new Map(), [entry(1)]);
  const view = (busy = false, entries = selection) => <NextIntlClientProvider locale="zh" messages={zh}>
    <SemanticSelectionDialog selection={entries} visibleIds={new Set(["1"])} busy={busy} error={null}
      present={item => ({ title: item.id, description: item.value, scope: "门店" })} allowed={() => true}
      onRemove={vi.fn()} onApply={apply} onClose={close} />
  </NextIntlClientProvider>;
  const { rerender } = render(view());
  expect(screen.getByRole("button", { name: zh.projectUnderstanding.selection.chooseAction })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /忽略/ }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "忽略 1 条" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith("ignore");
  rerender(view(true));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  rerender(view(false, reconcileSemanticSelection(selection, [{ ...entry(1), active_revision_id: "changed" }])));
  expect(screen.getByRole("button", { name: "忽略 1 条" })).toBeDisabled();
  rerender(view(false, new Map()));
  expect(screen.getByRole("button", { name: "忽略 0 条" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", isComposing: true });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
