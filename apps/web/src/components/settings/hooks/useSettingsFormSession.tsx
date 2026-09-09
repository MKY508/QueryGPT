"use client";

import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { DiscardChangesDialog } from "@/components/ui/DiscardChangesDialog";
import { useSettingsExitGuard } from "../SettingsExitGuard";

/** Compare authored form values, not trimmed API payloads. Key ordering is not
 * an edit; whitespace, unchecked choices and incomplete numeric input are. */
export function settingsFormEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key)
    && settingsFormEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

type Intent = { kind: "close" } | { kind: "create" } | { kind: "edit"; id: string };
interface Session<T> {
  open: boolean; editingId: string | null; value: T; baseline: T; revision: number;
  pending: { intent: Intent; revision: number } | null; unavailable: boolean;
}

export function useSettingsFormSession<T>({ initial, resolveEdit, busy, active = true, kind, onTransition }: {
  initial: T; resolveEdit: (id: string) => T | null; busy: boolean; active?: boolean;
  kind: "models" | "connections"; onTransition: () => void;
}) {
  const t = useTranslations("settingsUnsaved");
  const [session, setSession] = useState<Session<T>>({ open: false, editingId: null, value: initial, baseline: initial, revision: 0, pending: null, unavailable: false });
  if (!active && session.pending) setSession({ ...session, pending: null });
  const current = useRef(session), options = useRef({ initial, resolveEdit, busy, active, onTransition });
  const formRef = useRef<HTMLFormElement>(null), addRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false), frame = useRef<number | null>(null), submitting = useRef(false);
  const [writing, setWriting] = useState(false);
  useLayoutEffect(() => { current.current = session; options.current = { initial, resolveEdit, busy, active, onTransition }; });
  useSettingsExitGuard(() => ({ revision: current.current.revision,
    dirty: current.current.open && !settingsFormEqual(current.current.value, current.current.baseline),
    busy: options.current.busy || submitting.current,
  }), `${session.revision}:${session.open}:${busy}:${writing}`, () => {
    const value = options.current.initial;
    current.current = { open: false, editingId: null, value, baseline: value, revision: current.current.revision + 1, pending: null, unavailable: false };
    setSession(current.current);
    options.current.onTransition();
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  const commit = (next: Session<T>) => { current.current = next; setSession(next); };
  const blocked = () => !mounted.current || !options.current.active || options.current.busy || submitting.current;
  const focus = (target: "form" | "add") => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!mounted.current || !options.current.active) return;
      const node = target === "add" ? addRef.current : formRef.current?.querySelector<HTMLElement>('[data-settings-primary-field]:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
      if (Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]:not(dialog)')).some(dialog => !node || !dialog.contains(node))) return;
      if (node?.isConnected && node.getClientRects().length) node.focus();
    });
  };
  const perform = (intent: Intent) => {
    if (blocked()) return;
    const value = intent.kind === "edit" ? options.current.resolveEdit(intent.id) : options.current.initial;
    // Resolve a replacement only after consent, using the current list. A
    // disappeared target must not consume the existing draft.
    if (value === null) { commit({ ...current.current, pending: null, unavailable: true }); focus("form"); return; }
    commit({ open: intent.kind !== "close", editingId: intent.kind === "edit" ? intent.id : null,
      value, baseline: value, revision: current.current.revision + 1, pending: null, unavailable: false });
    options.current.onTransition(); focus(intent.kind === "close" ? "add" : "form");
  };
  const request = (intent: Intent) => {
    if (blocked() || current.current.pending) return;
    const state = current.current;
    if (state.open && (intent.kind === "create" && state.editingId === null || intent.kind === "edit" && intent.id === state.editingId)) { focus("form"); return; }
    if (state.open && !settingsFormEqual(state.value, state.baseline)) {
      commit({ ...state, pending: { intent, revision: state.revision }, unavailable: false });
    } else perform(intent);
  };
  const change = (value: SetStateAction<T>) => {
    if (blocked() || !current.current.open) return;
    const state = current.current, next = typeof value === "function" ? (value as (current: T) => T)(state.value) : value;
    if (settingsFormEqual(next, state.value)) return;
    commit({ ...state, value: next, revision: state.revision + 1, unavailable: false });
  };
  const submit = async (write: (value: T, editingId: string | null) => Promise<unknown>): Promise<boolean> => {
    if (blocked() || !current.current.open || current.current.pending) return false;
    const snapshot = current.current;
    submitting.current = true; setWriting(true);
    try {
      await write(snapshot.value, snapshot.editingId);
      if (mounted.current && current.current.revision === snapshot.revision) {
        const value = options.current.initial;
        commit({ open: false, editingId: null, value, baseline: value, revision: snapshot.revision + 1, pending: null, unavailable: false });
        focus("add");
      }
      return true;
    } finally { submitting.current = false; if (mounted.current) setWriting(false); }
  };
  const cancel = () => { commit({ ...current.current, pending: null }); focus("form"); };
  const discard = () => {
    const state = current.current, pending = state.pending;
    if (!pending || blocked()) return;
    if (pending.revision !== state.revision) { cancel(); return; }
    perform(pending.intent);
  };

  return {
    showForm: session.open, editingId: session.editingId, formData: session.value, setFormData: change,
    formRef, addRef, writeBusy: busy || writing, submit,
    create: () => request({ kind: "create" }), edit: (id: string) => request({ kind: "edit", id }), close: () => request({ kind: "close" }),
    unavailable: session.unavailable ? t("unavailable") : null,
    confirming: session.pending !== null,
    dismissUnavailable: () => { if (mounted.current) commit({ ...current.current, unavailable: false }); },
    confirmation: active && session.pending ? createPortal(<DiscardChangesDialog title={t("title")} description={t(kind)}
      continueLabel={t("continueEditing")} discardLabel={t(session.pending.intent.kind === "close" ? "discardClose" : "discardReplace")}
      disabled={busy || writing} fallbackFocus={formRef} onContinue={cancel} onDiscard={discard} />, document.body) : null,
  };
}
