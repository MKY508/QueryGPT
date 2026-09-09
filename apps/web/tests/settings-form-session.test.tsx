import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsFormEqual, useSettingsFormSession } from "@/components/settings/hooks/useSettingsFormSession";
import { SettingsExitProvider } from "@/components/settings/SettingsExitGuard";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

const initial = { name: "", password: "", enabled: false, port: 5432 };
type Value = typeof initial;
let session: Pick<ReturnType<typeof useSettingsFormSession<Value>>, "setFormData" | "create" | "submit" | "close" | "edit" | "writeBusy" | "dismissUnavailable">;
let restoreDialogs: () => void;
const changed = vi.fn();
function Form({ active = true, resolve = () => null }: { active?: boolean; resolve?: (id: string) => Value | null }) {
  const { formRef, addRef, create, edit, close, showForm, formData, setFormData, unavailable,
    confirmation, submit, writeBusy, dismissUnavailable } = useSettingsFormSession({ initial, active, busy: false, kind: "connections", resolveEdit: resolve, onTransition: changed });
  useLayoutEffect(() => { session = { create, edit, close, setFormData, submit, writeBusy, dismissUnavailable }; });
  return <>
    <button ref={addRef} onClick={create}>Add</button>
    <button onClick={() => edit("a")}>Edit A</button><button onClick={() => edit("b")}>Edit B</button>
    {showForm && <form ref={formRef}>
      <input aria-label="Name" value={formData.name} onChange={event => setFormData(value => ({ ...value, name: event.target.value }))} />
      <button type="button" onClick={close}>Close</button>
    </form>}
    {unavailable && <p role="alert">{unavailable}</p>}
    {confirmation}
  </>;
}
function view(props: Parameters<typeof Form>[0] = {}, locale: "en" | "zh" = "zh") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><SettingsExitProvider><Form {...props} /></SettingsExitProvider></NextIntlClientProvider>;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const editName = (name: string) => fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
const unloadBlocked = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe("settings form session", () => {
  beforeEach(() => { restoreDialogs = mockSemanticDialogs(); changed.mockClear(); });
  afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

  it("compares authored values and closes unchanged or reverted forms without confirmation", () => {
    expect(settingsFormEqual({ port: NaN, enabled: false }, { enabled: false, port: NaN })).toBe(true);
    expect(settingsFormEqual({ name: " " }, { name: "" })).toBe(false);
    expect(settingsFormEqual({ enabled: false }, { enabled: true })).toBe(false);
    expect(settingsFormEqual(["x"], { 0: "x" })).toBe(false);
    render(view());
    click("Add"); expect(unloadBlocked()).toBe(false); click("Close");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    click("Add"); editName("draft"); expect(unloadBlocked()).toBe(true);
    editName(""); expect(unloadBlocked()).toBe(false); click("Close");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the draft on reselect or continue, and clears it only after explicit discard", () => {
    render(view()); click("Add"); editName("Unsaved warehouse");
    click("Add"); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved warehouse");
    click("Close"); expect(screen.getByRole("alertdialog")).toHaveAccessibleName(zh.settingsUnsaved.title);
    expect(screen.getByRole("button", { name: zh.settingsUnsaved.continueEditing })).toHaveFocus();
    click(zh.settingsUnsaved.continueEditing);
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved warehouse");
    click("Close"); click(zh.settingsUnsaved.discardClose);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(false); click("Add"); expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("resolves replacements at consent time and does not consume a draft when the target disappears", () => {
    const records: Record<string, Value> = { a: { ...initial, name: "Alpha" }, b: { ...initial, name: "Beta" } };
    const resolve = (id: string) => records[id] ?? null;
    render(view({ resolve })); click("Edit A"); editName("Alpha draft"); click("Edit A");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    click("Edit B"); records.b = { ...initial, name: "Beta refreshed" }; click(zh.settingsUnsaved.discardReplace);
    expect(screen.getByLabelText("Name")).toHaveValue("Beta refreshed"); expect(unloadBlocked()).toBe(false);
    editName("Beta draft"); click("Edit A"); delete records.a; click(zh.settingsUnsaved.discardReplace);
    expect(screen.getByRole("alert")).toHaveTextContent(zh.settingsUnsaved.unavailable);
    expect(screen.getByLabelText("Name")).toHaveValue("Beta draft"); expect(unloadBlocked()).toBe(true);
    act(() => session.dismissUnavailable()); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects stale consent and cancels a hidden confirmation without losing values or reviving it", () => {
    const { rerender } = render(view()); click("Add"); editName("First"); click("Close");
    act(() => session.setFormData(value => ({ ...value, name: "Later edit" })));
    click(zh.settingsUnsaved.discardClose);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(screen.getByLabelText("Name")).toHaveValue("Later edit");
    click("Close"); rerender(view({}, "en"));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(en.settingsUnsaved.title);
    rerender(view({ active: false }, "en"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(unloadBlocked()).toBe(true);
    act(() => session.create()); expect(screen.getByLabelText("Name")).toHaveValue("Later edit");
    rerender(view({}, "en")); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Later edit");
  });

  it("serializes writes, retains rejected input, clears accepted input and ignores late unmounted results", async () => {
    const { unmount } = render(view()); click("Add"); editName("Pending warehouse");
    const pending = deferred(), write = vi.fn(() => pending.promise);
    let outcome!: Promise<boolean | Error>;
    act(() => {
      outcome = session.submit(write).catch(error => error);
      void session.submit(write); session.close(); session.edit("a");
      session.setFormData({ ...initial, name: "Should be blocked" });
    });
    expect(write).toHaveBeenCalledTimes(1); expect(session.writeBusy).toBe(true); expect(unloadBlocked()).toBe(true);
    expect(screen.getByLabelText("Name")).toHaveValue("Pending warehouse");
    await act(async () => { pending.reject(new Error("Offline")); await outcome; });
    expect(session.writeBusy).toBe(false); expect(unloadBlocked()).toBe(true);
    expect(screen.getByLabelText("Name")).toHaveValue("Pending warehouse");
    await act(async () => { expect(await session.submit(async value => { expect(value.name).toBe("Pending warehouse"); })).toBe(true); });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument(); expect(unloadBlocked()).toBe(false);
    click("Add"); editName("Unmounting"); const late = deferred();
    act(() => { outcome = session.submit(() => late.promise); }); unmount();
    expect(unloadBlocked()).toBe(false);
    await act(async () => { late.resolve(); await outcome; });
  });
});
