"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { VisualCleaningColumnProfile, VisualCleaningPreview } from "@/lib/types/api";
import { cleaningColumnLabels } from "@/lib/cleaning-field-names";
import { CleaningColumnSelect } from "./CleaningColumnSelect";

export function cleaningChangedCells(preview: VisualCleaningPreview): number | null {
  // Older servers omitted the counts when row/schema alignment was unavailable.
  // An empty list is not evidence of zero edits.
  if (preview.comparison_basis === "unavailable" || !preview.changes.length) return null;
  if (preview.before.rows !== preview.after.rows || preview.before.columns !== preview.after.columns) return null;
  return preview.changes.reduce((total, change) => total + change.changed_count, 0);
}

const NO_COLUMN_NAMES: readonly string[] = [];

export function CleaningImpactProfiles({ preview, columnNames = NO_COLUMN_NAMES }: { preview: VisualCleaningPreview; columnNames?: readonly string[] }) {
  const t = useTranslations("visualCleaning");
  const locale = useLocale();
  const [session, setSession] = useState({ preview, selected: "", query: "" });
  if (session.preview !== preview) {
    const retainColumn = session.preview.source_id === preview.source_id
      && preview.profiles?.some(profile => profile.column === session.selected);
    setSession({ preview, selected: retainColumn ? session.selected : "", query: "" });
  }
  const columns = useMemo(() => (preview.profiles ?? []).map(profile => profile.column), [preview.profiles]);
  const labels = useMemo(() => cleaningColumnLabels([...columnNames, ...(preview.profiles ?? []).map(profile => profile.column)]), [columnNames, preview.profiles]);
  const profiles = preview.profiles ?? [];
  const impact = profiles.find((profile) => profile.column === session.selected) ?? profiles[0];
  if (!impact) return null;
  const sides = [impact.before, impact.after];
  const formatCount = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(locale);
  const countRows = [
    ["impactMissing", "null_count"],
    ["impactBlank", "blank_count"],
    ["impactZero", "zero_count"],
    ["impactNonFinite", "non_finite_count"],
  ] as const;

  function frequentValues(profile: VisualCleaningColumnProfile | null) {
    if (!profile || profile.kind === "other") return <span className="text-muted-foreground">—</span>;
    return (
      <>
        <p className="mb-2 text-muted-foreground">
          {t("impactSampleScope", { count: formatCount(profile.sample_rows) })}
        </p>
        {profile.top_values.length > 0 ? (
          <ul className="space-y-1.5">
            {profile.top_values.map(({ value, count }, index) => (
              <li key={index} className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-all whitespace-pre-wrap">
                  {profile.kind === "text" ? JSON.stringify(value)
                    : typeof value === "boolean" ? t(value ? "impactTrue" : "impactFalse")
                    : String(value)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{t("impactOccurrences", { count: formatCount(count) })}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">{t("impactNoFrequentValues")}</p>}
        {profile.omitted_long_values > 0 && (
          <p className="mt-2 text-muted-foreground">{t("impactLongValues", { count: formatCount(profile.omitted_long_values) })}</p>
        )}
      </>
    );
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-border" aria-label={t("impactTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <CleaningColumnSelect inline columns={columns} labels={labels} value={impact.column}
          onChange={(selected) => setSession(current => ({ ...current, selected }))}
          query={session.query} onQueryChange={(query) => setSession(current => ({ ...current, query }))}
          label={t("impactTitle")} searchLabel={t("searchImpactColumns")} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left text-xs" aria-label={t("impactTable")}>
          <thead><tr className="border-b border-border bg-muted/30">
            <th scope="col" className="w-1/4 px-3 py-2 font-medium">{t("impactMeasure")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("beforeLabel")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("afterLabel")}</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-border">
              <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">{t("impactType")}</th>
              {sides.map((profile, index) => <td key={index} className="px-3 py-2">{profile ? t(`impactKind.${profile.kind}`) : t("impactColumnAbsent")}</td>)}
            </tr>
            {countRows.filter(([, key]) => sides.some((profile) => profile?.[key] != null)).map(([label, key]) => (
              <tr key={key} className="border-b border-border">
                <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">{t(label)}</th>
                {sides.map((profile, index) => <td key={index} className="px-3 py-2 tabular-nums">{formatCount(profile?.[key])}</td>)}
              </tr>
            ))}
            {sides.some((profile) => profile?.kind === "number" || profile?.kind === "temporal") && (
              <tr className="border-b border-border">
                <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">{t("impactRange")}</th>
                {sides.map((profile, index) => <td key={index} className="break-all px-3 py-2 tabular-nums">
                  {profile?.minimum != null && profile.maximum != null
                    ? <>{String(profile.minimum)}<span className="block text-muted-foreground">{t("impactRangeTo")}</span>{String(profile.maximum)}</>
                    : "—"}
                </td>)}
              </tr>
            )}
            <tr>
              <th scope="row" className="px-3 py-2 align-top font-normal text-muted-foreground">{t("impactFrequentValues")}</th>
              {sides.map((profile, index) => <td key={index} className="px-3 py-2 align-top">{frequentValues(profile)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t("impactScope")}
        {(preview.profiles_omitted ?? 0) > 0 && <> {t("impactOmittedColumns", { count: formatCount(preview.profiles_omitted) })}</>}
      </p>
    </section>
  );
}
