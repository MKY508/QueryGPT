import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsExitGuard } from "@/lib/settings/exit-guard";
import { registerDesktopSettingsCloseGuard, registerDesktopNavigationGuard, registerDesktopCloseGuard, subscribeToDesktopClose,
  type DesktopCloseCommand, type DesktopCloseState } from "@/lib/desktop-app-info";

afterEach(() => vi.unstubAllGlobals());
const register = (guard: SettingsExitGuard) => registerDesktopSettingsCloseGuard({ prepare: guard.prepareClose, inspect: guard.inspectClose, discard: guard.discardClose, cancel: guard.cancelClose });
function fixture() {
  let receive!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
  vi.stubGlobal("electronAPI", { onPrepareClose: (callback: typeof receive) => { receive = callback; return vi.fn(); } });
  const close = subscribeToDesktopClose()!;
  return { receive: (command: DesktopCloseCommand) => receive(command), close };
}

describe("settings desktop close", () => {
  it("binds discard to the inspected drafts and expires approval after changes, cancel or a replacement registration", async () => {
    const guard = new SettingsExitGuard(); let revision = 1, dirty = true;
    const discard = vi.fn(() => { dirty = false; revision += 1; });
    const remove = guard.register("model", () => ({ revision, dirty, busy: false }), discard);
    const pendingPage = guard.request("/about"); guard.prepareClose(); await expect(pendingPage).resolves.toBe(false);
    revision += 1; expect(guard.discardClose()).toBe(false); expect(discard).not.toHaveBeenCalled();
    guard.prepareClose(); guard.cancelClose(); expect(guard.discardClose()).toBe(false);
    guard.prepareClose(); const removeOther = guard.register("other", () => ({ revision: 0, dirty: false, busy: false }), vi.fn());
    expect(guard.discardClose()).toBe(false); removeOther();
    guard.prepareClose(); expect(guard.discardClose()).toBe(true); expect(guard.inspectClose()).toBe("clean");
    expect(guard.discardClose()).toBe(false); expect(discard).toHaveBeenCalledTimes(1); remove();
  });

  it("never saves configurations implicitly and only discards after a fresh inspected confirmation", async () => {
    const guard = new SettingsExitGuard(); let revision = 1, dirty = true;
    const discard = vi.fn(() => { dirty = false; revision += 1; });
    const removeField = guard.register("preferences", () => ({ revision, dirty, busy: false }), discard);
    const remove = register(guard), f = fixture();
    try {
      expect(await f.receive("inspect")).toBe("settings"); expect(await f.receive("save")).toBe("settings"); expect(discard).not.toHaveBeenCalled();
      expect(await f.receive("discard")).toBe("settings");
      expect(await f.receive("inspect")).toBe("settings"); revision += 1;
      expect(await f.receive("discard")).toBe("settings"); expect(discard).not.toHaveBeenCalled();
      await f.receive("inspect"); await f.receive("cancel"); expect(await f.receive("discard")).toBe("settings");
      await f.receive("inspect"); expect(await f.receive("discard")).toBe("clean"); expect(discard).toHaveBeenCalledTimes(1);
    } finally { f.close(); remove(); removeField(); }
  });

  it("prioritizes uploads and busy work, and refuses newer settings arriving while other drafts are being discarded", async () => {
    const guard = new SettingsExitGuard(); let revision = 1, dirty = true, busy = false, barrier: DesktopCloseState = "uploads";
    const discard = vi.fn(() => { dirty = false; revision += 1; });
    const removeField = guard.register("connection", () => ({ revision, dirty, busy }), discard);
    const remove = register(guard), removeBarrier = registerDesktopCloseGuard(() => barrier), f = fixture();
    let removeReport: (() => void) | undefined;
    try {
      expect(await f.receive("inspect")).toBe("uploads"); expect(await f.receive("discard")).toBe("uploads"); expect(discard).not.toHaveBeenCalled();
      busy = true; expect(await f.receive("inspect")).toBe("busy"); expect(await f.receive("discard")).toBe("busy");
      busy = false; barrier = "clean";
      let finish!: (allowed: boolean) => void;
      const saving = vi.fn(async () => true), discardReport = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
      removeReport = registerDesktopNavigationGuard(saving, () => "dirty", discardReport);
      expect(await f.receive("inspect")).toBe("settings"); const pending = f.receive("discard");
      await vi.waitFor(() => expect(discardReport).toHaveBeenCalledTimes(1));
      dirty = true; revision += 1; finish(true);
      expect(await pending).toBe("settings"); expect(saving).not.toHaveBeenCalled(); expect(guard.discardClose()).toBe(false);
    } finally { f.close(); removeReport?.(); removeBarrier(); remove(); removeField(); }
  });
});
