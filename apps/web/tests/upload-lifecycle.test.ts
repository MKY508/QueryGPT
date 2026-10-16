import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToUploadLifecycle } from "@/lib/upload-lifecycle";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import {
  registerDesktopNavigationGuard,
  subscribeToDesktopClose,
  subscribeToDesktopNavigation,
  type DesktopCloseCommand,
  type DesktopCloseState,
  type DesktopPage,
} from "@/lib/desktop-app-info";
import type { UploadStatus } from "@/lib/upload-state";

function setQueue(status?: UploadStatus) {
  useUploadQueueStore.setState({
    byProject: status
      ? {
          "not-the-selected-project": {
            busy: status === "uploading" || status === "saving",
            paused: status === "queued",
            notice: null,
            items: [
              {
                id: "upload-1",
                name: "orders.csv",
                status,
                retryable: false,
                progress: null,
              },
            ],
          },
        }
      : {},
  });
}

function bridge() {
  let receive!: (command: DesktopCloseCommand) => Promise<DesktopCloseState>;
  let navigate!: (page: DesktopPage) => void;
  vi.stubGlobal("electronAPI", {
    onPrepareClose: (callback: typeof receive) => {
      receive = callback;
      return vi.fn();
    },
    onNavigate: (callback: typeof navigate) => {
      navigate = callback;
      return vi.fn();
    },
  });
  const cleanup = subscribeToDesktopClose()!;
  return {
    receive: (command: DesktopCloseCommand) => receive(command),
    navigate: (page: DesktopPage) => navigate(page),
    cleanup,
  };
}

afterEach(() => {
  setQueue();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("document-lifetime upload protection", () => {
  it("guards hidden and paused batches but not completed records, and releases its listeners", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const dispose = subscribeToUploadLifecycle()!;
    const f = bridge();
    try {
      for (const status of ["queued", "preparing", "uploading", "saving"] as const) {
        setQueue(status);
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(await f.receive("inspect")).toBe("uploads");
      }
      // Progress and status transitions must not continually re-register guards.
      expect(
        add.mock.calls.filter(([type]) => type === "beforeunload"),
      ).toHaveLength(1);
      for (const status of [
        "added",
        "cancelled",
        "failed",
        "uncertain",
      ] as const) {
        setQueue(status);
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(await f.receive("inspect")).toBe("clean");
      }
      expect(
        remove.mock.calls.filter(([type]) => type === "beforeunload"),
      ).toHaveLength(1);
      setQueue("queued");
      dispose();
      expect(await f.receive("inspect")).toBe("clean");
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      dispose();
      f.cleanup();
    }
  });

  it("allows safe SPA navigation while retaining the report save guard", async () => {
    setQueue("uploading");
    const dispose = subscribeToUploadLifecycle()!;
    const f = bridge();
    const save = vi.fn(async () => true);
    const guard = registerDesktopNavigationGuard(save, () => "dirty");
    const navigated = vi.fn();
    const unsubscribe = subscribeToDesktopNavigation(navigated, "en")!;
    try {
      f.navigate("/settings");
      await vi.waitFor(() =>
        expect(navigated).toHaveBeenCalledWith("/settings"),
      );
      expect(save).toHaveBeenCalledOnce();
      expect(await f.receive("save")).toBe("uploads");
      expect(save).toHaveBeenCalledOnce(); // Closing never silently saves/retries uploads.
    } finally {
      unsubscribe();
      guard();
      dispose();
      f.cleanup();
    }
  });

  it("blocks an upload that starts during report discard and revokes its preparation", async () => {
    const dispose = subscribeToUploadLifecycle()!;
    const f = bridge();
    let finish!: (allowed: boolean) => void;
    const discard = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const cancel = vi.fn();
    const guard = registerDesktopNavigationGuard(
      async () => true,
      () => "dirty",
      discard,
      cancel,
    );
    try {
      const result = f.receive("discard");
      setQueue("queued");
      finish(true);
      expect(await result).toBe("uploads");
      expect(cancel).toHaveBeenCalledTimes(2); // Reset first, revoke after the race.
      expect(await f.receive("discard")).toBe("uploads");
      expect(discard).toHaveBeenCalledOnce();
    } finally {
      guard();
      dispose();
      f.cleanup();
    }
  });

  it("invalidates a late approval when native closing was cancelled", async () => {
    const f = bridge();
    let finish!: (allowed: boolean) => void;
    const cancel = vi.fn();
    const guard = registerDesktopNavigationGuard(
      async () => true,
      () => "dirty",
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      cancel,
    );
    try {
      const pending = f.receive("discard");
      expect(await f.receive("cancel")).toBe("unavailable");
      finish(true);
      expect(await pending).toBe("unavailable");
      expect(cancel).toHaveBeenCalled();
    } finally {
      guard();
      f.cleanup();
    }
  });
});
