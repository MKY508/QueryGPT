"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { hasModalDialog } from "@/lib/use-modal-focus";
import { Button } from "@/components/ui/button";
import styles from "./SettingsWorkspace.module.css";

/** A persistent desktop detail panel, never a viewport-driven modal. */
export function SettingsEditor({ active, confirming, title, disabled, onClose, notice, children }: {
  active: boolean; confirming: boolean; title: string; disabled: boolean;
  onClose: () => void; notice?: ReactNode; children: ReactNode;
}) {
  const t = useTranslations("common");
  const panel = useRef<HTMLElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!active || hasModalDialog()) return;
    const node = panel.current;
    if (node?.contains(document.activeElement)) return;
    node?.querySelector<HTMLElement>("[data-settings-primary-field]:not(:disabled)")?.focus({ preventScroll: true });
  }, [active]);

  return <section ref={panel} hidden={!active} inert={!active} data-settings-editor="" aria-labelledby={id}
    className={styles.editor}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape" && !confirming && !disabled && !hasModalDialog()) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <header className={styles.editorHeader}>
      <h2 id={id}>{title}</h2>
      <Button variant="ghost" size="icon" onClick={onClose} disabled={disabled || confirming} aria-label={t("close")}>
        <X size={16} aria-hidden="true" />
      </Button>
    </header>
    {notice && <div className="shrink-0 px-5 pt-4">{notice}</div>}
    {children}
  </section>;
}
