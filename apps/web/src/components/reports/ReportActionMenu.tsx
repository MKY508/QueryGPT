"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReportMenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

/** Toolbar overflow following the APG menu-button keyboard and focus pattern. */
export function ReportActionMenu({ label, text, disabled = false, icon, actions, open, onOpenChange }: {
  label: string;
  text?: string;
  disabled?: boolean;
  icon: ReactNode;
  actions: ReportMenuAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const close = () => { onOpenChange(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current;
    const anchor = root.current;
    if (!popup || !anchor) return;
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - 8));
      popup.style.left = `${left - bounds.left}px`;
    };
    position();
    const items = popup.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)');
    (items[focusLast.current ? items.length - 1 : 0] || popup).focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", position);
    };
  }, [open, onOpenChange]);

  return <div ref={root} className="relative" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <Button ref={trigger} variant="ghost" size={text ? "md" : "icon"} disabled={disabled} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      className="text-xs"
      onClick={() => { focusLast.current = false; onOpenChange(!open); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault(); focusLast.current = event.key === "ArrowUp"; onOpenChange(true);
      }}>{icon}{text && <><span>{text}</span><ChevronDown size={12} /></>}</Button>
    {open && <div ref={menu} id={id} role="menu" aria-label={label} tabIndex={-1}
      className="absolute top-11 z-40 w-56 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Tab") {
          // Resume the toolbar tab order, not the now-hidden menu's tab order.
          if (event.shiftKey) event.preventDefault();
          close();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      {actions.map((action) => <button key={action.id} type="button" role="menuitem" tabIndex={-1}
        disabled={action.disabled} title={action.title}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-xs font-medium text-foreground hover:bg-muted focus-visible:bg-muted disabled:opacity-40"
        onClick={() => { close(); action.onSelect(); }}>{action.icon}{action.label}</button>)}
    </div>}
  </div>;
}
