import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectUnderstandingWorkspace } from "@/components/semantic/ProjectUnderstandingWorkspace";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { SemanticEntry } from "@/lib/types/api";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const copy = zh.projectUnderstanding;
const entry: SemanticEntry = { id: "net-revenue", project_id: "editor-project", key: "internal-net-revenue", value: "实付金额扣除已完成退款", entry_type: "business_rule",
  state: "confirmed", validity: "active", confidence: 1, evidence: [], source: "user", is_active: true, active_revision_id: "original-head", revision_number: 3,
  definition: { business_name: "净收入", description: "实付金额扣除已完成退款" }, allowed_actions: ["ignore"], created_at: "2026-09-06", updated_at: "2026-09-06" };
const response = (data: unknown) => ({ data: { data } });
const original = useProjectStore.getState();
let restoreDialogs: () => void;
const workspace = (english = false, projectId = entry.project_id) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <ProjectUnderstandingWorkspace projectId={projectId} />
</NextIntlClientProvider>;
beforeEach(() => {
  restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(false);
  useProjectStore.setState({ refreshCurrent: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(api, "get").mockImplementation(async url => response(url.endsWith("/knowledge/page") ? { items: [entry], total: 1, offset: 0, limit: 50, has_more: false }
    : url.endsWith("/sources") || url.endsWith("/semantic-scopes") ? [] : { id: url.split("/").at(-1), name: "九月经营" }) as never);
});
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(original, true); });
const editor = () => screen.getByRole("dialog", { name: copy.editor.editTitle });
const input = () => within(editor()).getByRole("textbox", { name: copy.editor.businessDefinition });
async function launch() {
  await screen.findByText("共 1 条"); fireEvent.click(screen.getByRole("button", { name: copy.list.viewEntry.replace("{title}", "净收入") }));
  const trigger = screen.getByRole("button", { name: copy.actions.editDefinition }); trigger.focus(); fireEvent.click(trigger);
  await waitFor(() => expect(within(editor()).getByRole("textbox", { name: copy.editor.name })).toHaveFocus());
}
const close = () => { const button = within(editor()).getByRole("button", { name: copy.editor.close }); button.focus(); fireEvent.click(button); };
const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
const cancel = (node: HTMLElement) => fireEvent(node, new Event("cancel", { cancelable: true, bubbles: false }));

describe("business definition draft exit", () => {
  it("closes untouched and exactly reverted drafts quietly, but protects actual text and added definitions", async () => {
    const post = vi.spyOn(api, "post"), put = vi.spyOn(api, "put"); render(workspace()); await launch();
    expect(unload()).toBe(false); close(); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.actions.editDefinition }));
    const field = input(), baseline = (field as HTMLTextAreaElement).value;
    fireEvent.change(field, { target: { value: `${baseline} ` } }); expect(unload()).toBe(true);
    fireEvent.change(field, { target: { value: baseline } }); expect(unload()).toBe(false); close();
    fireEvent.click(screen.getByRole("button", { name: copy.actions.addDefinition }));
    fireEvent.change(screen.getByRole("textbox", { name: copy.editor.name }), { target: { value: "待完善的定义" } });
    fireEvent.click(screen.getByRole("button", { name: copy.actions.cancel }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(copy.editor.discardTitle);
    fireEvent.click(screen.getByRole("button", { name: copy.editor.discardAndClose }));
    expect(unload()).toBe(false); expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });

  it("retains input, locale and focus when continuing, and requires explicit discard after Escape", async () => {
    const { rerender } = render(workspace()); await launch();
    fireEvent.change(input(), { target: { value: "  本次输入\t\n" } }); input().focus();
    fireEvent.keyDown(input(), { key: "Escape", isComposing: true }); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.getByRole("button", { name: copy.editor.continueEditing })).toHaveFocus();
    rerender(workspace(true));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(en.projectUnderstanding.editor.discardTitle);
    cancel(screen.getByRole("alertdialog"));
    expect(screen.getByRole("textbox", { name: en.projectUnderstanding.editor.businessDefinition })).toHaveValue("  本次输入\t\n");
    expect(screen.getByRole("textbox", { name: en.projectUnderstanding.editor.businessDefinition })).toHaveFocus();
    await act(async () => { rerender(workspace()); }); close();
    fireEvent.click(screen.getByRole("button", { name: copy.editor.discardAndClose }));
    expect(screen.queryByRole("dialog", { name: copy.editor.editTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.actions.editDefinition })).toHaveFocus(); expect(unload()).toBe(false);
  });

  it("locks all controls and duplicate submit while saving, then closes without discard confirmation", async () => {
    let settle: (result: unknown) => void = () => {};
    const put = vi.spyOn(api, "put").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    render(workspace()); await launch(); fireEvent.change(input(), { target: { value: "修改后的定义" } });
    const form = input().closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(input()).toBeDisabled(); expect(within(editor()).getByRole("combobox", { name: copy.editor.owningScope })).toBeDisabled();
    expect(within(editor()).getByRole("button", { name: copy.editor.close })).toBeDisabled(); expect(unload()).toBe(true);
    cancel(editor()); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(put.mock.calls[0][1]).toMatchObject({ expected_active_revision_id: "original-head", value: "修改后的定义" });
    await act(async () => { settle(response({ ...entry, value: "修改后的定义", revision_number: 4, active_revision_id: "next-head" })); });
    expect(screen.queryByRole("dialog", { name: copy.editor.editTitle })).not.toBeInTheDocument(); expect(unload()).toBe(false);
  });

  it("keeps failed-save input editable and protected without retrying", async () => {
    const put = vi.spyOn(api, "put").mockRejectedValue(new Error("Lost response")); render(workspace()); await launch();
    fireEvent.change(input(), { target: { value: "保留这段输入" } }); fireEvent.submit(input().closest("form")!);
    expect(await within(editor()).findByRole("region", { name: zh.semanticSaveRecovery.title })).toHaveTextContent(zh.semanticSaveRecovery.uncertain);
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("保留这段输入"); expect(unload()).toBe(true);
    close(); cancel(screen.getByRole("alertdialog")); expect(put).toHaveBeenCalledTimes(1);
  });

  it("does not publish late saves or refresh another project after its editor session ends", async () => {
    let settle: (result: unknown) => void = () => {};
    vi.spyOn(api, "put").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const { rerender } = render(workspace()); await launch(); fireEvent.change(input(), { target: { value: "旧项目草稿" } }); fireEvent.submit(input().closest("form")!);
    await waitFor(() => expect(api.put).toHaveBeenCalledOnce()); rerender(workspace(false, "new-project"));
    await act(async () => { settle(response({ ...entry, active_revision_id: "next-head", revision_number: 4 })); });
    expect(screen.queryByRole("dialog", { name: copy.editor.editTitle })).not.toBeInTheDocument();
    expect(useProjectStore.getState().refreshCurrent).not.toHaveBeenCalled(); expect(unload()).toBe(false);
  });
});
