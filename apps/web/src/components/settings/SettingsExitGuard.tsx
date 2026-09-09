"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DiscardChangesDialog } from "@/components/ui/DiscardChangesDialog";
import { registerDesktopPageNavigationGuard, registerDesktopSettingsCloseGuard } from "@/lib/desktop-app-info";
import { SettingsExitGuard, type SettingsExitState } from "@/lib/settings/exit-guard";

const Context = createContext<{ guard: SettingsExitGuard; request: (target: string) => Promise<boolean> } | null>(null);
const ConfirmingContext = createContext(false);
export const useSettingsExitConfirming = () => useContext(ConfirmingContext);

export function SettingsExitProvider({ children }: { children: ReactNode }) {
  const [guard] = useState(() => new SettingsExitGuard());
  useSyncExternalStore(guard.subscribe, guard.getSnapshot, guard.getSnapshot);
  const t = useTranslations("settingsExit");
  const mounted = useRef(false), origin = useRef<HTMLElement | null>(null);
  const context = useMemo(() => ({ guard, request: (target: string) => {
    if (!mounted.current) return Promise.resolve(false);
    const destination = new URL(target, window.location.href);
    if (destination.origin !== window.location.origin) return Promise.resolve(false);
    if (destination.pathname === window.location.pathname) { guard.finish(false); return Promise.resolve(true); }
    // Do not stack a second leave decision above a form's existing confirmation.
    if (!guard.pending && document.querySelector('dialog[open][role="alertdialog"]')) return Promise.resolve(false);
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return guard.request(target);
  } }), [guard]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; guard.finish(false); };
  }, [guard]);
  useEffect(() => registerDesktopPageNavigationGuard(context.request), [context]);
  useLayoutEffect(() => registerDesktopSettingsCloseGuard({ prepare: guard.prepareClose, inspect: guard.inspectClose,
    discard: guard.discardClose, cancel: guard.cancelClose }), [guard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const state = guard.inspect();
      if (!state.dirty && !state.busy) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard]);
  const pending = guard.pending;
  const cancel = () => {
    if (guard.pending !== pending) return;
    const target = origin.current;
    guard.finish(false, pending);
    requestAnimationFrame(() => {
      if (!mounted.current || guard.pending || !target?.isConnected || !target.getClientRects().length) return;
      if (Array.from(document.querySelectorAll("dialog[open]")).some(dialog => dialog.matches(":modal") && !dialog.contains(target))) return;
      target.focus({ preventScroll: true });
    });
  };
  return <Context value={context}><ConfirmingContext value={pending !== null}>{children}
    {pending && createPortal(<DiscardChangesDialog title={t(pending.busy ? "busyTitle" : "title")}
      description={t(pending.busy ? "busyDescription" : "description", { destination: t(pending.target === "/about" ? "about" : "project") })}
      continueLabel={t("stay")} discardLabel={t("leave")} disabled={pending.busy} fallbackFocus={origin}
      onContinue={cancel} onDiscard={() => guard.finish(true, pending)} />, document.body)}
  </ConfirmingContext></Context>;
}

/** A live reader covers changes made before React commits the next render. */
export function useSettingsExitGuard(read: () => SettingsExitState, version: string, discard: () => void) {
  const context = useContext(Context), id = useId(), latest = useRef({ read, discard });
  useLayoutEffect(() => { latest.current = { read, discard }; });
  useLayoutEffect(() => context?.guard.register(id, () => latest.current.read(), () => latest.current.discard()), [context, id]);
  useLayoutEffect(() => { context?.guard.changed(); }, [context, version]);
}

export function SettingsExitLink({ href, replace, scroll, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate" | "as"> & { href: string }) {
  const context = useContext(Context), router = useRouter();
  return <Link {...props} href={href} replace={replace} scroll={scroll} onNavigate={event => {
    if (!context) return;
    const state = context.guard.inspect();
    if (!state.dirty && !state.busy && !context.guard.pending) return;
    event.preventDefault();
    void context.request(href).then(allowed => {
      if (allowed) router[replace ? "replace" : "push"](href, { scroll });
    });
  }} />;
}
