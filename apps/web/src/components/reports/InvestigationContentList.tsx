"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, ChevronDown, FileText, Table2, Target, Loader2 } from "lucide-react";
import type { AnalysisArtifact, AnalysisArtifactSummary, AnalysisHistoryItem } from "@/lib/types/api";
import { dataColumns, reportContentRows } from "@/lib/tabular-data";
import { artifactToReportBlock, createReportBlocksCopy } from "@/lib/report-blocks";
import { ReportBlockCard } from "./ReportBlockCard";
import { artifactContentKey, type ArtifactContentState } from "./useReportArtifactContent";
import { Button } from "@/components/ui/button";

const kinds = ["all", "metric", "chart", "table", "note"] as const;
type ContentKind = typeof kinds[number];
function contentKind(kind: AnalysisArtifact["kind"]): ContentKind {
  if (kind === "metric" || kind === "chart") return kind;
  if (kind === "table" || kind === "result_snapshot") return "table";
  return "note";
}
function ContentIcon({ kind }: { kind: ContentKind }) {
  const Icon = kind === "metric" ? Target : kind === "chart" ? BarChart3 : kind === "table" ? Table2 : FileText;
  return <Icon size={15} aria-hidden="true" />;
}
const noAction = () => {};

function ArtifactPreview({ artifact }: { artifact: AnalysisArtifact }) {
  const locale = useLocale();
  const t = useTranslations("investigationPicker");
  const tBlocks = useTranslations("reportBlocks");
  const { block, limited, previewRowCount } = useMemo(() => {
    const copy = createReportBlocksCopy((key, values) => tBlocks(key, values));
    const full = artifactToReportBlock(artifact, copy, locale);
    const table = full.block_type === "table" && reportContentRows(full.content);
    // Bound only the displayed copy. The import path always uses the original artifact.
    return {
      block: table ? { ...full, content: { ...full.content, [table.key]: table.rows.slice(0, 8),
        rows_count: full.content.rows_count ?? table.rows.length } } : full,
      previewRowCount: table ? table.rows.length : undefined,
      limited: Boolean(table && (table.rows.length > 8 || dataColumns(table.rows).length > 8)),
    };
  }, [artifact, locale, tBlocks]);
  return <div className="min-w-0 bg-muted/20 p-3">
    <ReportBlockCard block={block} editing={false} selected={false} staticRendering
      previewRowCount={previewRowCount}
      onSelect={noAction} onMove={noAction} onResize={noAction} onDuplicate={noAction} onDelete={noAction} />
    {limited && <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{t("tablePreviewLimit")}</p>}
  </div>;
}

export function InvestigationArtifactChoice({ artifact, selected, existing, onToggle, removalControl, content, onLoad }: {
  artifact: AnalysisArtifactSummary; selected: boolean; existing: boolean; onToggle: () => void;
  removalControl?: ReactNode;
  content?: ArtifactContentState; onLoad: () => void;
}) {
  const t = useTranslations("investigationPicker");
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const ChoiceLabel = removalControl ? "div" : "label";
  return <li className={selected ? "border-l-2 border-l-primary bg-primary/[0.025]" : "border-l-2 border-l-transparent"}>
    <div className="flex items-start gap-2 px-4 py-4">
      <ChoiceLabel className={`flex min-w-0 flex-1 items-start gap-3 ${removalControl ? "" : "cursor-pointer"}`}>
        {!removalControl && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={artifact.title}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2 text-sm font-medium leading-5"><span className="mt-0.5 shrink-0 text-primary"><ContentIcon kind={contentKind(artifact.kind)} /></span>{artifact.title}</span>
          {existing && <span className="mt-1.5 inline-block bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("alreadyAdded")}</span>}
        </span>
      </ChoiceLabel>
      <Button variant="ghost" size="sm" aria-label={t(expanded ? "hidePreviewAria" : "previewAria", { title: artifact.title })}
        aria-expanded={expanded} aria-controls={expanded ? previewId : undefined} onClick={() => { if (!expanded) onLoad(); setExpanded(!expanded); }}
        className="inline-flex min-h-7 shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary">
        {t(expanded ? "hidePreview" : "preview")}<ChevronDown size={13} className={expanded ? "rotate-180" : ""} />
      </Button>
      {removalControl}
    </div>
    {(expanded || selected) && content?.status === "error" && <div role="alert" className="px-5 pb-3 text-xs text-destructive">
      {t(content.changed ? "contentChanged" : "contentFailed")}
      {!content.changed && <Button variant="ghost" size="sm" onClick={onLoad} className="ml-3 text-primary">{t("retry")}</Button>}
    </div>}
    {(expanded || selected) && (!content || content.status === "loading") && <p role="status" className="flex items-center gap-2 px-5 pb-3 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />{t("loadingContent")}</p>}
    {expanded && <div id={previewId}>{content?.status === "ready" && <ArtifactPreview artifact={content.artifact} />}</div>}
  </li>;
}

export function InvestigationContentList({ run, artifacts, selectedIds, includeSummary, existingIds, onSummaryChange, onToggle, onSelectNew, onClear, contents, onLoad }: {
  run: AnalysisHistoryItem; artifacts: AnalysisArtifactSummary[]; selectedIds: Set<string>; includeSummary: boolean;
  existingIds: Set<string>; onSummaryChange: (value: boolean) => void; onToggle: (id: string) => void;
  onSelectNew: () => void; onClear: () => void;
  contents: ReadonlyMap<string, ArtifactContentState>; onLoad: (artifact: AnalysisArtifactSummary) => void;
}) {
  const t = useTranslations("investigationPicker");
  const [filter, setFilter] = useState<ContentKind>("all");
  const visible = artifacts.filter((artifact) => filter === "all" || contentKind(artifact.kind) === filter);
  const showSummary = filter === "all" || filter === "note";
  return <div>
    <section className="border-b border-border bg-muted/20 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold">{t("manualSelectTitle")}</h3>
        <div className="flex gap-3 text-[11px] font-semibold">
          <Button variant="ghost" size="sm" onClick={onSelectNew} className="text-primary">{t("selectNew")}</Button>
          <Button variant="ghost" size="sm" onClick={onClear}>{t("clearRunSelection")}</Button>
        </div>
      </div>
      <div role="group" aria-label={t("filterLabel")} className="mt-4 flex flex-wrap gap-1.5">
        {kinds.map((kind) => {
          const count = kind === "all" ? artifacts.length + 1 : artifacts.filter((a) => contentKind(a.kind) === kind).length + (kind === "note" ? 1 : 0);
          return <Button key={kind} size="sm" variant={kind === filter ? "primary" : "outline"} aria-pressed={kind === filter} onClick={() => setFilter(kind)}>
            {t(`filter.${kind}`)}<span className="tabular-nums opacity-75">{count}</span>
          </Button>;
        })}
      </div>
    </section>
    <ul className="divide-y divide-border">
      {showSummary && <li className={includeSummary ? "border-l-2 border-l-primary bg-primary/[0.025]" : "border-l-2 border-l-transparent"}>
        <label className="flex cursor-pointer items-start gap-3 px-4 py-4">
          <input type="checkbox" checked={includeSummary} onChange={(event) => onSummaryChange(event.target.checked)} aria-label={t("summaryLabel")}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
          <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium"><ContentIcon kind="note" />{t("summaryLabel")}</span>
            <span className="mt-2 block whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{run.report.summary || run.query}</span>
          </span>
        </label>
      </li>}
      {visible.map((artifact) => <InvestigationArtifactChoice key={artifact.id} artifact={artifact} selected={selectedIds.has(artifact.id)} existing={existingIds.has(artifact.id)} onToggle={() => onToggle(artifact.id)} content={contents.get(artifactContentKey(artifact))} onLoad={() => onLoad(artifact)} />)}
    </ul>
    {!visible.length && !showSummary && <p className="px-5 py-12 text-center text-xs text-muted-foreground">{t("emptyCategory")}</p>}
  </div>;
}
