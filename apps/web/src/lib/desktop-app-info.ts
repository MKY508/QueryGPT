export interface DesktopAppInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
}

interface DesktopBridge {
  getAppInfo?: () => Promise<DesktopAppInfo>;
  onNavigate?: (callback: (page: DesktopPage) => void, locale: string) => () => void;
  onPrepareClose?: (callback: (command: DesktopCloseCommand) => Promise<DesktopCloseState>) => () => void;
  reportChunkLoadFailure?: (error: { name: string; message: string }) => void;
}

export type DesktopPage = "/" | "/settings" | "/about";
export type DesktopCloseCommand = "inspect" | "save" | "discard" | "cancel";
export type DesktopCloseState = "clean" | "dirty" | "settings" | "busy" | "uploads" | "unavailable";

interface DesktopLeaveGuard {
  prepare: () => Promise<boolean>;
  inspect: () => DesktopCloseState;
  discard: () => Promise<boolean>;
  cancelClose: () => void;
}
const navigationGuards = new Set<DesktopLeaveGuard>();
const pageNavigationGuards = new Set<(page: DesktopPage) => Promise<boolean>>();
const closeOnlyGuards = new Set<() => DesktopCloseState>();
interface SettingsCloseGuard {
  prepare: () => void;
  inspect: () => DesktopCloseState;
  discard: () => boolean | Promise<boolean>;
  cancel: () => void;
}
const settingsCloseGuards = new Set<SettingsCloseGuard>();
let guardRevision = 0;
let closeGuardRevision = 0;

/** Configuration drafts have an explicit discard-only close choice, not the
 * report editor's save-all contract. Prepare captures what the user reviewed. */
export function registerDesktopSettingsCloseGuard(guard: SettingsCloseGuard): () => void {
  settingsCloseGuards.add(guard); closeGuardRevision += 1;
  return () => {
    if (settingsCloseGuards.delete(guard)) { closeGuardRevision += 1; guard.cancel(); }
  };
}

/** Foreground page decisions are distinct from native save/discard-on-close. */
export function registerDesktopPageNavigationGuard(prepare: (page: DesktopPage) => Promise<boolean>): () => void {
  pageNavigationGuards.add(prepare); guardRevision += 1;
  return () => { if (pageNavigationGuards.delete(prepare)) guardRevision += 1; };
}

export function registerDesktopNavigationGuard(
  prepare: () => Promise<boolean>,
  inspect: () => DesktopCloseState = () => "dirty",
  discard: () => Promise<boolean> = async () => true,
  cancelClose: () => void = () => {},
): () => void {
  const guard = { prepare, inspect, discard, cancelClose };
  navigationGuards.add(guard);
  guardRevision += 1;
  closeGuardRevision += 1;
  return () => {
    if (navigationGuards.delete(guard)) {
      guardRevision += 1;
      closeGuardRevision += 1;
    }
  };
}

/** Work that survives SPA navigation can still prevent closing its document. */
export function registerDesktopCloseGuard(inspect: () => DesktopCloseState): () => void {
  closeOnlyGuards.add(inspect);
  closeGuardRevision += 1;
  return () => { if (closeOnlyGuards.delete(inspect)) closeGuardRevision += 1; };
}

function inspectGuards(guards: Iterable<() => DesktopCloseState>): DesktopCloseState {
  const priority = { clean: 0, dirty: 1, settings: 2, unavailable: 3, uploads: 4, busy: 5 };
  let state: DesktopCloseState = "clean";
  for (const inspect of guards) {
    let next: DesktopCloseState;
    try { next = inspect(); } catch { next = "unavailable"; }
    if (!Object.hasOwn(priority, next)) next = "unavailable";
    if (priority[next] > priority[state]) state = next;
  }
  return state;
}

type WindowWithDesktopBridge = Window & {
  electronAPI?: DesktopBridge;
};

export async function readDesktopAppInfo(): Promise<DesktopAppInfo | undefined> {
  if (typeof window === "undefined") return undefined;
  return (window as WindowWithDesktopBridge).electronAPI?.getAppInfo?.();
}

export function subscribeToDesktopNavigation(
  callback: (page: DesktopPage) => void,
  locale: string,
): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  let active = true;
  let latestIntent = 0;
  const unsubscribe = (window as WindowWithDesktopBridge).electronAPI?.onNavigate?.((page) => {
    if (page !== "/" && page !== "/settings" && page !== "/about") return;
    const intent = ++latestIntent;
    void (async () => {
      // Reuse the report editor's save-before-leaving contract for native menus.
      // A failed/conflicting save leaves the current page and its error visible.
      const revision = guardRevision;
      for (const guard of [...navigationGuards]) {
        if (!active || !await guard.prepare() || revision !== guardRevision) return;
      }
      for (const prepare of [...pageNavigationGuards]) {
        if (!active || intent !== latestIntent || !await prepare(page) || revision !== guardRevision) return;
      }
      if (active && intent === latestIntent) callback(page);
    })().catch(() => { /* A failing leave guard must never discard the current page. */ });
  }, locale);
  return () => { active = false; unsubscribe?.(); };
}

export function subscribeToDesktopClose(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  let active = true;
  let operationRevision = 0;
  const cancelPreparations = (includeSettings = true) => {
    for (const guard of navigationGuards) {
      try { guard.cancelClose(); } catch { /* Cancellation must reach the other guards. */ }
    }
    if (includeSettings) for (const guard of settingsCloseGuards) {
      try { guard.cancel(); } catch { /* Keep notifying the remaining participants. */ }
    }
  };
  const inspect = (): DesktopCloseState => {
    if (!active) return "unavailable";
    return inspectGuards([...navigationGuards].map((guard) => guard.inspect).concat([...closeOnlyGuards], [...settingsCloseGuards].map(guard => guard.inspect)));
  };
  const unsubscribe = (window as WindowWithDesktopBridge).electronAPI?.onPrepareClose?.(async (command) => {
    if (!active) return "unavailable";
    if (command !== "inspect" && command !== "save" && command !== "discard" && command !== "cancel") return "unavailable";
    if (command === "inspect") {
      const current = inspect();
      if (current === "busy") return current;
      operationRevision += 1;
      cancelPreparations();
      try { for (const guard of settingsCloseGuards) guard.prepare(); }
      catch { cancelPreparations(); return "unavailable"; }
      return inspect();
    }
    const operation = ++operationRevision;
    cancelPreparations(command === "cancel");
    if (command === "cancel") return "unavailable";
    const state = inspect();
    if (state !== "dirty" && state !== "settings") return state;
    if (state === "settings" && command === "save") { cancelPreparations(); return "settings"; }
    const revision = closeGuardRevision;
    const current = () => active && revision === closeGuardRevision && operation === operationRevision;
    const refuse = (result: DesktopCloseState) => { cancelPreparations(); return result; };
    try {
      if (command === "discard") for (const guard of [...settingsCloseGuards]) {
        if (!current()) return refuse("unavailable");
        const barrier = inspectGuards(closeOnlyGuards);
        if (barrier !== "clean") return refuse(barrier);
        if (guard.inspect() !== "clean" && !await guard.discard()) return refuse("settings");
      }
      for (const guard of [...navigationGuards]) {
        if (!current()) return refuse("unavailable");
        const barrier = inspectGuards(closeOnlyGuards);
        if (barrier !== "clean") return refuse(barrier);
        if (!await (command === "discard" ? guard.discard() : guard.prepare())) return refuse("dirty");
      }
      // Saving may have navigated/unmounted an editor, or a newer edit may have
      // arrived during the request. Only the same, now-clean guards may approve.
      if (!current()) return refuse("unavailable");
      const result = inspect();
      // Discard callbacks may leave dirty editor data in memory. Their scoped
      // one-shot unload approval, not forced window destruction, authorizes exit.
      if (command === "discard" && (result === "clean" || result === "dirty")) return "clean";
      return result === "clean" ? result : refuse(result);
    } catch { return refuse("unavailable"); }
  });
  return () => { active = false; operationRevision += 1; cancelPreparations(); unsubscribe?.(); };
}

export function subscribeToDesktopErrors(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  const report = (window as WindowWithDesktopBridge).electronAPI?.reportChunkLoadFailure;
  if (!report) return undefined;
  const forward = (reason: unknown, fallback = "") => {
    const error = reason && typeof reason === "object" ? reason as Record<string, unknown> : null;
    report({
      name: typeof error?.name === "string" ? error.name : "Error",
      message: typeof error?.message === "string" ? error.message : typeof reason === "string" ? reason : fallback,
    });
  };
  const onError = (event: ErrorEvent) => forward(event.error, event.message);
  const onRejection = (event: PromiseRejectionEvent) => forward(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export function formatDesktopPlatform(platform: string): string {
  const labels: Record<string, string> = {
    darwin: "macOS",
    win32: "Windows",
    linux: "Linux",
  };
  return labels[platform] ?? platform;
}
