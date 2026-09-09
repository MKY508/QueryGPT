"use client";

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { hasModalDialog } from "@/lib/use-modal-focus";

function focusInvalidFields(form: HTMLFormElement) {
  if (!form.isConnected || form.closest("[hidden], [inert]")) return;
  // A pending discard decision owns focus until it is closed.
  if (hasModalDialog(form.closest('dialog, [aria-modal="true"]'))) return;
  const fields = Array.from(form.querySelectorAll<HTMLElement>('[aria-invalid="true"]:not(:disabled)'));
  for (const field of fields) {
    let disclosure = field.closest("details");
    while (disclosure && form.contains(disclosure)) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest("details") ?? null;
    }
  }
  fields[0]?.focus();
}

/** Report errors after a submit attempt, without interrupting initial entry. */
export function useSettingsValidation({ scope, errors, busy }: {
  scope: string | null;
  errors: Partial<Record<string, string>>;
  busy: boolean;
}) {
  const t = useTranslations("settingsValidation");
  const prefix = useId();
  const [attempt, setAttempt] = useState({ scope, count: 0 });
  const pendingFocus = useRef<HTMLFormElement | null>(null);
  if (attempt.scope !== scope) setAttempt({ scope, count: 0 });
  const submitted = attempt.scope === scope && attempt.count > 0;
  const count = submitted ? Object.values(errors).filter(Boolean).length : 0;
  const id = (field: string) => `${prefix}-${field}`;

  useLayoutEffect(() => {
    const form = pendingFocus.current;
    pendingFocus.current = null;
    if (form && attempt.scope === scope && !busy) focusInvalidFields(form);
  }, [attempt, scope, busy]);

  return {
    id,
    field: (field: string, hintId?: string) => ({
      id: id(field),
      name: field,
      "aria-invalid": submitted && errors[field] ? true as const : undefined,
      "aria-describedby": [hintId, submitted && errors[field] ? id(`${field}-error`) : undefined].filter(Boolean).join(" ") || undefined,
    }),
    error: (field: string) => submitted && errors[field]
      ? <p id={id(`${field}-error`)} className="mt-1.5 text-sm leading-5 text-destructive">{errors[field]}</p>
      : null,
    summary: <div role="status" aria-live="polite" aria-atomic="true" className={count ? "min-w-0 flex-1 self-center" : "hidden"}>
      {count > 0 && <button type="button" className="text-left text-xs leading-5 text-destructive underline decoration-destructive/40 underline-offset-4 hover:decoration-destructive"
        onClick={event => { const form = event.currentTarget.form; if (form) focusInvalidFields(form); }}>
        {t("summary", { count })}
      </button>}
    </div>,
    submit: (event: FormEvent<HTMLFormElement>, onValid: (event: FormEvent<HTMLFormElement>) => void) => {
      event.preventDefault();
      if (busy) return;
      if (Object.values(errors).some(Boolean)) {
        pendingFocus.current = event.currentTarget;
        setAttempt(current => ({ scope, count: current.scope === scope ? current.count + 1 : 1 }));
        return;
      }
      onValid(event);
    },
  };
}
