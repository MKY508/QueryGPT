"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ArmedDeleteButtonProps {
  armed: boolean;
  onRequest: () => void;
  confirmLabel: string;
  deleteLabel: string;
  disabled?: boolean;
  className?: string;
}

/** Icon delete button that turns into an inline confirm chip when armed. */
export function ArmedDeleteButton({
  armed,
  onRequest,
  confirmLabel,
  deleteLabel,
  disabled = false,
  className,
}: ArmedDeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRequest();
      }}
      disabled={disabled}
      aria-label={armed ? confirmLabel : deleteLabel}
      title={armed ? confirmLabel : deleteLabel}
      className={cn(
        "min-w-9",
        armed
          ? "border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive"
          : "p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        className
      )}
    >
      {armed ? confirmLabel : <Trash2 size={16} />}
    </Button>
  );
}
