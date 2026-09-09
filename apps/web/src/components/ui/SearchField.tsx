"use client";

import { useRef, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function SearchField({ value, onChange, label, clearLabel, inputRef, autoFocus, maxLength, className, inputClassName, describedBy, controls, clearOnEscape = true }: {
  value: string; onChange: (value: string) => void; label: string; clearLabel: string;
  inputRef?: RefObject<HTMLInputElement | null>; autoFocus?: boolean; maxLength?: number;
  className?: string; inputClassName?: string;
  describedBy?: string;
  controls?: string;
  clearOnEscape?: boolean;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const field = inputRef || localRef;
  const composing = useRef(false);
  const clear = () => { onChange(""); field.current?.focus({ preventScroll: true }); };
  return <div className={cn("flex min-w-0 items-center gap-2 rounded-md border border-input bg-background pl-3 pr-0.5 focus-within:border-primary/50", className)}>
    <Search size={14} className="shrink-0 text-muted-foreground" />
    <input ref={field} type="search" aria-label={label} aria-describedby={describedBy} aria-controls={controls} placeholder={label} autoFocus={autoFocus} maxLength={maxLength}
      value={value} onChange={(event) => onChange(event.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onBlur={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (value && clearOnEscape) { event.preventDefault(); event.stopPropagation(); clear(); }
      }}
      className={cn("h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none [&::-webkit-search-cancel-button]:appearance-none", inputClassName)} />
    {value && <Button variant="ghost" size="icon" aria-label={clearLabel} title={clearLabel} onClick={clear} className="h-7 w-7">
      <X size={14} />
    </Button>}
  </div>;
}
