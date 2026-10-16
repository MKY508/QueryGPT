import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerDesktopNavigationGuard,
  subscribeToDesktopClose,
  subscribeToDesktopErrors,
  subscribeToDesktopNavigation,
  type DesktopPage,
  type DesktopCloseCommand,
  type DesktopCloseState,
} from "@/lib/desktop-app-info";

afterEach(() => vi.unstubAllGlobals());

function navigationFixture() {
  let receive!: (page: DesktopPage) => void;
  const unsubscribe = vi.fn();
  const onNavigate = vi.fn((callback) => { receive = callback; return unsubscribe; });
  vi.stubGlobal("electronAPI", { onNavigate });
  const navigate = vi.fn();
  const cleanup = subscribeToDesktopNavigation(navigate, "en")!;
  return { receive: (page: DesktopPage) => receive(page), navigate, cleanup, onNavigate, unsubscribe };
}

function closeFixture() {
  let receive!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
  const unsubscribe = vi.fn();
  vi.stubGlobal("electronAPI", { onPrepareClose: (callback: typeof receive) => { receive = callback; return unsubscribe; } });
  const cleanup = subscribeToDesktopClose()!;
  return { receive: (command: DesktopCloseCommand) => receive(command), cleanup, unsubscribe };
}

describe("desktop close bridge", () => {
  it("discards recovery data without saving the report and refuses failed cleanup", async () => {
    const save = vi.fn(async () => true);
    const discard = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const remove = registerDesktopNavigationGuard(save, () => "dirty", discard);
    const f = closeFixture();
    try {
      expect(await f.receive("discard")).toBe("dirty");
      expect(await f.receive("discard")).toBe("clean");
      expect(save).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(2);
    } finally { remove(); f.cleanup(); }
  });
  it("approves pages without leave guards and rejects unknown commands", async () => {
    const f = closeFixture();
    expect(await f.receive("inspect")).toBe("clean");
    expect(await f.receive("delete" as DesktopCloseCommand)).toBe("unavailable");
    f.cleanup();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(await f.receive("inspect")).toBe("unavailable");
  });

  it("inspects without writing and only approves after saving the current edits", async () => {
    let state: DesktopCloseState = "dirty";
    const save = vi.fn(async () => { state = "clean"; return true; });
    const remove = registerDesktopNavigationGuard(save, () => state);
    const f = closeFixture();
    try {
      expect(await f.receive("inspect")).toBe("dirty");
      expect(save).not.toHaveBeenCalled();
      expect(await f.receive("save")).toBe("clean");
      expect(save).toHaveBeenCalledOnce();
    } finally { remove(); f.cleanup(); }
  });

  it("does not start another save while an editor is busy or unavailable", async () => {
    for (const state of ["busy", "unavailable"] as const) {
      const save = vi.fn(async () => true);
      const removeDirty = registerDesktopNavigationGuard(save, () => "dirty");
      const remove = registerDesktopNavigationGuard(save, () => state);
      const f = closeFixture();
      try {
        expect(await f.receive("save")).toBe(state);
        expect(save).not.toHaveBeenCalled();
      } finally { removeDirty(); remove(); f.cleanup(); }
    }
  });

  it("retains newer edits and refused saves even if the save promise resolves", async () => {
    for (const [allowed, state] of [[true, "dirty"], [false, "clean"]] as const) {
      let current: DesktopCloseState = "dirty";
      const remove = registerDesktopNavigationGuard(async () => { current = state; return allowed; }, () => current);
      const f = closeFixture();
      try { expect(await f.receive("save")).toBe("dirty"); }
      finally { remove(); f.cleanup(); }
    }
  });

  it("never approves after the editor or close subscription changed during a save", async () => {
    for (const change of ["editor", "subscription"]) {
      let finish!: (allowed: boolean) => void;
      const remove = registerDesktopNavigationGuard(() => new Promise((resolve) => { finish = resolve; }));
      const f = closeFixture();
      try {
        const result = f.receive("save");
        if (change === "editor") remove(); else f.cleanup();
        finish(true);
        expect(await result).toBe("unavailable");
      } finally { remove(); f.cleanup(); }
    }
  });

  it("fails closed when inspecting or saving throws", async () => {
    for (const phase of ["inspect", "save"]) {
      const remove = registerDesktopNavigationGuard(async () => { throw new Error("save failed"); }, () => {
        if (phase === "inspect") throw new Error("unavailable");
        return "dirty";
      });
      const f = closeFixture();
      try { expect(await f.receive("save")).toBe("unavailable"); }
      finally { remove(); f.cleanup(); }
    }
  });
});

describe("desktop bridge", () => {
  it("passes the locale and only accepts known application pages", async () => {
    const fixture = navigationFixture();
    fixture.receive("/settings");
    fixture.receive("https://example.com" as DesktopPage);
    await Promise.resolve();
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith("/settings");
    expect(fixture.onNavigate).toHaveBeenCalledWith(expect.any(Function), "en");
    fixture.cleanup();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });

  it("retains the report when its save-before-leaving guard rejects navigation", async () => {
    const guard = vi.fn().mockResolvedValue(false);
    const removeGuard = registerDesktopNavigationGuard(guard);
    const fixture = navigationFixture();
    try {
      fixture.receive("/settings");
      await Promise.resolve();
      expect(guard).toHaveBeenCalledOnce();
      expect(fixture.navigate).not.toHaveBeenCalled();
    } finally { removeGuard(); fixture.cleanup(); }
  });

  it("does not navigate after a subscription is disposed during a save", async () => {
    let finish!: (allow: boolean) => void;
    const removeGuard = registerDesktopNavigationGuard(() => new Promise((resolve) => { finish = resolve; }));
    const fixture = navigationFixture();
    try {
      fixture.receive("/about");
      fixture.cleanup();
      finish(true);
      await Promise.resolve();
      expect(fixture.navigate).not.toHaveBeenCalled();
    } finally { removeGuard(); }
  });

  it("forwards plain renderer error details and removes its listeners", () => {
    const report = vi.fn();
    vi.stubGlobal("electronAPI", { reportChunkLoadFailure: report });
    const cleanup = subscribeToDesktopErrors()!;
    const event = new ErrorEvent("error", { message: "Loading chunk 1 failed. /_next/static/chunks/1.js" });
    window.dispatchEvent(event);
    expect(report).toHaveBeenCalledExactlyOnceWith({ name: "Error", message: event.message });
    cleanup();
    window.dispatchEvent(event);
    expect(report).toHaveBeenCalledOnce();
  });
});
