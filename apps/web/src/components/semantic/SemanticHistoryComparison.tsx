"use client";

import { useTranslations } from "next-intl";

export interface SemanticHistoryPresentation {
  title: string; description: string | null; type: string; state: string; formula: string | null; synonyms: string[];
}

export function SemanticHistoryComparison({ current, previous, version, changes }: {
  current: SemanticHistoryPresentation; previous: SemanticHistoryPresentation; version: number; changes: string[];
}) {
  const t = useTranslations("semanticHistory");
  return <>
    <div className="mb-4 border-l-2 border-primary bg-primary/[0.035] px-3 py-2">
      <p className="text-xs leading-5">{changes.length ? t("changed", { changes: changes.map(key => t(`changes.${key}`)).join(t("separator")) }) : t("sameMeaning")}</p>
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-4">
      {([{ label: t("current"), data: current }, { label: t("selectedVersion", { version }), data: previous }] as const).map(({ label, data }) =>
        <section key={label} aria-label={label} className="min-w-0 rounded-xl border border-border bg-card p-4 [overflow-wrap:anywhere]">
          <p className="mb-3 text-[11px] font-semibold text-primary">{label}</p>
          <h4 className="whitespace-pre-wrap text-base font-semibold leading-6">{data.title}</h4>
          <p className="mt-2 text-[11px] text-muted-foreground">{data.type} · {data.state}</p>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{data.description || t("noDescription")}</p>
          {data.formula && <div className="mt-4 border-t border-border pt-3"><p className="text-[11px] text-muted-foreground">{t("formula")}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{data.formula}</p></div>}
          {data.synonyms.length > 0 && <div className="mt-4"><p className="text-[11px] text-muted-foreground">{t("synonyms")}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5">{data.synonyms.join(t("separator"))}</p></div>}
        </section>)}
    </div>
  </>;
}
