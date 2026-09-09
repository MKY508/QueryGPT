"use client";

import type { ComponentPropsWithoutRef, FormEvent, ReactNode, RefObject } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./SettingsForm.module.css";

interface SettingsFormProps {
  embedded: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  title: string;
  closeLabel: string;
  submitLabel: string;
  busy: boolean;
  testId: string;
  feedback: ReactNode;
  children: ReactNode;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/** One form body and action bar, whether hosted in a page or a detail panel. */
export function SettingsForm({
  embedded, formRef, title, closeLabel, submitLabel, busy, testId,
  feedback, children, onCancel, onSubmit,
}: SettingsFormProps) {
  const t = useTranslations("common");

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={title}
      aria-busy={busy}
      data-testid={`${testId}-form`}
      data-embedded={embedded}
      className={styles.form}
      onSubmit={onSubmit}
    >
      <fieldset disabled={busy} className={styles.fields} data-settings-form-body="">
        <div className={styles.body}>
          {!embedded && (
            <header className={styles.header}>
              <h3>{title}</h3>
              <button type="button" aria-label={closeLabel} onClick={onCancel}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
          )}
          {children}
        </div>
      </fieldset>
      <footer className={styles.footer}>
        {feedback}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onCancel} className={styles.cancel}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={busy} data-testid={`${testId}-submit-button`} className={styles.submit}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </button>
        </div>
      </footer>
    </form>
  );
}

export function SettingsDisclosure({ title, children, ...props }:
  Omit<ComponentPropsWithoutRef<"details">, "className" | "title"> & { title: string }) {
  return (
    <details {...props} className={styles.disclosure}>
      <summary>
        {title}
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
