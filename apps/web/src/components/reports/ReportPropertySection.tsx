"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ReportPropertySection({ title, children, defaultOpen = false }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return <section className="border-t border-border">
    <h3><Button variant="ghost" id={`${id}-heading`} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen((value) => !value)}
      className="h-auto w-full justify-between px-0 py-3 text-left text-xs font-semibold hover:text-primary">
      {title}<ChevronDown size={14} className={open ? "rotate-180" : ""} />
    </Button></h3>
    <div id={id} role="region" aria-labelledby={`${id}-heading`} hidden={!open}>
      <div className="space-y-4 pb-4">{children}</div>
    </div>
  </section>;
}
