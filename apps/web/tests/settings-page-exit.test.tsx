import { useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsExitGuard } from "@/lib/settings/exit-guard";
import { SettingsExitProvider, SettingsExitLink } from "@/components/settings/SettingsExitGuard";
import { useSettingsFormSession } from "@/components/settings/hooks/useSettingsFormSession";
import { PreferencesSettings } from "@/components/settings/PreferencesSettings";
import { registerDesktopPageNavigationGuard, subscribeToDesktopNavigation, subscribeToDesktopClose, type DesktopPage, type DesktopCloseCommand, type DesktopCloseState } from "@/lib/desktop-app-info";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: vi.fn() }) }));
vi.mock("@/lib/actions/locale", () => ({ setLocale: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock("next/link", () => ({ default: ({ onNavigate, replace, scroll: _scroll, ...props }: Omit<ComponentProps<"a">, "onNavigate"> & { onNavigate?: (event: { preventDefault: () => void }) => void; replace?: boolean; scroll?: boolean }) =>
  <a {...props} onClick={event => { event.preventDefault(); let blocked = false; onNavigate?.({ preventDefault: () => { blocked = true; } }); if (!blocked) mocks[replace ? "replace" : "push"](props.href); }} /> }));

const initial = { name: "", password: "" };
let sessions: Record<string, ReturnType<typeof useSettingsFormSession<typeof initial>>>;
function Form({ name, active = true }: { name: string; active?: boolean }) {
  const session = useSettingsFormSession({ initial, active, busy: false, kind: "models", onTransition: vi.fn(), resolveEdit: () => null });
  useLayoutEffect(() => { sessions[name] = session; });
  return <section hidden={!active}>
    <button onClick={session.create}>Add {name}</button>
    {session.showForm && <input aria-label={name} value={session.formData.name} onChange={event => session.setFormData(value => ({ ...value, name: event.target.value }))} />}
    {session.confirmation}
  </section>;
}
function Wrap({ children, locale = "zh" }: { children: ReactNode; locale?: "zh" | "en" }) {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><SettingsExitProvider>
    <SettingsExitLink href="/">Project</SettingsExitLink><SettingsExitLink href="/about" replace scroll={false}>About</SettingsExitLink>
    {children}
  </SettingsExitProvider></NextIntlClientProvider>;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const link = (name: string) => fireEvent.click(screen.getByRole("link", { name }));
const blocked = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
let restoreDialogs: () => void;

describe("settings page exit", () => {
  beforeEach(() => { history.replaceState(null, "", "/settings"); restoreDialogs = mockSemanticDialogs(); sessions = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); restoreDialogs(); vi.unstubAllGlobals(); });

  it("rejects stale consent, superseded intents and changed registrations using live readers", async () => {
    const guard = new SettingsExitGuard(); let revision = 1, dirty = true;
    const discard = vi.fn(() => { dirty = false; });
    const remove = guard.register("service", () => ({ revision, dirty, busy: false }), discard);
    const stale = guard.request("/"); revision += 1; guard.finish(true);
    await expect(stale).resolves.toBe(false); expect(discard).not.toHaveBeenCalled();
    const older = guard.request("/"), oldConsent = guard.pending, newer = guard.request("/about");
    await expect(older).resolves.toBe(false); guard.finish(true, oldConsent);
    expect(guard.pending?.target).toBe("/about"); expect(discard).not.toHaveBeenCalled(); guard.finish(true);
    await expect(newer).resolves.toBe(true); expect(discard).toHaveBeenCalledTimes(1);
    dirty = true;
    const removed = guard.request("/"); remove(); await expect(removed).resolves.toBe(false);
    await expect(guard.request("/")).resolves.toBe(true);
  });

  it("requires discarded forms to report clean before allowing departure", async () => {
    const guard = new SettingsExitGuard();
    const remove = guard.register("form", () => ({ revision: 1, dirty: true, busy: false }), vi.fn());
    const page = guard.request("/"); guard.finish(true);
    await expect(page).resolves.toBe(false);
    guard.prepareClose(); expect(guard.discardClose()).toBe(false);
    remove();
  });

  it("never authorizes a busy or unreadable guard and cancels consent when saving settles", async () => {
    const guard = new SettingsExitGuard(), discard = vi.fn(); let busy = true;
    const remove = guard.register("connection", () => ({ revision: 1, dirty: true, busy }), discard);
    const first = guard.request("/"); guard.finish(true); await expect(first).resolves.toBe(false);
    const waiting = guard.request("/"); busy = false; guard.changed(); await expect(waiting).resolves.toBe(false);
    expect(guard.pending).toBeNull(); expect(discard).not.toHaveBeenCalled(); remove();
    const removeBroken = guard.register("broken", () => { throw new Error("unavailable"); }, discard);
    const broken = guard.request("/"); expect(guard.pending?.busy).toBe(true); guard.finish(true); await expect(broken).resolves.toBe(false); removeBroken();
  });

  it("collects hidden forms, stays without losing input, and discards every draft only after confirmation", async () => {
    const { rerender } = render(<Wrap><Form name="model" /><Form name="connection" /></Wrap>);
    click("Add model"); fireEvent.change(screen.getByLabelText("model"), { target: { value: "unsaved service" } });
    click("Add connection"); fireEvent.change(screen.getByLabelText("connection"), { target: { value: "unsaved database" } });
    rerender(<Wrap><Form name="model" active={false} /><Form name="connection" /></Wrap>);
    link("About"); expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(zh.settingsExit.description.replace("{destination}", zh.settingsExit.about));
    expect(screen.getByRole("button", { name: zh.settingsExit.stay })).toHaveFocus(); click(zh.settingsExit.stay);
    expect(mocks.replace).not.toHaveBeenCalled(); expect(sessions.model.formData.name).toBe("unsaved service"); expect(blocked()).toBe(true);
    link("About"); click(zh.settingsExit.leave);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/about", { scroll: false }));
    expect(sessions.model.showForm).toBe(false); expect(sessions.connection.showForm).toBe(false); expect(blocked()).toBe(false);
    link("Project"); expect(mocks.push).toHaveBeenCalledWith("/"); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("invalidates live edits, blocks an in-flight form save, and refuses pending navigation after unmount", async () => {
    const { unmount } = render(<Wrap locale="en"><Form name="model" /></Wrap>); click("Add model");
    act(() => { sessions.model.setFormData({ name: "typed before render", password: "fixture" }); link("Project"); });
    expect(mocks.push).not.toHaveBeenCalled(); expect(screen.getByRole("alertdialog")).toHaveAccessibleName(en.settingsExit.title);
    act(() => sessions.model.setFormData({ name: "newer edit", password: "fixture" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(mocks.push).not.toHaveBeenCalled();
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    act(() => { void sessions.model.submit(() => pending); link("About"); });
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(en.settingsExit.busyTitle);
    expect(screen.getByRole("button", { name: en.settingsExit.leave })).toBeDisabled();
    await act(async () => finish()); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(mocks.replace).not.toHaveBeenCalled();
    click("Add model"); fireEvent.change(screen.getByLabelText("model"), { target: { value: "third draft" } });
    link("Project"); unmount(); await act(async () => {}); expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps unsaved preference choices protected across sections and clears them without writing on discard", async () => {
    const settings = { preprocessing_enabled: true, self_analysis_enabled: true, python_enabled: true, auto_repair_enabled: true, diagnostics_enabled: true };
    mocks.get.mockResolvedValue({ data: { data: settings } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (section: "execution" | "appearance") => <QueryClientProvider client={client}><Wrap><PreferencesSettings section={section} /></Wrap></QueryClientProvider>;
    const { rerender } = render(tree("execution"));
    const checkbox = (await screen.findAllByRole("checkbox"))[0]; expect(checkbox).toBeChecked(); fireEvent.click(checkbox);
    expect(blocked()).toBe(true); rerender(tree("appearance")); link("Project"); click(zh.settingsExit.stay);
    rerender(tree("execution")); expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
    link("Project"); click(zh.settingsExit.leave); await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/", { scroll: undefined }));
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked(); expect(blocked()).toBe(false); expect(mocks.put).not.toHaveBeenCalled(); client.clear();
  });

  it("guards native page menus without treating navigation consent as native save-on-close", async () => {
    let navigate!: (page: DesktopPage) => void, close!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
    vi.stubGlobal("electronAPI", { onNavigate: (callback: typeof navigate) => { navigate = callback; return vi.fn(); }, onPrepareClose: (callback: typeof close) => { close = callback; return vi.fn(); } });
    const callback = vi.fn(), prepare = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const remove = registerDesktopPageNavigationGuard(prepare), stopNavigation = subscribeToDesktopNavigation(callback, "en")!, stopClose = subscribeToDesktopClose()!;
    try {
      await act(async () => navigate("/about")); expect(callback).not.toHaveBeenCalled();
      await act(async () => navigate("/")); expect(callback).toHaveBeenCalledExactlyOnceWith("/");
      expect(prepare.mock.calls).toEqual([["/about"], ["/"]]); expect(await close("save")).toBe("clean"); expect(prepare).toHaveBeenCalledTimes(2);
    } finally { stopNavigation(); stopClose(); remove(); }
  });
});
