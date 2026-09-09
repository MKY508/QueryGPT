"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabItem<Value extends string> {
  value: Value;
  label: ReactNode;
}

/** Automatic activation for already-loaded local panels. */
export function TabList<Value extends string>({ id, label, items, value, onChange, disabled = false, className }: {
  id: string; label: string; items: readonly TabItem<Value>[]; value: Value;
  onChange: (value: Value) => void; disabled?: boolean; className?: string;
}) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  return <div role="tablist" aria-label={label} className={cn("flex border-b border-border", className)}>
    {items.map((item, index) => <button key={item.value} type="button" role="tab"
      ref={node => {
        if (node) buttons.current.set(item.value, node); else buttons.current.delete(item.value);
      }}
      id={`${id}-${item.value}`} aria-controls={`${id}-panel`} aria-selected={value === item.value}
      tabIndex={value === item.value ? 0 : -1} disabled={disabled}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        const next = event.key === "ArrowRight" ? (index + 1) % items.length
          : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        onChange(items[next].value);
        buttons.current.get(items[next].value)?.focus();
      }}
      className={cn("min-h-10 border-b-2 px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:opacity-40",
        value === item.value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
      {item.label}
    </button>)}
  </div>;
}
