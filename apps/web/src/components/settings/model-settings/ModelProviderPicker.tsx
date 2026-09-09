"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { MODEL_PRESETS } from "@/lib/settings/models";
import { cn } from "@/lib/utils";

import { ModelProviderMark, ModelProviderName } from "./ModelProviderIdentity";

export function ModelProviderPicker({ value, initiallyExpanded, onSelect }: {
  value: string;
  initiallyExpanded: boolean;
  onSelect: (provider: string) => void;
}) {
  const t = useTranslations("modelSettings");
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const summaryRef = useRef<HTMLElement>(null);
  return <fieldset>
    <legend className="mb-3 text-sm font-medium text-foreground">{t("form.chooseService")}</legend>
    <details open={expanded} data-testid="model-provider-choices"
      onToggle={event => setExpanded(event.currentTarget.open)} className="group/provider">
      <summary ref={summaryRef} className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-primary">
        <ModelProviderMark provider={value} selected className="size-8 rounded-lg text-base" />
        <span className="min-w-0 flex-1 font-medium"><ModelProviderName provider={value} /></span>
        <span className="text-xs text-muted-foreground">{t("form.changeService")}</span>
        <ChevronDown size={16} aria-hidden="true" className="group-open/provider:rotate-180" />
      </summary>
    <div className="mt-2 grid grid-cols-2 gap-2">
      {Object.entries(MODEL_PRESETS).map(([key, preset]) => {
        const selected = value === key;
        return <button key={key} type="button" aria-pressed={selected}
          data-testid={`model-preset-${key}`} onClick={() => {
            onSelect(key);
            setExpanded(false);
            summaryRef.current?.focus();
          }}
          className={cn("relative flex min-h-16 min-w-0 items-center gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            selected ? "border-primary/60 bg-primary/[0.06]" : "border-border/60 bg-background hover:border-foreground/25 hover:bg-muted/40")}>
          <ModelProviderMark provider={key} selected={selected} className="size-8 rounded-lg text-base" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground"><ModelProviderName provider={key} /></span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{t(preset.provider === "ollama" ? "providerLocal" : ["custom", "orcarouter"].includes(key) ? "providerGateway" : "providerCloud")}</span>
          </span>
          {selected && <Check aria-hidden="true" size={13} className="absolute right-1.5 top-1.5 text-primary" />}
        </button>;
      })}
    </div>
    </details>
  </fieldset>;
}
