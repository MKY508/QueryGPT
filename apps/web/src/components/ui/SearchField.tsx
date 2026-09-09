"use client";

import { useRef, type RefObject, type KeyboardEventHandler } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function SearchField({ value, onChange, onQueryChange, onKeyDown, label, clearLabel, inputRef, autoFocus, maxLength, className, inputClassName, describedBy, controls, disabled = false, clearOnEscape = true }: {
  value: string; onChange: (value: string) => void; label: string; clearLabel: string;
  inputRef?: RefObject<HTMLInputElement | null>; autoFocus?: boolean; maxLength?: number;
  className?: string; inputClassName?: string;
  describedBy?: string;
  controls?: string;
  disabled?: boolean;
  clearOnEscape?: boolean;
  onQueryChange?: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const field = inputRef || localRef;
  const composing = useRef(false);
  const clear = () => { onChange(""); onQueryChange?.(""); field.current?.focus({ preventScroll: true }); };
  return <div className={cn("flex min-w-0 items-center gap-2 rounded-md border border-input bg-background pl-3 pr-0.5 focus-within:border-primary/50", className)}>
    <Search size={14} className="shrink-0 text-muted-foreground" />
    <input ref={field} type="search" aria-label={label} aria-describedby={describedBy} aria-controls={controls} placeholder={label} autoFocus={autoFocus} maxLength={maxLength}
      disabled={disabled} value={value} onChange={(event) => { onChange(event.target.value); if (!composing.current) onQueryChange?.(event.target.value); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; onQueryChange?.(event.currentTarget.value); }}
      onBlur={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") { onKeyDown?.(event); return; }
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (value && clearOnEscape) { event.preventDefault(); event.stopPropagation(); clear(); return; }
        onKeyDown?.(event);
      }}
      className={cn("h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:opacity-50 [&::-webkit-search-cancel-button]:appearance-none", inputClassName)} />
    {value && <Button variant="ghost" size="icon" disabled={disabled} aria-label={clearLabel} title={clearLabel} onClick={clear} className="h-7 w-7">
      <X size={14} />
    </Button>}
  </div>;
}
